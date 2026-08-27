/**
 * DrawerTopUpRepository × CurrencyRepository — General's unrestricted
 * currency policy has exactly ONE owner (GENERAL_DRAWER_UNRESTRICTED.md item
 * 9, second half; CLAUDE.md rule 14).
 *
 * `DrawerTopUpRepository.createTopUp`'s `extra_currencies` loop used to
 * write BOTH a `currencies` row (FK prerequisite for `exchange_lots`) AND a
 * `currency_drawers` allowlist row for General on every foreign-currency
 * top-up. The `currency_drawers` write was a second, redundant owner of a
 * policy `constants/drawerCurrencyPolicy.ts` already centralizes: General is
 * an `UNRESTRICTED_DRAWERS` member, so its countable currency set is
 * DERIVED — `UNRESTRICTED_DRAWER_BASE_CURRENCIES` (USD, LBP) unioned with
 * whatever the drawer physically holds a non-zero `drawer_balances` row for
 * (`CurrencyRepository.getCountableCurrenciesForDrawer`) — and is never read
 * from `currency_drawers` for General at all.
 *
 * This file proves the full chain end-to-end with the real repository
 * classes wired together (not a mocked `CurrencyRepository`): a brand-new
 * currency top-up into General
 *   (a) still becomes countable via `getCountableCurrenciesForDrawer`, and
 *   (b) writes ZERO `currency_drawers` rows anywhere,
 * so removing the repository's `ensureDrawer` call did not silently regress
 * General's count-sheet visibility for the currency it just received.
 */

import Database from "better-sqlite3";
import { DrawerTopUpRepository } from "../DrawerTopUpRepository";
import { DrawerTopUpService } from "../../services/DrawerTopUpService";
import { CurrencyRepository, resetCurrencyRepository } from "../CurrencyRepository";
import { resetExchangeLotRepository } from "../ExchangeLotRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema — mirrors
//     DrawerTopUpRepository.lotCreation.test.ts's fixture (same FK shape:
//     `PRAGMA foreign_keys = ON` + `exchange_lots` -> `currencies(tenant_id,
//     code)`), plus nothing extra: `CurrencyRepository.
//     getCountableCurrenciesForDrawer` only ever reads `currency_drawers`
//     and `drawer_balances` directly, so no other table is needed to
//     exercise it. ──────────────────────────────────────────────────────

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

// ─── Mock the connection module (same target BaseRepository/
//     ExchangeLotRepository/CurrencyRepository all read from) ─────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────

function currencyDrawerRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM currency_drawers").get() as {
      c: number;
    }
  ).c;
}

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

describe("General drawer's currency policy has exactly one owner (item 9, second half)", () => {
  let db: Database.Database;
  let topUpRepo: DrawerTopUpRepository;
  let service: DrawerTopUpService;
  let currencyRepo: CurrencyRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetCurrencyRepository();
    resetExchangeLotRepository();
    topUpRepo = new DrawerTopUpRepository();
    service = new DrawerTopUpService(topUpRepo);
    currencyRepo = new CurrencyRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetCurrencyRepository();
    resetExchangeLotRepository();
    db.close();
  });

  it("an extra-currency top-up into General becomes countable via the DERIVED policy, with zero currency_drawers rows written anywhere", () => {
    // GBP is brand new to this shop: absent from `currencies` AND from
    // `currency_drawers` before the top-up.
    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "GBP", amount: 300, acquisition_usd_per_unit: 1.27 },
        ],
      },
      1,
    );

    expect(result.success).toBe(true);
    expect(balance(db, "General", "GBP")).toBeCloseTo(300, 2);

    // (a) Countable: the derived policy picks GBP up from the drawer_balances
    // row the top-up just wrote, unioned with the USD/LBP base — with no
    // currency_drawers row for GBP existing anywhere.
    const countable = currencyRepo.getCountableCurrenciesForDrawer("General");
    expect(countable).toEqual(expect.arrayContaining(["USD", "LBP", "GBP"]));

    // (b) Zero currency_drawers rows written for it — and in fact zero rows
    // in the whole table, since nothing else in this test touches it either.
    const gbpDrawerRow = db
      .prepare(
        "SELECT * FROM currency_drawers WHERE currency_code = ? AND drawer_name = 'General'",
      )
      .get("GBP");
    expect(gbpDrawerRow).toBeUndefined();
    expect(currencyDrawerRowCount(db)).toBe(0);
  });

  it("still auto-registers the currencies row (FK prerequisite for exchange_lots) even though currency_drawers is untouched", () => {
    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "AED", amount: 75, acquisition_usd_per_unit: 0.27 },
        ],
      },
      1,
    );

    expect(result.success).toBe(true);

    const currencyRow = db
      .prepare("SELECT * FROM currencies WHERE code = ? AND tenant_id = 1")
      .get("AED") as { is_active: number } | undefined;
    expect(currencyRow).toBeTruthy();
    expect(currencyRow!.is_active).toBe(1);

    expect(currencyDrawerRowCount(db)).toBe(0);
  });
});
