/**
 * ExchangeRepository — the missing override chain (EXCHANGE_LOT_SETTLEMENT.md
 * override-fix follow-up).
 *
 * Proves the full write-path chain for an operator-overridden CROSS
 * exchange that acquires a lot-tracked currency at a rate that DIFFERS from
 * both the currency's configured `exchange_rates` row AND the live market
 * rate — the "non-degeneracy" the plan calls for, so a bug that silently
 * anchors on the CONFIGURED rate instead of the EXECUTED one cannot hide
 * behind a coincidence where they happen to match:
 *
 *   1. Cross BUY EUR paying LBP, leg1Rate 1.12 — the EUR currency's
 *      CONFIGURED buy_rate is 1.16 (seeded below) and the live market_rate
 *      is 1.18; the OPERATOR applied 1.12, a rate the DB has never seen.
 *      Asserts the resulting EUR lot's `unit_cost_usd` is 1.12 EXACTLY
 *      (never 1.16 or 1.18), that leg1 (acquire) books 0 profit (Q8), that
 *      leg2 (LBP, never lot-tracked) keeps its client-sent profit
 *      VERBATIM, and that `bookedProfitUsd` (this file's new assertion —
 *      the repo's re-read of the row's FINAL persisted `profit_usd`)
 *      equals that kept leg2 value.
 *   2. A later direct SELL of that same 100 EUR at 1.20 FIFO-consumes the
 *      lot and realizes 100 × (1.20 − 1.12) = 8.00 — proving
 *      `bookedProfitUsd` tracks the REALIZED replacement, not whatever
 *      stale client-sent guess arrived with the payload.
 *
 * Both submissions route through `exchangeSubmitSchema.safeParse()` first
 * (mirrors the IPC/REST transport boundary exactly, matching this file's
 * sibling `ExchangeRepository.lotSettlement.test.ts`'s own
 * "schema-validated submit path" block) and land on
 * `ExchangeService.addDirectTransaction`, not the repository directly, so
 * `bookedProfitUsd` is proven all the way through the service envelope
 * `ExchangeOpResult` — not just the repository's `CreateExchangeResult`.
 *
 * ── Rule-17 sabotage recipe (for the orchestrator to run once jest is
 *    ABI-unblocked; reintroduce, watch this file fail, then revert) ──
 *
 *   In `ExchangeRepository._crossUsdNotional` (the `toCurrency === 'LBP'`
 *   branch), replace:
 *     const perUnit = this._usdPerUnitFromExecutedRate(data.leg2Rate as number, "LBP");
 *     return perUnit === null ? null : perUnit * data.amountOut;
 *   with an anchor derived from the FROM currency's own CONFIGURED rate row
 *   instead of the executed leg rate, e.g.:
 *     const eurRow = getRateRepository().findByCode(data.fromCurrency)!;
 *     return eurRow.buy_rate * data.amountIn; // 1.16 * 100 = 116, not 112
 *   With that swap, `crossUsdNotional` becomes 116 (not 112), so
 *   `unitCostUsd = crossUsdNotional / amountIn` becomes 1.16 — the
 *   `expect(lots[0].unit_cost_usd).toBeCloseTo(1.12, 10)` assertion below
 *   must FAIL at ~1.16, and the `.not.toBeCloseTo(1.16, 2)` assertion must
 *   also flip. This is exactly the bug class the "Rate-editing note" on
 *   `_usdPerUnitFromExecutedRate` already guards against in prose — this
 *   test is what makes that guard executable.
 */

import Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository";
import type { CreateExchangeData } from "../ExchangeRepository";
import { ExchangeService } from "../../services/ExchangeService";
import { exchangeSubmitSchema } from "../../validators/exchange";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema (verbatim copy of the harness in
// ExchangeRepository.lotSettlement.test.ts — kept local rather than shared
// so this file has no import-order coupling to that one) ──────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT
    );
    INSERT INTO users (id, username, role) VALUES (1, 'Admin', 'admin');

    CREATE TABLE exchange_transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      rate REAL,
      base_rate REAL,
      profit_usd REAL,
      leg1_rate REAL,
      leg1_market_rate REAL,
      leg1_profit_usd REAL,
      leg2_rate REAL,
      leg2_market_rate REAL,
      leg2_profit_usd REAL,
      via_currency TEXT,
      client_name TEXT,
      note TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    INSERT INTO currencies (tenant_id, code, name) VALUES
      (1, 'USD', 'US Dollar'), (1, 'LBP', 'Lebanese Pound'), (1, 'EUR', 'Euro');

    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    CREATE TABLE exchange_rates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER DEFAULT 1,
      to_code     TEXT    NOT NULL,
      market_rate REAL    NOT NULL,
      buy_rate    REAL    NOT NULL,
      sell_rate   REAL    NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
      updated_at  TEXT    DEFAULT (datetime('now')),
      UNIQUE (tenant_id, to_code)
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
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_exchange_lots_fifo ON exchange_lots(tenant_id, currency_code, acquired_at, id);

    CREATE TABLE exchange_lot_settlements (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      lot_id             INTEGER REFERENCES exchange_lots(id) ON DELETE SET NULL,
      basis_source       TEXT NOT NULL CHECK(basis_source IN ('LOT', 'MARKET')),
      settled_by_table   TEXT NOT NULL,
      settled_by_id      INTEGER NOT NULL,
      qty                REAL NOT NULL,
      unit_cost_usd      REAL NOT NULL,
      unit_proceeds_usd  REAL NOT NULL,
      profit_usd         REAL NOT NULL,
      is_refunded        INTEGER NOT NULL DEFAULT 0,
      refunded_at        TEXT,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount    REAL NOT NULL DEFAULT 0,
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
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

    -- Empty on purpose: _cancelDebt (run by every void/refund) queries this
    -- table unconditionally with no existence check.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      refunded_at TEXT DEFAULT NULL
    );

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);

  return db;
}

// ─── Mock the connection module (same pattern as the lotSettlement/forPartner
// sibling test files) ───────────────────────────────────────────────────────

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

