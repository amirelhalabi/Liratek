/**
 * MaintenanceRepository — user_id FK on the stamped rows
 * (owner-reported: Maintenance "Statement execution failed" on payment)
 *
 * The unified `transactions` row and every `payments` row a maintenance
 * payment writes carry `FOREIGN KEY (…) REFERENCES users(id)`, and the app
 * enables `PRAGMA foreign_keys = ON` (main.ts). `processPayments()` used to
 * hardcode `createdBy = 1`, so on any database whose admin is NOT user id 1
 * (here the only user is id 2) the transactions/payments INSERTs failed the
 * FK — surfaced through BaseRepository.execute() as "Statement execution
 * failed".
 *
 * This harness reproduces the REAL schema conditions: foreign_keys ON, a
 * users FK on user_id/created_by, and NO user 1. Mirrors the scaffold in
 * FinancialServiceRepository.userFk.test.ts (the reference fix for this
 * exact bug class) and MaintenanceRepository.amountEditGate.test.ts (the
 * maintenance table shape).
 *
 * Rule 17: proven to FAIL on the pre-fix repository (createdBy hardcoded to 1).
 */

import Database from "better-sqlite3";
import { MaintenanceRepository } from "../MaintenanceRepository";
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_name TEXT,
      device_name TEXT NOT NULL,
      issue_description TEXT,
      cost_usd DECIMAL(10, 2) DEFAULT 0,
      price_usd DECIMAL(10, 2) DEFAULT 0,
      cost_lbp DECIMAL(15, 2) DEFAULT 0,
      price_lbp DECIMAL(15, 2) DEFAULT 0,
      discount_usd DECIMAL(10, 2) DEFAULT 0,
      final_amount_usd DECIMAL(10, 2) DEFAULT 0,
      final_amount_lbp DECIMAL(15, 2) DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      paid_usd DECIMAL(10, 2) DEFAULT 0,
      paid_lbp DECIMAL(15, 2) DEFAULT 0,
      exchange_rate DECIMAL(15, 2),
      status TEXT DEFAULT 'Received',
      paid_by TEXT DEFAULT 'CASH',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // The only user is id 2 — reproducing the reported DB (no user id 1).
  db.prepare(
    "INSERT INTO users (id, username, role) VALUES (?, 'Admin', 'admin')",
  ).run(ADMIN_ID);

  return db;
}

describe("MaintenanceRepository — user_id FK on stamped rows", () => {
  let db: Database.Database;
  let repo: MaintenanceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new MaintenanceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  function createFullyPaidJob(): number {
    return repo.createJob({
      device_name: "iPhone 13",
      issue_description: "Screen replacement",
      cost_usd: 20,
      price_usd: 50,
      final_amount_usd: 50,
      currency: "USD",
      paid_usd: 50,
      exchange_rate: 89000,
      status: "Completed",
      paid_by: "CASH",
    });
  }

  it("processes payment with no FK violation when the only user is id 2 (not 1)", () => {
    const jobId = createFullyPaidJob();

    // Pre-fix: hardcoded createdBy=1 -> "FOREIGN KEY constraint failed" because
    // there is no user id 1 in this database.
    expect(() =>
      repo.processPayments(
        jobId,
        [{ method: "CASH", currency_code: "USD", amount: 50 }],
        {
          currency: "USD",
          finalAmount: 50,
          profit: 30,
          exchangeRate: 89000,
          clientId: null,
        },
      ),
    ).not.toThrow();
  });

  it("stamps a real (admin) user id on the unified transaction — never a bare 1", () => {
    const jobId = createFullyPaidJob();

    repo.processPayments(
      jobId,
      [{ method: "CASH", currency_code: "USD", amount: 50 }],
      {
        currency: "USD",
        finalAmount: 50,
        profit: 30,
        exchangeRate: 89000,
        clientId: null,
      },
    );

    const txn = db
      .prepare(
        `SELECT user_id FROM transactions WHERE source_table='maintenance' AND source_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(jobId) as { user_id: number };
    expect(txn.user_id).toBe(ADMIN_ID);
  });

  it("stamps the same admin user id on the payment rows", () => {
    const jobId = createFullyPaidJob();

    repo.processPayments(
      jobId,
      [{ method: "CASH", currency_code: "USD", amount: 50 }],
      {
        currency: "USD",
        finalAmount: 50,
        profit: 30,
        exchangeRate: 89000,
        clientId: null,
      },
    );

    const badLegs = db
      .prepare(`SELECT COUNT(*) c FROM payments WHERE created_by IS NOT ?`)
      .get(ADMIN_ID) as { c: number };
    expect(badLegs.c).toBe(0);
  });
});
