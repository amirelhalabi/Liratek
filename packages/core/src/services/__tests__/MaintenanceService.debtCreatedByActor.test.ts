/**
 * MaintenanceService.saveJob -> MaintenanceRepository.processPayments —
 * the "Maintenance Debt" row's created_by (owner follow-up, 2026-09-28,
 * alongside LIRA-246a).
 *
 * The Debts history page now has a User column (LIRA-241). Every OTHER
 * `debt_ledger` writer already records the real acting user; this one
 * (`MaintenanceRepository.processPayments`'s `bookClientDebtCharge` call for
 * a CUSTOMER_ACCOUNT-charged maintenance checkout) hardcoded `createdBy:
 * null` — the comment on it said so explicitly ("the original hand-rolled
 * INSERT here never included that column"). A checkout charged to the
 * customer's account by user X therefore booked a debt row with no actor at
 * all, regardless of who actually ran the checkout.
 *
 * Fix: thread the real acting user through `processPayments` (the same
 * `actorUserId` already threaded to `createJob`/`updateJob` for
 * `changed_by`, LIRA-246a) — from the session on IPC, the JWT on REST, never
 * the client body — and use it for the debt row's `created_by` (and, since
 * it is the SAME resolved value `processPayments` already used to stamp the
 * transaction/payment rows via the guessed `resolveFallbackUserId()`, those
 * now get the real actor too instead of a guess).
 *
 * Harness copied from the sibling `MaintenanceService.customerAccount.test.ts`
 * (same schema/DB-mock pattern, which already exercises a CUSTOMER_ACCOUNT
 * checkout that books a debt_ledger row).
 *
 * Rule 17: proven to fail against the pre-fix repository — `created_by` on
 * the booked debt row was NULL regardless of which user ran the checkout.
 */

import Database from "better-sqlite3";
import { MaintenanceService } from "../MaintenanceService";
import { MaintenanceRepository } from "../../repositories/MaintenanceRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";

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

const USER_X = 5;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, tenant_id INTEGER DEFAULT 1, role TEXT);
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');
    INSERT INTO users (id, username, role) VALUES (${USER_X}, 'cashier-x', 'staff');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT, -- migration v194
      device_name TEXT NOT NULL,
      issue_description TEXT,
      cost_usd REAL DEFAULT 0,
      price_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      discount_usd REAL DEFAULT 0,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate REAL,
      status TEXT DEFAULT 'Received',
      paid_by TEXT DEFAULT 'CASH',
      note TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    ,
  parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
);

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

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
      transaction_time DATETIME,
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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'LBP', 0,    CURRENT_TIMESTAMP);
  `);
  return db;
}

describe("MaintenanceService.saveJob — Maintenance Debt row records the acting user", () => {
  let db: Database.Database;
  let service: MaintenanceService;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    service = new MaintenanceService(new MaintenanceRepository());
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("a CUSTOMER_ACCOUNT checkout run by user X stores created_by = X on the Maintenance Debt row", () => {
    const client = db
      .prepare(`INSERT INTO clients (full_name, phone_number) VALUES (?, ?)`)
      .run("Debt Actor Client", "70112233");
    const clientId = Number(client.lastInsertRowid);

    const res = service.saveJob(
      {
        device_name: "iPhone 12",
        client_id: clientId,
        client_name: "Debt Actor Client",
        client_phone: "70112233",
        cost_usd: 20,
        price_usd: 50,
        final_amount_usd: 50,
        currency: "USD",
        exchange_rate: 90000,
        status: "Delivered_Paid",
        payments: [
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 },
        ],
      },
      USER_X,
    );

    expect(res.success).toBe(true);

    const debtRow = db
      .prepare(
        `SELECT created_by FROM debt_ledger WHERE transaction_type = 'Maintenance Debt' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { created_by: number | null };
    expect(debtRow.created_by).toBe(USER_X);
  });

  it("falls back to a real (non-null-FK) user when no actor is known — never a client-supplied id", () => {
    const client = db
      .prepare(`INSERT INTO clients (full_name, phone_number) VALUES (?, ?)`)
      .run("No Actor Client", "70998877");
    const clientId = Number(client.lastInsertRowid);

    // No actorUserId argument at all — the untouched legacy call shape.
    const res = service.saveJob({
      device_name: "iPhone 12",
      client_id: clientId,
      client_name: "No Actor Client",
      client_phone: "70998877",
      cost_usd: 20,
      price_usd: 50,
      final_amount_usd: 50,
      currency: "USD",
      exchange_rate: 90000,
      status: "Delivered_Paid",
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 },
      ],
    });

    expect(res.success).toBe(true);
    const debtRow = db
      .prepare(
        `SELECT created_by FROM debt_ledger WHERE transaction_type = 'Maintenance Debt' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { created_by: number | null };
    // Falls back to a real user id (never null, never a guess outside the
    // users table) — this repo's resolveFallbackUserId() behavior, unchanged.
    expect(debtRow.created_by).not.toBeNull();
  });
});
