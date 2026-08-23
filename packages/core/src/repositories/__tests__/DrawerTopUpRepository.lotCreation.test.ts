/**
 * DrawerTopUpRepository / DrawerTopUpService — exchange-lot creation for
 * foreign-currency top-ups (EXCHANGE_LOT_SETTLEMENT.md Q3, Phase 6).
 *
 * `createTopUp`'s External (Cash-In) `extra_currencies` legs are the ONLY
 * top-up path that can ever carry a non-USD/LBP amount, and they always post
 * to the General drawer (hardcoded `GENERAL_DRAWER` — `createTopUpFromDrawer`
 * and `transferBetweenDrawers` carry no `currency_code` at all). So every
 * entry that reaches `extra_currencies` is, by construction, both lot-tracked
 * (`isLotTrackedCurrency` — DrawerTopUpService.addTopUp explicitly rejects
 * USD/LBP in `extra_currencies`, since they have their own dedicated fields)
 * AND targeting General — this file proves the lot this now opens, and the
 * guards around it. The "non-General exotic top-up"
 * case EXCHANGE_LOT_SETTLEMENT.md's task list flags as "if constructible" is
 * NOT constructible via the current public repository API: there is no
 * top-up method that accepts both a currency_code and a non-General target,
 * so no test exists for it here (a fabricated one would misrepresent the
 * code) — the repository's defensive `else if` branch for a non-exotic
 * currency IS reachable (a caller bypassing the service) and is covered
 * below instead.
 */

