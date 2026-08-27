/**
 * ExchangeRepository — EXCHANGE_LOT_SETTLEMENT.md Phase 3 wiring.
 *
 * The lot engine (`ExchangeLotRepository`, Phase 2) is proven standalone in
 * `ExchangeLotRepository.test.ts`. This file proves the WIRING inside
 * `ExchangeRepository.createTransaction`: per-leg exotic/LBP branching (the
 * "Direction semantics" — `from_currency` exotic acquires, `to_currency`
 * exotic consumes), the USD-notional derivation for direct vs. cross legs,
 * the byte-identical USD<->LBP path, and the oversell MARKET/feed-only-
 * fallback basis. Void/refund reversal is proven separately in
 * `TransactionRepository.exchangeLotReversal.test.ts`.
 */

import Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository";
import { getExchangeLotRepository } from "../ExchangeLotRepository";
import { exchangeLogger } from "../../utils/logger";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { exchangeSubmitSchema } from "../../validators/exchange";
import { ExchangeService } from "../../services/ExchangeService";
import type { CreateExchangeData } from "../ExchangeRepository";

// ─── In-memory schema ─────────────────────────────────────────────────────────

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

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
      (1, 'USD', 'US Dollar'), (1, 'LBP', 'Lebanese Pound'),
      (1, 'EUR', 'Euro'), (1, 'GBP', 'British Pound'), (1, 'CHF', 'Swiss Franc');

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

// ─── Mock the connection module (same pattern as ExchangeRepository.forPartner.test.ts) ──

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

