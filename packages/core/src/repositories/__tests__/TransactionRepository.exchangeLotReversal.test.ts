/**
 * TransactionRepository — EXCHANGE_LOT_SETTLEMENT.md Phase 3 void/refund
 * reversal owner (rule 20).
 *
 * Two new pieces of wiring under test, both mirroring the LIRA-091
 * supplier-sibling template:
 *  - `_assertExchangeLotsVoidable` (Q12): refuses to void/refund an EXCHANGE
 *    whose acquired lot has already been partially/fully sold.
 *  - `_reverseExchangeLotEffects` (rule 20 reversal owner): a voided/refunded
 *    SELL restores what it consumed (`restoreSettlements`); a voided/refunded
 *    BUY voids its own (guard-proven untouched) lot (`voidLotsBySource`).
 *
 * Every scenario proves the invariant nets to 0 across lots, settlements,
 * drawers, and profit (ProfitRepository.getExchangeTotals, which excludes a
 * voided/refunded exchange_transactions row via `notRefunded` — the same
 * exclusion mechanism every other module's void/refund relies on).
 */

import Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository";
import { getExchangeLotRepository } from "../ExchangeLotRepository";
import { getTransactionRepository } from "../TransactionRepository";
import { getProfitRepository } from "../ProfitRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema (same shape as ExchangeRepository.lotSettlement.test.ts,
// proven compatible with the FULL void/refund path in
// ExchangeRepository.forPartner.test.ts) ───────────────────────────────────

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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'EUR', 0);
  `);

  return db;
}

// ─── Mock the connection module (same pattern as the other Exchange*.test.ts files) ──

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

const WIDE_RANGE: [string, string] = [
  "2020-01-01 00:00:00",
  "2030-01-01 23:59:59",
];

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

function unifiedTxnIdFor(db: Database.Database, exchangeId: number): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = 'exchange_transactions' AND source_id = ?`,
    )
    .get(exchangeId) as { id: number };
  return row.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lotFor(db: Database.Database, currencyCode: string): any {
  return db
    .prepare(`SELECT * FROM exchange_lots WHERE currency_code = ?`)
    .get(currencyCode);
}

function settlementsFor(
  db: Database.Database,
  settledById: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  return db
    .prepare(
      `SELECT * FROM exchange_lot_settlements WHERE settled_by_table = 'exchange_transactions' AND settled_by_id = ?`,
    )
    .all(settledById);
}

