/**
 * FinancialServiceRepository — C4: app-wallet transfers move the app drawer
 *
 * OMT_APP / WHISH_APP transfers (no cost/price pair) must move money like
 * Binance, the reference implementation:
 *   SEND:    wallet drawer −amount, cash drawer +(amount + fee)
 *   RECEIVE: wallet drawer +amount, cash drawer −(amount − fee)
 *
 * Pre-C4 they fell through to the generic single-drawer path: SEND never
 * touched the app drawer (the shop's app balance silently never decreased)
 * and RECEIVE credited the paid-by drawer instead of paying the customer out.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

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

// ─── Mock DebtService (only used by CUSTOMER_ACCOUNT cashout) ────────────────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema (mirrors the receiveSplitPayout test) ──────────────────

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
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))
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

    INSERT INTO drawer_balances VALUES (1, 'General',   'USD',  1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',   'LBP',  100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',   'USD',  500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App', 'USD',  500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Binance',   'USDT', 500,  CURRENT_TIMESTAMP);
  `);

  return db;
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
  return row ? row.balance : 0;
}

describe("FinancialServiceRepository — C4: app-wallet transfers move the app drawer", () => {
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

  it("OMT_APP SEND: app drawer −20, General +20", () => {
    const appBefore = balance(db, "OMT_App", "USD");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(appBefore - 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore + 20, 2);
  });

  it("OMT_APP RECEIVE: app drawer +20, General −20", () => {
    const appBefore = balance(db, "OMT_App", "USD");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "OMT_APP",
      serviceType: "RECEIVE",
      amount: 20,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(appBefore + 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore - 20, 2);
  });

  it("WHISH_APP SEND: app drawer −20, General +20", () => {
    const appBefore = balance(db, "Whish_App", "USD");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(appBefore - 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore + 20, 2);
  });

  it("WHISH_APP RECEIVE with commission: app +20, General −(20 − commission)", () => {
    const appBefore = balance(db, "Whish_App", "USD");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 20,
      currency: "USD",
      commission: 0.02, // shop profit withheld from the payout
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(appBefore + 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore - 19.98, 2);
  });

  it("BINANCE control: SEND unchanged (Binance USDT −20, General USD +20)", () => {
    const binBefore = balance(db, "Binance", "USDT");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 20,
      currency: "USDT",
      commission: 0,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "Binance", "USDT")).toBeCloseTo(binBefore - 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore + 20, 2);
  });
});
