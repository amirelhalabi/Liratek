/**
 * CustomServiceRepository — user_id FK on the stamped rows
 * (owner-reported: Services/custom-services "foreign key constraint failed"
 * for partner transactions)
 *
 * `custom_services.created_by` itself carries `FOREIGN KEY (created_by)
 * REFERENCES users(id)` (electron-app/create_db.sql), and so do the unified
 * `transactions.user_id` and `payments.created_by` columns it writes. The app
 * enables `PRAGMA foreign_keys = ON` (main.ts). `createService()` used to
 * default its `createdBy` parameter to the literal `1`, so on any database
 * whose admin is NOT user id 1 (here the only user is id 2) and no caller
 * supplies a userId, the INSERTs failed the FK — surfaced through
 * BaseRepository.execute() as "Statement execution failed" / "FOREIGN KEY
 * constraint failed".
 *
 * This harness reproduces the REAL schema conditions: foreign_keys ON, a
 * users FK on user_id/created_by (including directly on custom_services),
 * and NO user 1. Mirrors the scaffold in
 * FinancialServiceRepository.userFk.test.ts (the reference fix for this
 * exact bug class) and CustomServiceRepository.paymentLegs.test.ts (the
 * custom_services table shape).
 *
 * Rule 17: proven to FAIL on the pre-fix repository (createdBy defaulted to 1).
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";
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

const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE custom_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      status TEXT DEFAULT 'completed',
      client_id INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note TEXT,
      category TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 20000000);

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

describe("CustomServiceRepository — user_id FK on stamped rows", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new CustomServiceRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  it("creates a walk-in service (legacy no-legs path, no userId passed) with no FK violation when the only user is id 2 (not 1)", () => {
    // Pre-fix: createdBy defaulted to 1 -> "FOREIGN KEY constraint failed"
    // because there is no user id 1 in this database, and no caller thread a
    // real userId into createService().
    const res = repo.createService({
      description: "phone unlock",
      cost_usd: 5,
      cost_lbp: 0,
      price_usd: 20,
      price_lbp: 0,
      paid_by: "CASH",
      status: "completed",
    });
    expect(res.success).toBe(true);
  });

  it("stamps a real (admin) user id on custom_services.created_by — never a bare 1", () => {
    const res = repo.createService({
      description: "phone unlock",
      cost_usd: 5,
      cost_lbp: 0,
      price_usd: 20,
      price_lbp: 0,
      paid_by: "CASH",
      status: "completed",
    });

    const row = db
      .prepare(`SELECT created_by FROM custom_services WHERE id = ?`)
      .get(res.id) as { created_by: number };
    expect(row.created_by).toBe(ADMIN_ID);
  });

  it("stamps a real (admin) user id on the unified transaction and payment rows — never a bare 1", () => {
    const res = repo.createService({
      description: "phone unlock",
      cost_usd: 5,
      cost_lbp: 0,
      price_usd: 20,
      price_lbp: 0,
      paid_by: "CASH",
      status: "completed",
    });

    const txn = db
      .prepare(
        `SELECT user_id FROM transactions WHERE source_table='custom_services' AND source_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(res.id) as { user_id: number };
    expect(txn.user_id).toBe(ADMIN_ID);

    const badLegs = db
      .prepare(`SELECT COUNT(*) c FROM payments WHERE created_by IS NOT ?`)
      .get(ADMIN_ID) as { c: number };
    expect(badLegs.c).toBe(0);
  });

  it("an explicitly passed userId still wins over the fallback", () => {
    // A caller (e.g. a future IPC/REST path that threads the real actor) must
    // not be overridden by the fallback — the fallback only kicks in when no
    // userId is supplied.
    const res = repo.createService(
      {
        description: "phone unlock",
        cost_usd: 5,
        cost_lbp: 0,
        price_usd: 20,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      },
      ADMIN_ID,
    );

    const row = db
      .prepare(`SELECT created_by FROM custom_services WHERE id = ?`)
      .get(res.id) as { created_by: number };
    expect(row.created_by).toBe(ADMIN_ID);
  });
});