function seedPartner(db: Database.Database, name = "Exchange Partner"): number {
  const res = db
    .prepare("INSERT INTO partners (name, is_active) VALUES (?, 1)")
    .run(name);
  return Number(res.lastInsertRowid);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function settlementRows(db: Database.Database): any[] {
  return db
    .prepare(`SELECT * FROM exchange_lot_settlements ORDER BY id ASC`)
    .all();
}

function countRows(db: Database.Database, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

describe("ExchangeRepository.createTransaction() — lot settlement wiring (EXCHANGE_LOT_SETTLEMENT.md Phase 3)", () => {
  let db: Database.Database;
  let repo: ExchangeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new ExchangeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // ---------------------------------------------------------------------------
  // Acquire (BUY): from_currency exotic
  // ---------------------------------------------------------------------------

  describe("acquire — from_currency exotic", () => {
    it("direct BUY EUR with USD: opens a lot at amount_out/amount_in, stamps leg1_profit_usd = 0", () => {
      seedRate(db, "EUR", 1.18, 1.16, 1.2, -1);

      const result = repo.createTransaction({
        fromCurrency: "EUR",
        toCurrency: "USD",
        amountIn: 1000,
        amountOut: 1160,
        leg1Rate: 1.16,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 20, // stale client spread guess — must be replaced by 0 (Q8)
        totalProfitUsd: 20,
      });

      expect(result.realizedProfitUsd).toBeUndefined();
      expect(result.lotCoveredQty).toBeUndefined();
      expect(result.lotMarketQty).toBeUndefined();

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBeCloseTo(0, 6);
      expect(ex.leg2_profit_usd).toBeNull();
      expect(ex.profit_usd).toBeCloseTo(0, 6);

      const lots = lotRows(db, "EUR");
      expect(lots).toHaveLength(1);
      expect(lots[0].original_qty).toBe(1000);
      expect(lots[0].remaining_qty).toBe(1000);
      expect(lots[0].unit_cost_usd).toBeCloseTo(1.16, 6); // 1160 / 1000
      expect(lots[0].source_type).toBe("EXCHANGE_BUY");
      expect(lots[0].source_table).toBe("exchange_transactions");
      expect(lots[0].source_id).toBe(result.id);

      const unified = unifiedRow(db, result.id);
      expect(unified.profit_usd).toBeCloseTo(0, 6);
      const meta = JSON.parse(unified.metadata_json);
      expect(meta.total_profit_usd).toBe(20); // kept: the client's ORIGINAL total
      expect(meta.realized_profit_usd).toBe(0);
      expect(meta.lot_covered_qty).toBe(0);
      expect(meta.lot_market_qty).toBe(0);
    });

    it("cross BUY EUR paying LBP: opens a EUR lot from the leg1 executed rate, leg2's LBP spread profit is KEPT", () => {
      seedRate(db, "EUR", 1.18, 1.16, 1.2, -1);
      seedRate(db, "LBP", 89500, 89000, 90000, 1);

      const result = repo.createTransaction({
        fromCurrency: "EUR",
        toCurrency: "LBP",
        amountIn: 1000,
        amountOut: 104_400_000,
        leg1Rate: 1.16,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 20, // stale — replaced by 0
        leg2Rate: 90000,
        leg2MarketRate: 89500,
        leg2ProfitUsd: 50, // KEPT — LBP is never lot-tracked
        viaCurrency: "USD",
        totalProfitUsd: 70,
      });

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBeCloseTo(0, 6);
      expect(ex.leg2_profit_usd).toBeCloseTo(50, 6);
      expect(ex.profit_usd).toBeCloseTo(50, 6);

      const lots = lotRows(db, "EUR");
      expect(lots).toHaveLength(1);
      expect(lots[0].original_qty).toBe(1000);
      // is_stronger = -1 (EUR-like) -> USD value of 1 unit IS the executed rate.
      expect(lots[0].unit_cost_usd).toBeCloseTo(1.16, 6);

      const unified = unifiedRow(db, result.id);
      expect(unified.profit_usd).toBeCloseTo(50, 6);
      const meta = JSON.parse(unified.metadata_json);
      expect(meta.realized_profit_usd).toBe(0); // acquire only, nothing sold
      expect(result.realizedProfitUsd).toBeUndefined(); // no consume happened
    });
  });

  // ---------------------------------------------------------------------------
  // Consume (SELL): to_currency exotic
  // ---------------------------------------------------------------------------

  describe("consume — to_currency exotic", () => {
    it("direct SELL EUR for USD realizes a GAIN via FIFO against a pre-existing lot", () => {
      getExchangeLotRepository().createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 9999,
        qty: 2000,
        unitCostUsd: 1.09,
        acquiredAt: "2026-08-20 10:00:00",
      });

      const result = repo.createTransaction({
        fromCurrency: "USD",
        toCurrency: "EUR",
        amountIn: 1150,
        amountOut: 1000,
        leg1Rate: 1.15,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 999, // stale — replaced by the realized profit
        totalProfitUsd: 999,
      });

      expect(result.realizedProfitUsd).toBeCloseTo(60, 6); // 1000 * (1.15 - 1.09)
      expect(result.lotCoveredQty).toBe(1000);
      expect(result.lotMarketQty).toBe(0);

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBeCloseTo(60, 6);
      expect(ex.profit_usd).toBeCloseTo(60, 6);

      const unified = unifiedRow(db, result.id);
      expect(unified.profit_usd).toBeCloseTo(60, 6);
      const meta = JSON.parse(unified.metadata_json);
      expect(meta.realized_profit_usd).toBeCloseTo(60, 6);
      expect(meta.lot_covered_qty).toBe(1000);
      expect(meta.lot_market_qty).toBe(0);

      const lots = lotRows(db, "EUR");
      expect(lots[0].remaining_qty).toBe(1000);

      const settlements = settlementRows(db);
      expect(settlements).toHaveLength(1);
      expect(settlements[0].basis_source).toBe("LOT");
      expect(settlements[0].settled_by_table).toBe("exchange_transactions");
      expect(settlements[0].settled_by_id).toBe(result.id);
      expect(settlements[0].unit_cost_usd).toBeCloseTo(1.09, 6);
      expect(settlements[0].unit_proceeds_usd).toBeCloseTo(1.15, 6);
    });

    it("cross SELL EUR for LBP realizes a LOSS (Q10) — leg1's LBP spread profit stays KEPT", () => {
      seedRate(db, "EUR", 1.18, 1.16, 1.2, -1);
      seedRate(db, "LBP", 89500, 89000, 90000, 1);

      getExchangeLotRepository().createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 8888,
        qty: 500,
        unitCostUsd: 1.2,
        acquiredAt: "2026-08-20 10:00:00",
      });

      // Anchor priority (coordinator fix): fromCurrency === 'LBP' means U
      // (the shared cross USD notional) is derived ONLY from LBP's side —
      // amountIn / leg1Rate — never from EUR's leg2Rate. So amountIn must be
      // internally consistent with the targeted unitProceedsUsd (1.05, below
      // the lot's 1.20 cost): U = 1.05 * amountOut = 525; amountIn = U *
      // leg1Rate = 525 * 90000 = 47,250,000. leg2Rate is stored but UNUSED
      // by this anchored path — kept equal to the derived proceeds purely
      // for readability.
      const result = repo.createTransaction({
        fromCurrency: "LBP",
        toCurrency: "EUR",
        amountIn: 47_250_000,
        amountOut: 500,
        leg1Rate: 90000,
        leg1MarketRate: 89500,
        leg1ProfitUsd: 30, // KEPT — LBP is never lot-tracked
        leg2Rate: 1.05, // unused by the LBP-anchored path; see comment above
        leg2MarketRate: 1.18,
        leg2ProfitUsd: 999, // stale — replaced by the realized loss
        viaCurrency: "USD",
        totalProfitUsd: 1029,
      });

      expect(result.realizedProfitUsd).toBeCloseTo(-75, 6); // 500 * (1.05 - 1.20)
      expect(result.lotCoveredQty).toBe(500);
      expect(result.lotMarketQty).toBe(0);

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBeCloseTo(30, 6); // KEPT
      expect(ex.leg2_profit_usd).toBeCloseTo(-75, 6); // realized loss
      expect(ex.profit_usd).toBeCloseTo(-45, 6); // 30 + (-75)

      const unified = unifiedRow(db, result.id);
      expect(unified.profit_usd).toBeCloseTo(-45, 6);

      expect(lotRows(db, "EUR")[0].remaining_qty).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Oversell (Q6): MARKET slice + feed-only fallback
  // ---------------------------------------------------------------------------

  describe("oversell (Q6)", () => {
    it("prices the uncovered slice at the configured market rate, USD-normalized", () => {
      seedRate(db, "EUR", 1.18, 1.16, 1.2, -1);
      getExchangeLotRepository().createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 7777,
        qty: 200,
        unitCostUsd: 1.1,
        acquiredAt: "2026-08-20 10:00:00",
      });

      const result = repo.createTransaction({
        fromCurrency: "USD",
        toCurrency: "EUR",
        amountIn: 560,
        amountOut: 500, // 300 more than the 200 open — an oversell
        leg1Rate: 1.12,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 999,
        totalProfitUsd: 999,
      });

      expect(result.lotCoveredQty).toBe(200);
      expect(result.lotMarketQty).toBe(300);
      // 200 * (1.12 - 1.10) + 300 * (1.12 - 1.18) = 4 - 18 = -14
      expect(result.realizedProfitUsd).toBeCloseTo(-14, 6);

      const settlements = settlementRows(db);
      expect(settlements).toHaveLength(2);
      const lot = settlements.find((s) => s.basis_source === "LOT")!;
      const market = settlements.find((s) => s.basis_source === "MARKET")!;
      expect(lot.qty).toBe(200);
      expect(market.qty).toBe(300);
      expect(market.lot_id).toBeNull();
      expect(market.unit_cost_usd).toBeCloseTo(1.18, 6); // EUR market_rate, is_stronger=-1
    });

    it("falls back to unitProceedsUsd as the market basis (slice profit = 0) when the currency has NO configured exchange_rates row", () => {
      // Deliberately NO seedRate() call for CHF — a feed-only exotic.
      getExchangeLotRepository().createLot({
        currencyCode: "CHF",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 6666,
        qty: 100,
        unitCostUsd: 1.05,
        acquiredAt: "2026-08-20 10:00:00",
      });

      const result = repo.createTransaction({
        fromCurrency: "USD",
        toCurrency: "CHF",
        amountIn: 330,
        amountOut: 300, // 200 more than the 100 open
        leg1Rate: 1.1,
        leg1MarketRate: 1.1,
        leg1ProfitUsd: 999,
        totalProfitUsd: 999,
      });

      expect(result.lotCoveredQty).toBe(100);
      expect(result.lotMarketQty).toBe(200);
      // Covered slice: 100 * (1.10 - 1.05) = 5. Market slice falls back to
      // unitProceedsUsd itself as the basis -> exactly 0 profit on it.
      expect(result.realizedProfitUsd).toBeCloseTo(5, 6);

      const market = settlementRows(db).find(
        (s) => s.basis_source === "MARKET",
      )!;
      expect(market.unit_cost_usd).toBeCloseTo(1.1, 6); // == unitProceedsUsd
      expect(market.profit_usd).toBeCloseTo(0, 6);
    });
  });

  // ---------------------------------------------------------------------------
  // Exotic -> exotic cross: BOTH acquire and consume
  // ---------------------------------------------------------------------------

  describe("exotic -> exotic cross", () => {
    it("EUR -> GBP: acquires a EUR lot on leg1 AND consumes a GBP lot on leg2, independently stamped", () => {
      seedRate(db, "EUR", 1.18, 1.16, 1.2, -1);
      seedRate(db, "GBP", 1.28, 1.26, 1.3, -1);
      getExchangeLotRepository().createLot({
        currencyCode: "GBP",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 5555,
        qty: 500,
        unitCostUsd: 1.5,
        acquiredAt: "2026-08-20 10:00:00",
      });

      // Anchor priority (coordinator fix, case 3 — neither side is LBP): U is
      // derived from the FROM side (EUR, which has a rate row) FIRST: U =
      // amountIn * usdPerUnit(leg1Rate, EUR) = 800 * 1.25 = 1000. amountOut
      // must be internally consistent with that SAME U on the GBP side:
      // amountOut = U / usdPerUnit(leg2Rate, GBP) = 1000 / 2.0 = 500.
      const result = repo.createTransaction({
        fromCurrency: "EUR",
        toCurrency: "GBP",
        amountIn: 800,
        amountOut: 500,
        leg1Rate: 1.25,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 999, // stale -> 0 (acquire)
        leg2Rate: 2.0,
        leg2MarketRate: 1.28,
        leg2ProfitUsd: 999, // stale -> realized (consume)
        viaCurrency: "USD",
        totalProfitUsd: 999,
      });

      expect(result.realizedProfitUsd).toBeCloseTo(250, 6); // 500 * (2.0 - 1.5)
      expect(result.lotCoveredQty).toBe(500);
      expect(result.lotMarketQty).toBe(0);

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBeCloseTo(0, 6);
      expect(ex.leg2_profit_usd).toBeCloseTo(250, 6);
      expect(ex.profit_usd).toBeCloseTo(250, 6);

      const eurLots = lotRows(db, "EUR");
      expect(eurLots).toHaveLength(1);
      expect(eurLots[0].original_qty).toBe(800);
      expect(eurLots[0].remaining_qty).toBe(800);
      expect(eurLots[0].unit_cost_usd).toBeCloseTo(1.25, 6);

      const gbpLots = lotRows(db, "GBP");
      expect(gbpLots[0].remaining_qty).toBe(0); // fully consumed
    });
  });

  // ---------------------------------------------------------------------------
  // Feed-only exotics (no exchange_rates row) — the LBP anchor and the
  // skip-and-warn degradation (review fix: _usdPerUnitFromExecutedRate must
  // never throw — a feed-only currency like an open.er-api.com rate is
  // registered by ensureCurrency into currencies/currency_drawers ONLY,
  // never exchange_rates; the desktop form's addDirectTransaction path
  // computes such a currency's leg rates from the live feed, not this
  // table, so "no row" is normal here, not a data error).
  // ---------------------------------------------------------------------------

  describe("feed-only exotics (no exchange_rates row)", () => {
    it("cross LBP -> feed-only exotic: consumes FIFO via the LBP anchor, never via the exotic's (nonexistent) rate row", () => {
      seedRate(db, "LBP", 89500, 89000, 90000, 1);
      // Deliberately NO seedRate() for XAF — a feed-only exotic.
      getExchangeLotRepository().createLot({
        currencyCode: "XAF",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 3333,
        qty: 200,
        unitCostUsd: 4.5,
        acquiredAt: "2026-08-20 10:00:00",
      });

      // LBP anchor (fromCurrency === 'LBP'): U = amountIn / leg1Rate =
      // 90,000,000 / 90,000 = 1000. unitProceedsUsd = U / amountOut =
      // 1000 / 200 = 5.0 — leg2Rate is NEVER consulted (XAF has no rate row
      // to decode it with).
      const result = repo.createTransaction({
        fromCurrency: "LBP",
        toCurrency: "XAF",
        amountIn: 90_000_000,
        amountOut: 200,
        leg1Rate: 90000,
        leg1MarketRate: 89500,
        leg1ProfitUsd: 40, // KEPT — LBP is never lot-tracked
        leg2Rate: 999, // unused — XAF has no configured rate to decode it
        leg2MarketRate: 999,
        leg2ProfitUsd: 999, // stale — replaced by the realized profit
        viaCurrency: "USD",
        totalProfitUsd: 1039,
      });

      expect(result.realizedProfitUsd).toBeCloseTo(100, 6); // 200 * (5.0 - 4.5)
      expect(result.lotCoveredQty).toBe(200);
      expect(result.lotMarketQty).toBe(0);

      const settlements = settlementRows(db);
      expect(settlements).toHaveLength(1);
      expect(settlements[0].unit_proceeds_usd).toBeCloseTo(5.0, 6);
      expect(settlements[0].unit_cost_usd).toBeCloseTo(4.5, 6);

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBeCloseTo(40, 6); // KEPT
      expect(ex.leg2_profit_usd).toBeCloseTo(100, 6); // realized

      expect(lotRows(db, "XAF")[0].remaining_qty).toBe(0);
    });

    it("cross feed-only exotic -> LBP: opens a lot via the LBP anchor, leg1 profit stamped 0", () => {
      seedRate(db, "LBP", 89500, 89000, 90000, 1);
      // Deliberately NO seedRate() for XAF.

      // LBP anchor (toCurrency === 'LBP'): U = amountOut / leg2Rate =
      // 90,000,000 / 90,000 = 1000. unitCostUsd = U / amountIn =
      // 1000 / 1000 = 1.0 — leg1Rate is NEVER consulted (XAF has no rate row
      // to decode it with).
      const result = repo.createTransaction({
        fromCurrency: "XAF",
        toCurrency: "LBP",
        amountIn: 1000,
        amountOut: 90_000_000,
        leg1Rate: 999, // unused — XAF has no configured rate to decode it
        leg1MarketRate: 999,
        leg1ProfitUsd: 999, // stale — replaced by 0 (Q8)
        leg2Rate: 90000,
        leg2MarketRate: 89500,
        leg2ProfitUsd: 60, // KEPT — LBP is never lot-tracked
        viaCurrency: "USD",
        totalProfitUsd: 1059,
      });

      expect(result.realizedProfitUsd).toBeUndefined(); // acquire only

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBeCloseTo(0, 6);
      expect(ex.leg2_profit_usd).toBeCloseTo(60, 6); // KEPT

      const lots = lotRows(db, "XAF");
      expect(lots).toHaveLength(1);
      expect(lots[0].original_qty).toBe(1000);
      expect(lots[0].unit_cost_usd).toBeCloseTo(1.0, 6);
    });

    it("exotic <-> exotic with NEITHER side having a configured rate row: skips lot tracking entirely, keeps client-sent profits, and warns", () => {
      // Deliberately NO seedRate() for XAF or XOF — neither currency has any
      // anchor (not LBP, no rate row on either side).
      const warnSpy = jest
        .spyOn(exchangeLogger, "warn")
        .mockImplementation(
          () => undefined as unknown as ReturnType<typeof exchangeLogger.warn>,
        );

      const result = repo.createTransaction({
        fromCurrency: "XAF",
        toCurrency: "XOF",
        amountIn: 1000,
        amountOut: 900,
        leg1Rate: 1.0,
        leg1MarketRate: 1.0,
        leg1ProfitUsd: 12,
        leg2Rate: 1.1,
        leg2MarketRate: 1.1,
        leg2ProfitUsd: 8,
        viaCurrency: "USD",
        totalProfitUsd: 20,
      });

      expect(result.realizedProfitUsd).toBeUndefined();
      expect(result.lotCoveredQty).toBeUndefined();
      expect(result.lotMarketQty).toBeUndefined();

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBe(12); // untouched client value
      expect(ex.leg2_profit_usd).toBe(8); // untouched client value
      expect(ex.profit_usd).toBe(20);

      expect(countRows(db, "exchange_lots")).toBe(0);
      expect(countRows(db, "exchange_lot_settlements")).toBe(0);

      const unified = unifiedRow(db, result.id);
      const meta = JSON.parse(unified.metadata_json);
      expect(meta.realized_profit_usd).toBeUndefined(); // no lot keys added — touched=false

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ fromCurrency: "XAF", toCurrency: "XOF" }),
        expect.stringContaining("lot tracking skipped"),
      );

      warnSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // USD <-> LBP — byte-identical to pre-Phase-3 behavior
  // ---------------------------------------------------------------------------

  describe("USD <-> LBP — never lot-tracked (Q1)", () => {
    it("USD -> LBP: full row snapshot matches the client-sent spread values, zero lots, zero settlements", () => {
      const result = repo.createTransaction({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 8_950_000,
        leg1Rate: 89500,
        leg1MarketRate: 89500,
        leg1ProfitUsd: 5,
        totalProfitUsd: 5,
      });

      // bookedProfitUsd is ALWAYS present on success (re-read of the row's
      // final persisted profit_usd) — here that's the client-sent
      // leg1ProfitUsd (5) verbatim, since USD<->LBP is never lot-tracked.
      expect(result).toEqual({ id: result.id, bookedProfitUsd: 5 });

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBe(5);
      expect(ex.leg2_profit_usd).toBeNull();
      expect(ex.profit_usd).toBe(5);

      expect(countRows(db, "exchange_lots")).toBe(0);
      expect(countRows(db, "exchange_lot_settlements")).toBe(0);

      const unified = unifiedRow(db, result.id);
      expect(unified.profit_usd).toBe(5);
      const meta = JSON.parse(unified.metadata_json);
      expect(meta).toEqual({
        type: "BUY", // toCurrency !== USD
        from_currency: "USD",
        to_currency: "LBP",
        amount_in: 100,
        amount_out: 8_950_000,
        leg1_rate: 89500,
        leg2_rate: null,
        via_currency: null,
        total_profit_usd: 5,
      });
    });

    it("LBP -> USD: full row snapshot matches the client-sent spread values, zero lots, zero settlements", () => {
      const result = repo.createTransaction({
        fromCurrency: "LBP",
        toCurrency: "USD",
        amountIn: 8_950_000,
        amountOut: 100,
        leg1Rate: 89500,
        leg1MarketRate: 89500,
        leg1ProfitUsd: 5,
        totalProfitUsd: 5,
      });

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBe(5);
      expect(ex.profit_usd).toBe(5);
      expect(countRows(db, "exchange_lots")).toBe(0);
      expect(countRows(db, "exchange_lot_settlements")).toBe(0);

      const unified = unifiedRow(db, result.id);
      const meta = JSON.parse(unified.metadata_json);
      expect(meta).toEqual({
        type: "SELL", // toCurrency === USD
        from_currency: "LBP",
        to_currency: "USD",
        amount_in: 8_950_000,
        amount_out: 100,
        leg1_rate: 89500,
        leg2_rate: null,
        via_currency: null,
        total_profit_usd: 5,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // For-partner: lots move at trade time (Q13)
  // ---------------------------------------------------------------------------

  describe("for-partner", () => {
    it("a for-partner SELL of an exotic consumes lots immediately, same as a walk-in sell", () => {
      const partnerId = seedPartner(db);
      getExchangeLotRepository().createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 4444,
        qty: 1000,
        unitCostUsd: 1.1,
        acquiredAt: "2026-08-20 10:00:00",
      });

      const result = repo.createTransaction({
        fromCurrency: "USD",
        toCurrency: "EUR",
        amountIn: 605,
        amountOut: 500,
        leg1Rate: 1.21,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 999,
        totalProfitUsd: 999,
        partnerId,
        partnerMode: "FOR",
      });

      expect(result.realizedProfitUsd).toBeCloseTo(55, 6); // 500 * (1.21 - 1.10)

      const lots = lotRows(db, "EUR");
      expect(lots[0].remaining_qty).toBe(500); // consumed at trade time, not deferred

      const ex = exchangeRow(db, result.id);
      expect(ex.leg1_profit_usd).toBeCloseTo(55, 6);

      // The for-partner ledger DEBIT still books as usual (unaffected by lots).
      const ledgerRows = db
        .prepare("SELECT * FROM partner_ledger WHERE partner_id = ?")
        .all(partnerId) as { transaction_type: string; direction: string }[];
      expect(ledgerRows).toHaveLength(1);
      expect(ledgerRows[0].transaction_type).toBe("FOR_EXCHANGE");
      expect(ledgerRows[0].direction).toBe("DEBIT");
    });
  });

  // ---------------------------------------------------------------------------
  // Read-path projection unaffected (no new exchange_transactions columns)
  // ---------------------------------------------------------------------------

  describe("getHistory — projection unaffected", () => {
    it("returns exactly the pre-existing column set, no new columns leaked from the lot engine", () => {
      repo.createTransaction({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 50,
        amountOut: 4_475_000,
        leg1Rate: 89500,
        leg1MarketRate: 89500,
        leg1ProfitUsd: 2,
        totalProfitUsd: 2,
      });

      const rows = repo.getHistory();
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual(
        [
          "id",
          "type",
          "from_currency",
          "to_currency",
          "amount_in",
          "amount_out",
          "rate",
          "base_rate",
          "profit_usd",
          "leg1_rate",
          "leg1_market_rate",
          "leg1_profit_usd",
          "leg2_rate",
          "leg2_market_rate",
          "leg2_profit_usd",
          "via_currency",
          "client_name",
          "note",
          "created_at",
          "created_by",
          "edited_by",
          "edited_at",
          "is_refunded",
          "refunded_at",
        ].sort(),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Schema-validated submit path (EXCHANGE_LOT_SETTLEMENT.md "NEW named
  // follow-up", owner decision 2026-08-23: ENABLE backdating, no guard).
  //
  // Every real caller goes through `exchangeSubmitSchema.safeParse()` first —
  // the IPC handler (`exchange:add-transaction` -> `validatePayload`) and the
  // REST route (`POST /api/exchange/transactions` -> `validateRequest`) both
  // validate against this ONE schema before ever reaching
  // `ExchangeService.addDirectTransaction` / `ExchangeRepository.createTransaction`.
  // Every other test in this file calls `repo.createTransaction()` directly
  // with an already-typed `CreateExchangeData` object, which can never catch
  // a field the SCHEMA silently drops on the way in. This block mirrors the
  // transport boundary exactly: raw payload -> schema safeParse -> service.
  // ---------------------------------------------------------------------------

  describe("schema-validated submit path — transaction_time backdating", () => {
    it("a backdated BUY submitted through exchangeSubmitSchema stamps the exchange row + its lot at the backdated time, and the backdated lot wins FIFO over an existing later-acquired lot", () => {
      // Pre-existing lot: chronologically LATER (2026-08-20) but inserted
      // FIRST, so it has the LOWER id.
      const preexisting = getExchangeLotRepository().createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 9001,
        qty: 500,
        unitCostUsd: 1.3,
        acquiredAt: "2026-08-20T10:00:00.000Z",
      });

      // The raw wire payload — exactly what the Exchange page's backdate
      // override sends over IPC/REST (rule 19), including transaction_time.
      const rawBuyPayload = {
        fromCurrency: "EUR",
        toCurrency: "USD",
        amountIn: 1000,
        amountOut: 1160,
        leg1Rate: 1.16,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 20,
        totalProfitUsd: 20,
        transaction_time: "2026-08-01T08:00:00.000Z", // chronologically EARLIER
      };

      // Mirror validatePayload/validateRequest: safeParse through the SAME
      // schema both transports validate against before calling the service.
      const buyParse = exchangeSubmitSchema.safeParse(rawBuyPayload);
      expect(buyParse.success).toBe(true);
      if (!buyParse.success) return;

      // Mirror the IPC handler: parsed schema output -> service.addDirectTransaction.
      const service = new ExchangeService(repo);
      const buyResult = service.addDirectTransaction(
        buyParse.data as unknown as CreateExchangeData,
      );
      expect(buyResult.success).toBe(true);
      const buyId = buyResult.id!;

      const ex = exchangeRow(db, buyId);
      // FAILS pre-fix: exchangeSubmitSchema has no `transaction_time` field,
      // so zod's default "strip unknown keys" drops it during safeParse —
      // created_at falls back to CURRENT_TIMESTAMP instead of the backdated
      // value the operator submitted.
      expect(ex.created_at).toBe("2026-08-01T08:00:00.000Z");

      const eurLots = lotRows(db, "EUR");
      expect(eurLots).toHaveLength(2);
      const backdatedLot = eurLots.find((l) => l.source_id === buyId)!;
      // FAILS pre-fix for the same reason: the lot's acquired_at is read back
      // from the exchange row's created_at, which was never backdated.
      expect(backdatedLot.acquired_at).toBe("2026-08-01T08:00:00.000Z");

      // Now consume: a SELL of 500 EUR must draw FIFO from whichever lot has
      // the EARLIEST acquired_at — the backdated lot (2026-08-01), even
      // though the pre-existing lot (2026-08-20) was inserted first and has
      // the lower id. This is the "affects FIFO order by design" behavior
      // the plan doc documents as accepted, trusted, unguarded.
      const rawSellPayload = {
        fromCurrency: "USD",
        toCurrency: "EUR",
        amountIn: 575,
        amountOut: 500,
        leg1Rate: 1.15,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 999,
        totalProfitUsd: 999,
      };
      const sellParse = exchangeSubmitSchema.safeParse(rawSellPayload);
      expect(sellParse.success).toBe(true);
      if (!sellParse.success) return;
      const sellResult = service.addDirectTransaction(
        sellParse.data as unknown as CreateExchangeData,
      );
      expect(sellResult.success).toBe(true);

      // FIFO must have consumed the BACKDATED lot (unit_cost 1.16), NOT the
      // pre-existing later-acquired lot (unit_cost 1.30).
      const settlements = settlementRows(db);
      const sellSettlement = settlements.find(
        (s) => s.settled_by_id === sellResult.id,
      )!;
      expect(sellSettlement.unit_cost_usd).toBeCloseTo(1.16, 6);
      expect(sellSettlement.lot_id).toBe(backdatedLot.id);

      const refreshedPreexisting = db
        .prepare("SELECT remaining_qty FROM exchange_lots WHERE id = ?")
        .get(preexisting.id) as { remaining_qty: number };
      expect(refreshedPreexisting.remaining_qty).toBe(500); // untouched

      const refreshedBackdated = db
        .prepare("SELECT remaining_qty FROM exchange_lots WHERE id = ?")
        .get(backdatedLot.id) as { remaining_qty: number };
      expect(refreshedBackdated.remaining_qty).toBe(500); // 1000 - 500 consumed
    });
  });
});
