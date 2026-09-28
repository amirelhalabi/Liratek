/**
 * MaintenanceRepository — status history records the ACTING user (LIRA-246a)
 *
 * `maintenance_status_history.changed_by` was NULL for every change on web
 * (and, in practice, on desktop too) because `createJob`/`updateJob` called
 * `recordStatusChange(jobId, fromStatus, toStatus)` with no third argument —
 * the column was always written `NULL`. The acting user must be taken from
 * the JWT on REST and from the session on IPC, NEVER from the client body,
 * so the fix threads an `actorUserId` parameter through
 * `MaintenanceRepository.createJob`/`updateJob` (and `MaintenanceService.saveJob`
 * above them) down to `recordStatusChange`.
 *
 * Harness copied from the sibling `MaintenanceRepository.userFk.test.ts`
 * (same schema, same DB-mock pattern) — this suite only adds the
 * `changed_by` assertions that file didn't cover.
 *
 * Rule 17: proven to fail against the pre-fix repository — `createJob`/
 * `updateJob` didn't accept a third argument at all, so passing one is a
 * compile-time type error under ts-jest, and even a loosened call left
 * `changed_by` NULL at runtime.
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

const ADMIN_ID = 2;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

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
    , refunded_at TEXT DEFAULT NULL);
  `);

  db.prepare(
    "INSERT INTO users (id, username, role) VALUES (?, 'Admin', 'admin')",
  ).run(ADMIN_ID);

  return db;
}

describe("MaintenanceRepository — status history records the acting user (LIRA-246a)", () => {
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

  it("stamps changed_by with the acting user on job creation (first history row)", () => {
    const jobId = repo.createJob(
      { device_name: "iPhone 13", status: "Received" },
      ADMIN_ID,
    );

    const history = repo.getStatusHistory(jobId);
    expect(history).toHaveLength(1);
    expect(history[0].from_status).toBeNull();
    expect(history[0].to_status).toBe("Received");
    expect(history[0].changed_by).toBe(ADMIN_ID);
  });

  it("stamps changed_by with the acting user on a status transition", () => {
    const jobId = repo.createJob(
      { device_name: "iPhone 13", status: "Received" },
      ADMIN_ID,
    );

    repo.updateJob(
      jobId,
      { device_name: "iPhone 13", status: "In_Progress" },
      ADMIN_ID,
    );

    const history = repo.getStatusHistory(jobId);
    expect(history).toHaveLength(2);
    expect(history[1].to_status).toBe("In_Progress");
    expect(history[1].changed_by).toBe(ADMIN_ID);
  });

  it("never trusts a client-supplied actor id — the caller passes ONE explicit argument, not a body field", () => {
    // No third argument at all -> changed_by stays NULL (the documented,
    // safe default for "no actor known"), matching a caller that genuinely
    // has none (e.g. a legacy call site not yet updated).
    const jobId = repo.createJob({ device_name: "iPhone 13", status: "Received" });

    const history = repo.getStatusHistory(jobId);
    expect(history[0].changed_by).toBeNull();
  });
});
