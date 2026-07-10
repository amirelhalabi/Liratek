/**
 * FinancialServiceRepository — user_id FK on the stamped rows
 * (owner-reported, 2026-07-05: session checkout "Failed to process cart item
 * 'Katsh BILL — 200,000 LBP': Statement execution failed")
 *
 * The unified `transactions` row, every `payments` row, and any `debt_ledger`
 * row a financial transaction writes all carry `FOREIGN KEY (…) REFERENCES
 * users(id)`, and the app enables `PRAGMA foreign_keys = ON` (main.ts). The
 * repository used to hardcode `createdBy = 1`, so on any database whose admin
 * is NOT user id 1 (here the only user is id 2) the transactions INSERT failed
 * the FK — surfaced through BaseRepository.execute() as "Statement execution
 * failed". Recharge items processed fine because session checkout threads the
 * real user id for them; the financial branch did not.
 *
 * This harness reproduces the REAL schema conditions the existing financial
 * tests miss: foreign_keys ON, a users FK on user_id/created_by, and NO user 1.
 *
 * Rule 17: proven to FAIL on the pre-fix repository (createdBy hardcoded to 1).
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

const ADMIN_ID = 2; // real DB: admin is id 2, there is NO user 1

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON"); // matches electron-app/main.ts at runtime

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT
    );

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      partner_id INTEGER,
      partner_mode TEXT
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)   REFERENCES users(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',   'LBP', 5000000,  CURRENT_TIMESTAMP);

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('Katsh', 'Katsh', 0);

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
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT
    );
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);

  // The only user is id 2 — reproducing the reported DB (no user id 1).
  db.prepare("INSERT INTO users (id, username, role) VALUES (?, 'Admin', 'admin')").run(
    ADMIN_ID,
  );

  return db;
}

/** A Katsh BILL as session checkout replays it (deferred, cost/price flow). */
function katshBill(extra: Record<string, unknown> = {}) {
  return {
    provider: "Katsh" as const,
    serviceType: "BILL" as const,
    amount: 200000,
    currency: "LBP",
    commission: 0,
    cost: 200000,
    price: 200000,
    deferPayment: true,
    exchangeRate: 90000,
    ...extra,
  };
}

describe("FinancialServiceRepository — user_id FK on stamped rows", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  it("stamps the passed userId on the unified transaction (no FK violation)", () => {
    // Pre-fix: hardcoded createdBy=1 → "FOREIGN KEY constraint failed" because
    // there is no user id 1. Post-fix: the acting user (2) is stamped.
    const res = repo.createTransaction(katshBill({ userId: ADMIN_ID }));
    expect(res.id).toBeGreaterThan(0);

    const txn = db
      .prepare(
        `SELECT user_id FROM transactions WHERE source_table='financial_services' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { user_id: number };
    expect(txn.user_id).toBe(ADMIN_ID);
  });

  it("falls back to a real (admin) user id when none is passed — never a bare 1", () => {
    // A caller that forgets to thread userId must NOT reintroduce the FK crash:
    // the repository resolves an existing admin instead of the literal 1.
    const res = repo.createTransaction(katshBill());
    expect(res.id).toBeGreaterThan(0);

    const txn = db
      .prepare(
        `SELECT user_id FROM transactions WHERE source_table='financial_services' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { user_id: number };
    expect(txn.user_id).toBe(ADMIN_ID);
  });

  it("stamps the same user id on the payment (cost outflow) rows", () => {
    repo.createTransaction(katshBill({ userId: ADMIN_ID }));
    const badLegs = db
      .prepare(`SELECT COUNT(*) c FROM payments WHERE created_by IS NOT ?`)
      .get(ADMIN_ID) as { c: number };
    expect(badLegs.c).toBe(0);
  });
});