function countRows(db: Database.Database, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

describe("TransactionRepository — EXCHANGE lot void/refund reversal (EXCHANGE_LOT_SETTLEMENT.md Phase 3, rule 20)", () => {
  let db: Database.Database;
  let exchangeRepo: ExchangeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    exchangeRepo = new ExchangeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  /** BUY EUR with USD — opens a lot of `qty` at `unitCost`. */
  function buyEur(qty: number, unitCost: number): number {
    const amountOut = qty * unitCost;
    return exchangeRepo.createTransaction({
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: qty,
      amountOut,
      leg1Rate: unitCost,
      leg1MarketRate: unitCost,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
    }).id;
  }

  /** SELL EUR for USD — consumes `qty` of open EUR lots at `unitProceeds`. */
  function sellEur(qty: number, unitProceeds: number): number {
    const amountIn = qty * unitProceeds;
    return exchangeRepo.createTransaction({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amountIn,
      amountOut: qty,
      leg1Rate: unitProceeds,
      leg1MarketRate: unitProceeds,
      leg1ProfitUsd: 999, // overridden by the lot engine regardless
      totalProfitUsd: 999,
    }).id;
  }

  // ---------------------------------------------------------------------------
  // Void a SELL
  // ---------------------------------------------------------------------------

  describe("void a SELL", () => {
    it("restores the consumed quantity, flags the settlement refunded, and nets drawers + profit to 0", () => {
      const buyId = buyEur(1000, 1.16); // EUR lot: qty 1000 @ cost 1.16
      const drawersAfterBuy = {
        eur: balance(db, "General", "EUR"),
        usd: balance(db, "General", "USD"),
      };

      const sellId = sellEur(500, 1.15); // realizes 500 * (1.15 - 1.16) = -5
      expect(lotFor(db, "EUR").remaining_qty).toBe(500);
      expect(
        getProfitRepository().getExchangeTotals(...WIDE_RANGE).profit_usd,
      ).toBeCloseTo(-5, 6);

      const sellTxnId = unifiedTxnIdFor(db, sellId);
      getTransactionRepository().voidTransaction(sellTxnId, 1);

      // Lot fully restored — the SELL's own consumption is undone.
      expect(lotFor(db, "EUR").remaining_qty).toBe(1000);

      // Its settlement is flagged refunded.
      const settlements = settlementsFor(db, sellId);
      expect(settlements).toHaveLength(1);
      expect(settlements[0].is_refunded).toBe(1);

      // Drawers: the SELL's own create+void nets to 0 — back to exactly the
      // post-BUY-only state.
      expect(balance(db, "General", "EUR")).toBeCloseTo(drawersAfterBuy.eur, 6);
      expect(balance(db, "General", "USD")).toBeCloseTo(drawersAfterBuy.usd, 6);

      // Profit: the voided exchange_transactions row is excluded via
      // notRefunded — nets back to 0 (only the BUY's 0 remains).
      expect(
        getProfitRepository().getExchangeTotals(...WIDE_RANGE).profit_usd,
      ).toBeCloseTo(0, 6);

      // The BUY's lot no longer has any ACTIVE settlement against it —
      // voiding the BUY is now unblocked (proven end-to-end in the "void the
      // SELL first, then the BUY" describe below).
      expect(
        getExchangeLotRepository().hasActiveSettlementsAgainstSource({
          sourceTable: "exchange_transactions",
          sourceId: buyId,
        }),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Refund a SELL
  // ---------------------------------------------------------------------------

  describe("refund a SELL", () => {
    it("restores the consumed quantity, flags the settlement refunded, and nets drawers + profit to 0", () => {
      buyEur(1000, 1.16);
      const drawersAfterBuy = {
        eur: balance(db, "General", "EUR"),
        usd: balance(db, "General", "USD"),
      };

      const sellId = sellEur(500, 1.15);
      const sellTxnId = unifiedTxnIdFor(db, sellId);

      getTransactionRepository().refundTransaction(sellTxnId, 1);

      expect(lotFor(db, "EUR").remaining_qty).toBe(1000);
      const settlements = settlementsFor(db, sellId);
      expect(settlements[0].is_refunded).toBe(1);

      expect(balance(db, "General", "EUR")).toBeCloseTo(drawersAfterBuy.eur, 6);
      expect(balance(db, "General", "USD")).toBeCloseTo(drawersAfterBuy.usd, 6);

      expect(
        getProfitRepository().getExchangeTotals(...WIDE_RANGE).profit_usd,
      ).toBeCloseTo(0, 6);
    });
  });

  // ---------------------------------------------------------------------------
  // Void an unsettled BUY
  // ---------------------------------------------------------------------------

  describe("void an unsettled BUY", () => {
    it("voids the lot — FIFO no longer sees it — and nets drawers to 0", () => {
      const buyId = buyEur(1000, 1.16);
      expect(lotFor(db, "EUR").is_voided).toBe(0);

      const buyTxnId = unifiedTxnIdFor(db, buyId);
      getTransactionRepository().voidTransaction(buyTxnId, 1);

      expect(lotFor(db, "EUR").is_voided).toBe(1);

      // FIFO no longer sees the voided lot: a fresh consume falls entirely to
      // the MARKET (uncovered) slice.
      const consume = getExchangeLotRepository().consumeFifo({
        currencyCode: "EUR",
        qty: 100,
        unitProceedsUsd: 1.2,
        marketUnitCostUsd: 1.2,
        settledByTable: "exchange_transactions",
        settledById: 999_999,
      });
      expect(consume.coveredQty).toBe(0);
      expect(consume.marketQty).toBe(100);

      expect(balance(db, "General", "EUR")).toBeCloseTo(0, 6);
      expect(balance(db, "General", "USD")).toBeCloseTo(0, 6);
    });
  });

  // ---------------------------------------------------------------------------
  // Void/refund a PARTIALLY-SETTLED BUY — blocked
  // ---------------------------------------------------------------------------

  describe("void/refund a partially-settled BUY — blocked (Q12)", () => {
    it("void throws and writes nothing", () => {
      const buyId = buyEur(1000, 1.16);
      sellEur(500, 1.2); // partially settles the BUY's lot

      const buyTxnId = unifiedTxnIdFor(db, buyId);
      const txnCountBefore = countRows(db, "transactions");
      const lotBefore = { ...lotFor(db, "EUR") };

      expect(() =>
        getTransactionRepository().voidTransaction(buyTxnId, 1),
      ).toThrow(/already been partially or fully sold/);

      // Nothing was written: no reversal row, transaction status unchanged,
      // lot untouched.
      expect(countRows(db, "transactions")).toBe(txnCountBefore);
      const statusRow = db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(buyTxnId) as { status: string };
      expect(statusRow.status).toBe("ACTIVE");
      expect(lotFor(db, "EUR")).toEqual(lotBefore);
    });

    it("refund throws and writes nothing", () => {
      const buyId = buyEur(1000, 1.16);
      sellEur(500, 1.2);

      const buyTxnId = unifiedTxnIdFor(db, buyId);
      const txnCountBefore = countRows(db, "transactions");
      const lotBefore = { ...lotFor(db, "EUR") };

      expect(() =>
        getTransactionRepository().refundTransaction(buyTxnId, 1),
      ).toThrow(/already been partially or fully sold/);

      expect(countRows(db, "transactions")).toBe(txnCountBefore);
      expect(lotFor(db, "EUR")).toEqual(lotBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // Void the SELL first, then the BUY — succeeds
  // ---------------------------------------------------------------------------

  describe("void the SELL first, then the BUY", () => {
    it("succeeds once the settling SELL's settlement has been refunded", () => {
      const buyId = buyEur(1000, 1.16);
      const sellId = sellEur(500, 1.2);

      const sellTxnId = unifiedTxnIdFor(db, sellId);
      getTransactionRepository().voidTransaction(sellTxnId, 1);

      const buyTxnId = unifiedTxnIdFor(db, buyId);
      expect(() =>
        getTransactionRepository().voidTransaction(buyTxnId, 1),
      ).not.toThrow();

      expect(lotFor(db, "EUR").is_voided).toBe(1);
      expect(balance(db, "General", "EUR")).toBeCloseTo(0, 6);
      expect(balance(db, "General", "USD")).toBeCloseTo(0, 6);
    });
  });
});
