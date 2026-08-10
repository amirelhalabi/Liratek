/**
 * DebtRepository — transactions.exchange_rate stamps the tendered rate
 * (owner decision, 2026-08-08)
 *
 * Same owner decision already applied to FinancialServiceRepository /
 * RechargeRepository (see their .stampedExchangeRate.test.ts siblings):
 * repayments/cash-outs never threaded ANY rate field, so
 * `TransactionRepository.createTransaction` always fell back to its own
 * live `snapshotExchangeRate()` (the `exchange_rates.market_rate` snapshot)
 * instead of what the operator actually tendered at the payment sheet.
 *
 * `resolveStampedExchangeRate` (moneyPosting.ts) is a non-throwing helper:
 * it prefers `tender_exchange_rate` when within `TENDER_RATE_BAND_PCT`
 * (±10%) of the server sell rate, else falls back to the server rate
 * silently — DebtRepository has NO `reconcileLegs` hard-reject anywhere
 * (confirmed: no leg-total-vs-expected check exists for repayments/cash-outs
 * today), so an out-of-band tender here can only ever affect the STAMP, never
 * throw.
 *
 * Covers BOTH call sites reachable from a payment-sheet form with an
 * editable rate (frontend/src/features/debts/pages/Debts/index.tsx wires the
 * SAME `repayModalRate` state into both `api.addRepayment` and
 * `api.cashOut`): `addRepayment` (DEBT_REPAYMENT) and `cashOutCredit`
 * (CREDIT_CASH_OUT). `_postDebtDiscount`/`writeOffDebt` (COUNTERPARTY_DISCOUNT
 * — amount_usd/amount_lbp always 0, no cash moves) and
 * `addAccountCashEntry` (CREDIT_CASH_IN/DEBT_CASH_OUT/ACCOUNT_ADJUSTMENT — the
 * Debts page's "Add Credit/Debt" modal has plain USD/LBP inputs, no
 * MultiPaymentInput/exchangeRate concept at all) are deliberately NOT
 * covered here — neither is reachable from an editable-rate payment sheet.
 *
 * FAILING-FIRST (rule 17): as of this file's introduction, DebtRepository
 * passes NO `exchange_rate` field to either `createTransaction` call at all
 * — every "stamps the tendered rate" assertion below fails pre-fix (the
 * transaction falls back to `snapshotExchangeRate()`'s `market_rate`, which
 * this fixture deliberately seeds to a THIRD, distinct value so a pre-fix
 * run can't accidentally coincide with the expected post-fix number).
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository";
import { resetTransactionRepository } from "../TransactionRepository";

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setDb } = require("../../db/connection");

// Server SELL rate (what getUsdLbpSellRate/resolveStampedExchangeRate anchor
// against) is 90,000. `market_rate` is deliberately a DIFFERENT value
// (91,111) so a pre-fix run — which stamps snapshotExchangeRate()'s
// market_rate — produces a visibly wrong number rather than coincidentally
// matching either the sell rate or the tendered rate under test.
const SELL_RATE = 90_000;
const MARKET_RATE_DECOY = 91_111;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (7, 'Rate Stamp Client');

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT DEFAULT 'SEND',
      amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      session_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_code TEXT NOT NULL DEFAULT 'USD',
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
    VALUES ('LBP', ${MARKET_RATE_DECOY}, ${SELL_RATE}, ${SELL_RATE}, 1);
  `);
  return db;
}

function lastTransactionExchangeRate(db: Database.Database): number {
  const row = db
    .prepare(`SELECT exchange_rate FROM transactions ORDER BY id DESC LIMIT 1`)
    .get() as { exchange_rate: number };
  return row.exchange_rate;
}

describe("DebtRepository — addRepayment stamps the tendered rate", () => {
  let db: Database.Database;
  let repo: DebtRepository;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    repo = new DebtRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("owner repro: server sell rate 90,000, tender_exchange_rate 89,000 — stamps 89,000, not 90,000 or the market-rate decoy", () => {
    repo.addRepayment({
      client_id: 7,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: 1,
      tender_exchange_rate: 89_000,
    });

    expect(lastTransactionExchangeRate(db)).toBe(89_000);
  });

  it("out-of-band tender (50,000 vs. server 90,000) stamps the server sell rate (90,000) — never throws (no reconcileLegs gate exists for repayments)", () => {
    expect(() =>
      repo.addRepayment({
        client_id: 7,
        amount_usd: 20,
        amount_lbp: 0,
        created_by: 1,
        tender_exchange_rate: 50_000,
      }),
    ).not.toThrow();

    expect(lastTransactionExchangeRate(db)).toBe(SELL_RATE);
  });

  it("no tender_exchange_rate at all: stamps the server sell rate (90,000), not the market-rate decoy — backward compatible", () => {
    repo.addRepayment({
      client_id: 7,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: 1,
    });

    expect(lastTransactionExchangeRate(db)).toBe(SELL_RATE);
  });
});

describe("DebtRepository — cashOutCredit stamps the tendered rate", () => {
  let db: Database.Database;
  let repo: DebtRepository;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    repo = new DebtRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("owner repro: server sell rate 90,000, tender_exchange_rate 89,000 — stamps 89,000", () => {
    repo.cashOutCredit({
      client_id: 7,
      amount_usd: 10,
      amount_lbp: 0,
      created_by: 1,
      tender_exchange_rate: 89_000,
    });

    expect(lastTransactionExchangeRate(db)).toBe(89_000);
  });

  it("no tender_exchange_rate at all: stamps the server sell rate (90,000) — backward compatible", () => {
    repo.cashOutCredit({
      client_id: 7,
      amount_usd: 10,
      amount_lbp: 0,
      created_by: 1,
    });

    expect(lastTransactionExchangeRate(db)).toBe(SELL_RATE);
  });
});