function seedRate(
  db: Database.Database,
  toCode: string,
  marketRate: number,
  buyRate: number,
  sellRate: number,
  isStronger: 1 | -1,
): void {
  db.prepare(
    `INSERT INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(toCode, marketRate, buyRate, sellRate, isStronger);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exchangeRow(db: Database.Database, id: number): any {
  return db.prepare(`SELECT * FROM exchange_transactions WHERE id = ?`).get(id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unifiedRow(db: Database.Database, sourceId: number): any {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE source_table = 'exchange_transactions' AND source_id = ?`,
    )
    .get(sourceId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lotRows(db: Database.Database, currencyCode: string): any[] {
  return db
    .prepare(
      `SELECT * FROM exchange_lots WHERE currency_code = ? ORDER BY id ASC`,
    )
    .all(currencyCode);
}

describe("ExchangeRepository — override chain (bookedProfitUsd + cross non-degeneracy)", () => {
  let db: Database.Database;
  let repo: ExchangeRepository;
  let service: ExchangeService;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new ExchangeRepository();
    service = new ExchangeService(repo);

    // Live-DB rate anchors used throughout FEATURE_GUIDE examples. EUR's
    // configured buy_rate (1.16) and market_rate (1.18) are DELIBERATELY
    // both different from the 1.12 the operator applies below — the whole
    // point of the non-degeneracy check.
    seedRate(db, "EUR", 1.18, 1.16, 1.2, -1);
    seedRate(db, "LBP", 89500, 89000, 90000, 1);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("cross BUY EUR->LBP at an overridden leg1Rate (1.12, neither the configured 1.16 nor market 1.18): lot cost basis, leg profits, and bookedProfitUsd all anchor on the EXECUTED rates", () => {
    // amountOut is internally consistent with leg1Rate=1.12 (EUR->USD) then
    // leg2Rate=89200 (USD->LBP): 100 * 1.12 = 112 USD; 112 * 89200 =
    // 9,990,400 LBP. 89200 is deliberately NONE of LBP's configured rates
    // (market_rate 89500, buy_rate 89000, sell_rate 90000, seeded above) — if
    // a bug anchored `_crossUsdNotional` on a CONFIGURED LBP rate instead of
    // the EXECUTED leg2Rate, unit_cost_usd would come out as
    // 9,990,400/89500/100 ≈ 1.1163 or 9,990,400/90000/100 ≈ 1.11 — never
    // exactly 1.12 — so the mistake can't hide behind a coincidental match
    // the way the old leg2Rate=89000 (which equalled the seeded buy_rate,
    // making the bug and the fix compute the same number) could.
    const rawBuyPayload = {
      fromCurrency: "EUR",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 9_990_400,
      leg1Rate: 1.12,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 20, // stale client spread guess — must be replaced by 0 (Q8)
      leg2Rate: 89200,
      leg2MarketRate: 89500,
      leg2ProfitUsd: 50, // KEPT verbatim — LBP is never lot-tracked
      viaCurrency: "USD",
      totalProfitUsd: 70,
    };

    const buyParse = exchangeSubmitSchema.safeParse(rawBuyPayload);
    expect(buyParse.success).toBe(true);
    if (!buyParse.success) return;

    const buyResult = service.addDirectTransaction(
      buyParse.data as unknown as CreateExchangeData,
    );
    expect(buyResult.success).toBe(true);
    const buyId = buyResult.id!;

    const ex = exchangeRow(db, buyId);
    expect(ex.leg1_profit_usd).toBeCloseTo(0, 6);
    expect(ex.leg2_profit_usd).toBeCloseTo(50, 6);
    expect(ex.profit_usd).toBeCloseTo(50, 6);

    const lots = lotRows(db, "EUR");
    expect(lots).toHaveLength(1);
    expect(lots[0].original_qty).toBe(100);
    // The non-degeneracy assertion: 1.12 EXACTLY (crossUsdNotional / amountIn
    // = (9,990,400 / 89200) / 100 = 112 / 100), never 1.16 (EUR's configured
    // buy_rate) or 1.18 (EUR's market_rate) — proving the anchor is the
    // EXECUTED leg2Rate via LBP, never the currently-configured EUR row.
    expect(lots[0].unit_cost_usd).toBeCloseTo(1.12, 10);
    expect(lots[0].unit_cost_usd).not.toBeCloseTo(1.16, 2);
    expect(lots[0].unit_cost_usd).not.toBeCloseTo(1.18, 2);

    // bookedProfitUsd: the re-read FINAL persisted profit_usd (0 + 50 = 50),
    // present on BOTH the repository result and the service envelope.
    expect(buyResult.bookedProfitUsd).toBeCloseTo(50, 6);
    expect(buyResult.realizedProfitUsd).toBeUndefined(); // acquire only — nothing sold yet

    const unified = unifiedRow(db, buyId);
    expect(unified.profit_usd).toBeCloseTo(50, 6);

    // ── Step 2: a later direct SELL of the same 100 EUR at 1.20 ──────────
    const rawSellPayload = {
      fromCurrency: "USD",
      toCurrency: "EUR",
      amountIn: 120, // 100 EUR * 1.20
      amountOut: 100,
      leg1Rate: 1.2,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 999, // stale — must be replaced by the realized FIFO profit
      totalProfitUsd: 999,
    };

    const sellParse = exchangeSubmitSchema.safeParse(rawSellPayload);
    expect(sellParse.success).toBe(true);
    if (!sellParse.success) return;

    const sellResult = service.addDirectTransaction(
      sellParse.data as unknown as CreateExchangeData,
    );
    expect(sellResult.success).toBe(true);

    // Settlement profit: 100 * (1.20 applied − 1.12 cost) = 8.00.
    expect(sellResult.realizedProfitUsd).toBeCloseTo(8, 6);
    expect(sellResult.lotCoveredQty).toBe(100);
    expect(sellResult.lotMarketQty).toBe(0);
    // bookedProfitUsd reflects the REALIZED replacement, not the client's
    // stale 999 guess.
    expect(sellResult.bookedProfitUsd).toBeCloseTo(8, 6);

    const sellEx = exchangeRow(db, sellResult.id!);
    expect(sellEx.leg1_profit_usd).toBeCloseTo(8, 6);
    expect(sellEx.profit_usd).toBeCloseTo(8, 6);

    const eurLotsAfter = lotRows(db, "EUR");
    expect(eurLotsAfter[0].remaining_qty).toBe(0); // fully consumed
  });
});
