/**
 * FinancialServiceRepository — OMT/WHISH system RECEIVE must NOT self-post the
 * customer credit in a session (deferred) basket.
 *
 * A cash-out settled to CUSTOMER_ACCOUNT credits the customer's account. In a
 * customer-session basket the RECEIVE is a deferred, negative cart item that
 * nets into the basket, and the checkout emits a CUSTOMER_ACCOUNT OUT leg the
 * basket recorder turns into ONE session credit. Self-posting the credit here
 * too would DOUBLE-credit — the Binance/app-wallet and CASH payout paths were
 * already guarded with `!deferPayment`; the OMT/WHISH *system* RECEIVE branch
 * was not (v1.29.0 missed it). This guards the fix.
 *
 * The provider SYSTEM-drawer movement (what the provider owes the shop) is
 * KEPT even when deferred — only the CUSTOMER-side credit is skipped.
 *
 * Rule 17: proven to FAIL on the pre-fix code (addCredit was called in
 * deferred mode → the double-credit).
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

const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
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
    INSERT INTO clients (id, full_name, phone_number) VALUES (7, 'Cashout Client', '70123456');

    CREATE TABLE financial_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL, service_type TEXT NOT NULL, amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL, commission REAL DEFAULT 0,
      cost REAL DEFAULT 0, price REAL DEFAULT 0, paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER, client_name TEXT, reference_number TEXT, phone_number TEXT,
      omt_service_type TEXT, omt_fee REAL DEFAULT 0, whish_fee REAL DEFAULT 0,
      profit_rate REAL, pay_fee INTEGER DEFAULT 0, payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL, item_key TEXT, note TEXT,
      sender_name TEXT, sender_phone TEXT, receiver_name TEXT, receiver_phone TEXT,
      sender_client_id INTEGER, receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1, settled_at TEXT, settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, created_by INTEGER,
      paid_amount REAL DEFAULT NULL, paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER, partner_mode TEXT
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE', source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL, user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL, client_id INTEGER, client_name TEXT, client_phone TEXT,
      reverses_id INTEGER, profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0, summary TEXT, metadata_json TEXT,
      device_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER, session_id INTEGER,
      method TEXT NOT NULL, drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL,
      amount REAL NOT NULL, note TEXT, created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500, CURRENT_TIMESTAMP);

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, provider TEXT,
      is_active INTEGER DEFAULT 1, is_system INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL, amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0, note TEXT, created_by INTEGER,
      transaction_id INTEGER, is_auto INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT, key_name TEXT NOT NULL UNIQUE, value TEXT
    );
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);
  return db;
}

function omtSystemBalance(db: Database.Database): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name='OMT_System' AND currency_code='USD'",
    )
    .get() as { balance: number } | undefined;
  return row?.balance ?? 0;
}

const receivePayload = (deferPayment: boolean) => ({
  provider: "OMT" as const,
  serviceType: "RECEIVE" as const,
  amount: 100,
  currency: "USD",
  commission: 0,
  omtServiceType: "INTRA",
  cashoutMethod: "CUSTOMER_ACCOUNT" as const,
  clientId: 7,
  exchangeRate: 89000,
  deferPayment,
});

describe("FinancialServiceRepository — session RECEIVE credit guard", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("deferred (session) CUSTOMER_ACCOUNT RECEIVE does NOT self-post a credit (basket books it once)", () => {
    const omtBefore = omtSystemBalance(db);

    repo.createTransaction(receivePayload(true));

    // Pre-fix: addCredit was called here AND the basket credits the OUT leg →
    // double-credit. Post-fix: the item defers the credit to the basket.
    expect(mockAddCredit).not.toHaveBeenCalled();

    // The provider system drawer STILL moves (provider owes the shop) — only
    // the customer-side credit is deferred.
    // float model: RECEIVE fills the float back up by the BARE principal
    // ($100) only — commission/fee no longer touch the float leg at all
    // (the old `totalOwed = amount + commission` posting, and its sign, are
    // both gone; the float posting is now `+receiveAmount`, unconditional,
    // regardless of omtServiceType/commission/fee).
    // TODO(rule-17): prove failing-first — restore the old
    // `-(receiveAmount + |calculatedCommission|)` posting to make this red
    // again.
    expect(omtSystemBalance(db)).toBeCloseTo(omtBefore + 100, 2);
  });

  it("standalone CUSTOMER_ACCOUNT RECEIVE DOES self-post the credit (unchanged)", () => {
    repo.createTransaction(receivePayload(false));

    expect(mockAddCredit).toHaveBeenCalledTimes(1);
    expect(mockAddCredit).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 7, amountUsd: 100 }),
    );
  });
});
