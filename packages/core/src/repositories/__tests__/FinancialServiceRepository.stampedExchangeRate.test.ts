/**
 * FinancialServiceRepository — transactions.exchange_rate stamp reflects the
 * operator's tendered rate (owner decision, 2026-08-08)
 *
 * Owner repro: an OMT/WHISH transaction tendered at 89,000 stamped
 * `transactions.exchange_rate` as 90,000 (the live configured sell rate)
 * instead — `stampedExchangeRate` was used for BOTH the leg-reconciliation
 * anchor AND the stamp, and `data.tender_exchange_rate` was never consulted
 * for the stamp at all. Owner decision: the STAMP should reflect what was
 * actually tendered, when that's a plausible edit (within
 * `TENDER_RATE_BAND_PCT`, ±10%, of the server rate) — but the reconciliation
 * safety net (which still anchors at the server rate and still hard-rejects
 * an implausible tender rate) must not be touched or weakened. See
 * FinancialServiceRepository.legReconciliation.test.ts for the
 * band-reject/reconcile proofs, which stay green and unmodified in
 * substance (only the one stamp-value assertion there was corrected to
 * match this new behavior).
 *
 * Every payment leg here is USD-only so leg reconciliation is
 * rate-independent (division by rate only enters for LBP legs) — isolating
 * the STAMP behavior under test from any reconciliation math.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER REFERENCES clients(id),
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key TEXT,
      note TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD',  1000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP',  100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',      'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App',    'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Binance',      'USDT', 500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'LBP',  100000000, CURRENT_TIMESTAMP);
  `);

  return db;
}

function lastTransactionExchangeRate(db: Database.Database): number {
  const row = db
    .prepare(`SELECT exchange_rate FROM transactions ORDER BY id DESC LIMIT 1`)
    .get() as { exchange_rate: number };
  return row.exchange_rate;
}

describe("FinancialServiceRepository — transactions.exchange_rate stamps the tendered rate (2026-08-08 owner decision)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("owner repro: OMT SEND, server sell rate 90,000, tender_exchange_rate 89,000 — stamps 89,000, not 90,000", () => {
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 10,
      currency: "USD",
      commission: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      exchangeRate: 90000,
      tender_exchange_rate: 89000,
    });

    expect(lastTransactionExchangeRate(db)).toBe(89000);
  });

  it("WHISH SEND — same tender-wins-within-band behavior for the sibling provider", () => {
    // WHISH is the SECONDARY system by default (shop_base_system defaults to
    // OMT) — a walk-in transaction against a secondary provider is rejected
    // outright by an unrelated guard. Seed WHISH as the primary system (same
    // workaround FinancialServiceRepository.crossCurrencyTender.test.ts uses)
    // so this test isolates the stamp behavior, not that guard.
    db.exec(
      `INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'WHISH')`,
    );

    repo.createTransaction({
      provider: "WHISH",
      serviceType: "SEND",
      amount: 10,
      currency: "USD",
      commission: 0,
      whishFee: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      exchangeRate: 90000,
      tender_exchange_rate: 89000,
    });

    expect(lastTransactionExchangeRate(db)).toBe(89000);
  });

  it("out-of-band tender (50,000 vs. server 90,000) still stamps the server rate (90,000) — never throws", () => {
    // deferPayment skips leg reconciliation entirely for this branch (the
    // session-basket case) — used here purely to isolate the STAMP's
    // fallback behavior from the (unmodified, still-active) reconciliation
    // hard-reject, which legitimately still throws on a genuinely
    // out-of-band tender rate whenever reconciliation actually runs (see
    // FinancialServiceRepository.legReconciliation.test.ts's "REJECTS a
    // tender_exchange_rate outside the ±10% band" cases — untouched).
    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0,
        deferPayment: true,
        exchangeRate: 90000,
        tender_exchange_rate: 50000,
      }),
    ).not.toThrow();

    expect(lastTransactionExchangeRate(db)).toBe(90000);
  });

  it("no tender_exchange_rate at all: stamps the server rate exactly as before (backward compatible)", () => {
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 10,
      currency: "USD",
      commission: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      exchangeRate: 90000,
    });

    expect(lastTransactionExchangeRate(db)).toBe(90000);
  });

  it("RECEIVE payout — the same tender-wins-within-band stamp behavior applies", () => {
    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 10,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      exchangeRate: 90000,
      tender_exchange_rate: 89000,
    });

    expect(lastTransactionExchangeRate(db)).toBe(89000);
  });
});