import Database from "better-sqlite3";
import { DrawerTopUpRepository } from "../DrawerTopUpRepository";
import { DrawerTopUpService } from "../../services/DrawerTopUpService";
import { resetCurrencyRepository } from "../CurrencyRepository";
import { resetExchangeLotRepository } from "../ExchangeLotRepository";
import { resetRateRepository } from "../RateRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema (mirrors DrawerTopUpRepository.test.ts + the
//     exchange_lots shape from ExchangeRepository.lotSettlement.test.ts) ────
//
// `PRAGMA foreign_keys = ON` + `currencies(tenant_id, code)` UNIQUE +
// `exchange_lots`'s composite FK to it mirror production exactly (see
// electron-app/create_db.sql) — this is what makes the "unknown-code
// auto-registration" tests below a real FK proof rather than a no-op: if the
// repository's `ensureCurrency`/`ensureDrawer` calls were removed,
// `createLot`'s INSERT would fail with a real
// `SQLITE_CONSTRAINT_FOREIGNKEY` error, not merely "would have in
// production".

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE drawer_topups (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      notes TEXT,
      source_drawer TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      decimal_places INTEGER DEFAULT 2,
      is_active INTEGER DEFAULT 1,
      UNIQUE (tenant_id, code)
    );

    CREATE TABLE exchange_rates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER DEFAULT 1,
      to_code     TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate    REAL NOT NULL DEFAULT 0,
      sell_rate   REAL NOT NULL DEFAULT 0,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      updated_at  TEXT DEFAULT (datetime('now')),
      UNIQUE (tenant_id, to_code)
    );

    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_lots (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER DEFAULT 1,
      currency_code  TEXT NOT NULL,
      drawer_name    TEXT NOT NULL DEFAULT 'General',
      source_type    TEXT NOT NULL CHECK(source_type IN ('EXCHANGE_BUY', 'DRAWER_TOPUP', 'ADJUSTMENT')),
      source_table   TEXT,
      source_id      INTEGER,
      original_qty   REAL NOT NULL,
      remaining_qty  REAL NOT NULL,
      unit_cost_usd  REAL NOT NULL,
      acquired_at    DATETIME NOT NULL,
      is_voided      INTEGER NOT NULL DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code)
    );
    CREATE INDEX idx_exchange_lots_fifo ON exchange_lots(tenant_id, currency_code, acquired_at, id);
  `);

  return db;
}

// ─── Mock the connection module (same target BaseRepository/ExchangeLotRepository read from) ──

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function enableDrawerCurrency(
  db: Database.Database,
  drawerName: string,
  currencyCode: string,
): void {
  const code = currencyCode.toUpperCase();
  const exists = db
    .prepare("SELECT 1 FROM currencies WHERE code = ? AND tenant_id = 1")
    .get(code);
  if (!exists) {
    db.prepare(
      "INSERT INTO currencies (code, name, symbol, decimal_places, is_active, tenant_id) VALUES (?, ?, ?, 2, 1, 1)",
    ).run(code, code, code);
  }
  db.prepare(
    "INSERT INTO currency_drawers (currency_code, drawer_name, tenant_id) VALUES (?, ?, 1)",
  ).run(currencyCode, drawerName);
}

function topUpRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM drawer_topups").get() as { c: number }
  ).c;
}

function paymentsRows(db: Database.Database): any[] {
  return db.prepare("SELECT * FROM payments").all() as any[];
}

function lotsFor(db: Database.Database, currencyCode: string): any[] {
  return db
    .prepare("SELECT * FROM exchange_lots WHERE currency_code = ?")
    .all(currencyCode) as any[];
}

function topUpCreatedAt(db: Database.Database, id: number): string {
  return (
    db.prepare("SELECT created_at FROM drawer_topups WHERE id = ?").get(id) as {
      created_at: string;
    }
  ).created_at;
}

describe("DrawerTopUpRepository/Service — exchange-lot creation on foreign-currency top-ups", () => {
  let db: Database.Database;
  let repo: DrawerTopUpRepository;
  let service: DrawerTopUpService;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetCurrencyRepository();
    resetExchangeLotRepository();
    repo = new DrawerTopUpRepository();
    service = new DrawerTopUpService(repo);
  });

  afterEach(() => {
    resetTenantContext();
    resetCurrencyRepository();
    resetExchangeLotRepository();
    db.close();
  });

  it("opens an exchange lot at the operator-entered acquisition rate for an exotic General top-up", () => {
    enableDrawerCurrency(db, "General", "EUR");

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "EUR", amount: 100, acquisition_usd_per_unit: 1.08 },
        ],
      },
      1,
    );

    expect(result.success).toBe(true);
    expect(balance(db, "General", "EUR")).toBeCloseTo(100, 2);

    const lots = lotsFor(db, "EUR");
    expect(lots).toHaveLength(1);
    expect(lots[0].source_type).toBe("DRAWER_TOPUP");
    expect(lots[0].source_table).toBe("drawer_topups");
    expect(lots[0].source_id).toBe(result.id);
    expect(lots[0].original_qty).toBeCloseTo(100, 5);
    expect(lots[0].remaining_qty).toBeCloseTo(100, 5);
    expect(lots[0].unit_cost_usd).toBeCloseTo(1.08, 5);
    expect(lots[0].is_voided).toBe(0);
    expect(lots[0].drawer_name).toBe("General");
    // Same acquisition timestamp as the top-up row's own created_at — read
    // back, never re-derived (EXCHANGE_LOT_SETTLEMENT.md Q3 / rule per
    // ExchangeRepository's identical pattern).
    expect(lots[0].acquired_at).toBe(topUpCreatedAt(db, result.id as number));
  });

  /**
   * Pre-refinement (2026-08-22 Q3 shape), this test asserted the OLD
   * always-required-rate behavior ("acquisition_usd_per_unit is required").
   * The 2026-08-23 owner refinement ("market rate by default") replaces that
   * hard requirement with the 4-step resolution order — this is step 4 (none
   * of override/rate-row/hint resolve). Rule 17: run against the
   * pre-refinement code (the old unconditional require-rate check restored),
   * this test's OWN assertions (`no cost basis available`, naming EUR and
   * the edit link) fail — the old code raises the different
   * "acquisition_usd_per_unit is required" message instead. Confirmed, then
   * reverted back to the refined code — see the task report.
   */
  it("rejects an exotic top-up with no cost basis available anywhere (no override, no rate row, no feed hint) — the whole transaction rolls back", () => {
    enableDrawerCurrency(db, "General", "EUR"); // no exchange_rates row for EUR

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [{ currency_code: "EUR", amount: 50 }],
      },
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no cost basis available/i);
    expect(result.error).toMatch(/edit link/i);
    expect(result.error).toMatch(/EUR/);

    // Nothing was written — createTopUp's db.transaction rolled back the
    // topup row, the unified transaction row, the payment leg, AND the
    // drawer-balance delta the EUR leg had already applied before the throw.
    expect(topUpRowCount(db)).toBe(0);
    expect(paymentsRows(db)).toHaveLength(0);
    expect(balance(db, "General", "EUR")).toBeCloseTo(0, 2);
    expect(lotsFor(db, "EUR")).toHaveLength(0);
  });

  // ─── 2026-08-23 refinement — cost-basis resolution order (AC2) ───────────

  describe("cost-basis resolution order (operator override > configured market rate > feed hint > error)", () => {
    /** Seeds an `exchange_rates` row exactly like `RateRepository.upsert`
     *  would, for the currently-fixed tenant (1). */
    function setMarketRate(
      code: string,
      marketRate: number,
      isStronger: 1 | -1,
    ): void {
      db.prepare(
        `INSERT INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger)
         VALUES (1, ?, ?, ?, ?, ?)`,
      ).run(code, marketRate, marketRate, marketRate, isStronger);
    }

    beforeEach(() => {
      resetRateRepository();
    });

    afterEach(() => {
      resetRateRepository();
    });

    it("falls back to the configured market rate — is_stronger = -1 (EUR-like, market_rate already USD-per-unit)", () => {
      enableDrawerCurrency(db, "General", "EUR");
      setMarketRate("EUR", 1.16, -1);

      const result = service.addTopUp(
        {
          amount_usd: 0,
          amount_lbp: 0,
          extra_currencies: [{ currency_code: "EUR", amount: 100 }],
        },
        1,
      );

      expect(result.success).toBe(true);
      const lots = lotsFor(db, "EUR");
      expect(lots).toHaveLength(1);
      // marketRateToUsdPerUnit(1.16, -1) === 1.16 (already USD-per-unit).
      expect(lots[0].unit_cost_usd).toBeCloseTo(1.16, 6);
    });

    it("falls back to the configured market rate — is_stronger = +1 (units-per-USD orientation)", () => {
      enableDrawerCurrency(db, "General", "JOD");
      setMarketRate("JOD", 1500, 1);

      const result = service.addTopUp(
        {
          amount_usd: 0,
          amount_lbp: 0,
          extra_currencies: [{ currency_code: "JOD", amount: 200 }],
        },
        1,
      );

      expect(result.success).toBe(true);
      const lots = lotsFor(db, "JOD");
      expect(lots).toHaveLength(1);
      // marketRateToUsdPerUnit(1500, 1) === 1 / 1500.
      expect(lots[0].unit_cost_usd).toBeCloseTo(1 / 1500, 8);
    });

    it("falls back to the client feed hint ONLY when there is no configured rate row", () => {
      enableDrawerCurrency(db, "General", "GBP"); // no exchange_rates row

      const result = service.addTopUp(
        {
          amount_usd: 0,
          amount_lbp: 0,
          extra_currencies: [
            {
              currency_code: "GBP",
              amount: 40,
              market_usd_per_unit_hint: 1.27,
            },
          ],
        },
        1,
      );

      expect(result.success).toBe(true);
      const lots = lotsFor(db, "GBP");
      expect(lots).toHaveLength(1);
      expect(lots[0].unit_cost_usd).toBeCloseTo(1.27, 6);
    });

    it("IGNORES the client feed hint when a configured rate row exists — the server prefers its own rate", () => {
      enableDrawerCurrency(db, "General", "EUR");
      setMarketRate("EUR", 1.16, -1);

      const result = service.addTopUp(
        {
          amount_usd: 0,
          amount_lbp: 0,
          extra_currencies: [
            {
              currency_code: "EUR",
              amount: 100,
              // Deliberately wrong/different from the configured rate — if
              // this leaks through, the assertion below catches it.
              market_usd_per_unit_hint: 999,
            },
          ],
        },
        1,
      );

      expect(result.success).toBe(true);
      const lots = lotsFor(db, "EUR");
      expect(lots[0].unit_cost_usd).toBeCloseTo(1.16, 6);
    });

    it("the operator override beats BOTH a configured rate row and a feed hint", () => {
      enableDrawerCurrency(db, "General", "EUR");
      setMarketRate("EUR", 1.16, -1);

      const result = service.addTopUp(
        {
          amount_usd: 0,
          amount_lbp: 0,
          extra_currencies: [
            {
              currency_code: "EUR",
              amount: 100,
              acquisition_usd_per_unit: 1.5,
              market_usd_per_unit_hint: 999,
            },
          ],
        },
        1,
      );

      expect(result.success).toBe(true);
      const lots = lotsFor(db, "EUR");
      expect(lots[0].unit_cost_usd).toBeCloseTo(1.5, 6);
    });

    /**
     * Rule 17 — proves the resolution ORDER, not just that each branch works
     * in isolation. Sabotaged by temporarily short-circuiting step 2 in
     * DrawerTopUpRepository.ts (`getRateRepository().findByCode(...)` forced
     * to return `null`, simulating "step 2 skipped"): BOTH orientation tests
     * above ("falls back to the configured market rate...") then FAILED —
     * they fell through to the feed-hint branch (no hint supplied) and threw
     * the step-4 "no cost basis available" error instead of resolving from
     * `exchange_rates`. Restored immediately after confirming the failure;
     * see the task report for the exact before/after.
     */
    it("unknown-code auto-registration creates currencies + currency_drawers rows and the lot lands (FK proof)", () => {
      // AED deliberately absent from `currencies`/`currency_drawers` — with
      // `PRAGMA foreign_keys = ON` and exchange_lots' composite FK to
      // currencies(tenant_id, code) (this file's schema), createLot's INSERT
      // would fail outright if the repository didn't auto-register the code
      // first.
      const result = service.addTopUp(
        {
          amount_usd: 0,
          amount_lbp: 0,
          extra_currencies: [
            {
              currency_code: "AED",
              amount: 75,
              acquisition_usd_per_unit: 0.27,
            },
          ],
        },
        1,
      );

      expect(result.success).toBe(true);
      expect(balance(db, "General", "AED")).toBeCloseTo(75, 2);

      const currencyRow = db
        .prepare("SELECT * FROM currencies WHERE code = ? AND tenant_id = 1")
        .get("AED") as { is_active: number } | undefined;
      expect(currencyRow).toBeTruthy();
      expect(currencyRow!.is_active).toBe(1);

      const drawerRow = db
        .prepare(
          "SELECT * FROM currency_drawers WHERE currency_code = ? AND drawer_name = 'General' AND tenant_id = 1",
        )
        .get("AED");
      expect(drawerRow).toBeTruthy();

      const lots = lotsFor(db, "AED");
      expect(lots).toHaveLength(1);
      expect(lots[0].unit_cost_usd).toBeCloseTo(0.27, 6);
    });
  });

  it("a plain USD/LBP top-up (no extra_currencies) opens no lot", () => {
    const result = service.addTopUp({ amount_usd: 20, amount_lbp: 0 }, 1);

    expect(result.success).toBe(true);
    expect(balance(db, "General", "USD")).toBeCloseTo(20, 2);
    expect(lotsFor(db, "USD")).toHaveLength(0);
  });

  it("opens one independent lot per currency when two different exotic currencies are topped up in one submission", () => {
    enableDrawerCurrency(db, "General", "EUR");
    enableDrawerCurrency(db, "General", "GBP");

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "EUR", amount: 100, acquisition_usd_per_unit: 1.08 },
          { currency_code: "GBP", amount: 40, acquisition_usd_per_unit: 1.27 },
        ],
      },
      1,
    );

    expect(result.success).toBe(true);

    const eurLots = lotsFor(db, "EUR");
    const gbpLots = lotsFor(db, "GBP");
    expect(eurLots).toHaveLength(1);
    expect(gbpLots).toHaveLength(1);
    expect(eurLots[0].original_qty).toBeCloseTo(100, 5);
    expect(eurLots[0].unit_cost_usd).toBeCloseTo(1.08, 5);
    expect(gbpLots[0].original_qty).toBeCloseTo(40, 5);
    expect(gbpLots[0].unit_cost_usd).toBeCloseTo(1.27, 5);
  });

  /**
   * `DrawerTopUpService.addTopUp` explicitly rejects USD/LBP in
   * `extra_currencies` before an entry ever reaches the repository (with a
   * DIFFERENT message — "has its own dedicated amount field above"), so this
   * defensive branch can only be exercised by a caller that bypasses the
   * service and calls the repository directly, as this test does.
   */
  it("repository rejects acquisition_usd_per_unit supplied for a non-lot-tracked currency (defense in depth)", () => {
    expect(() =>
      repo.createTopUp(
        {
          amount_usd: 0,
          amount_lbp: 0,
          extra_currencies: [
            { currency_code: "USD", amount: 10, acquisition_usd_per_unit: 1 },
          ],
        },
        1,
      ),
    ).toThrow(/acquisition_usd_per_unit is only valid for a foreign/i);

    expect(topUpRowCount(db)).toBe(0);
    expect(lotsFor(db, "USD")).toHaveLength(0);
  });
});
