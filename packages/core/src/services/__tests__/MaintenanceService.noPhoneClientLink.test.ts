/**
 * MaintenanceService.saveJob — no auto-create/name-match without a phone
 * (LIRA-246c)
 *
 * A repair job submitted with a client NAME but no phone used to call
 * `MaintenanceRepository.findOrCreateClient(name, phone)`, which matches an
 * EXISTING client by `full_name` alone (phone is only used on the INSERT
 * branch, never the lookup). Two different walk-in customers who happen to
 * share a common name (or a typo that collides with an existing client) were
 * silently merged onto the SAME client record.
 *
 * Fix: only auto-create/match when a phone is actually present. With no
 * phone, `client_id` stays null and `client_name` is kept as free text only
 * (no lookup, no INSERT). An explicitly chosen `client_id` (rule 11 — the
 * user picked a real client) is always kept regardless of phone.
 *
 * Harness copied from the sibling `MaintenanceService.customerAccount.test.ts`
 * (same schema/DB-mock pattern).
 *
 * Rule 17: proven to fail against the pre-fix service — a same-named walk-in
 * with no phone landed on the PRE-EXISTING client's id instead of staying
 * `null`.
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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, tenant_id INTEGER DEFAULT 1, role TEXT);
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

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

    -- Needed by maintenancePartsStock.restoreMaintenanceJobParts / syncParts,
    -- which prepare a statement against this table even with an empty parts
    -- list (better-sqlite3 validates referenced tables at prepare() time).
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

describe("MaintenanceService.saveJob — no-phone client auto-link (LIRA-246c)", () => {
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

  it("does NOT name-match an existing client when no phone is typed", () => {
    const existing = db
      .prepare(`INSERT INTO clients (full_name, phone_number) VALUES (?, ?)`)
      .run("John Doe", "70000000");
    const existingId = Number(existing.lastInsertRowid);

    const res = service.saveJob({
      device_name: "iPhone 12",
      client_name: "John Doe", // same name as the existing client
      // no client_phone at all
      cost_usd: 10,
      price_usd: 20,
      final_amount_usd: 20,
      currency: "USD",
      status: "Received",
    });

    expect(res.success).toBe(true);
    const job = db
      .prepare(`SELECT client_id, client_name FROM maintenance WHERE id = ?`)
      .get(res.id) as { client_id: number | null; client_name: string | null };
    expect(job.client_id).toBeNull();
    expect(job.client_name).toBe("John Doe");

    // No new client row created either.
    const clientCount = db
      .prepare(`SELECT COUNT(*) AS c FROM clients`)
      .get() as { c: number };
    expect(clientCount.c).toBe(1);
    expect(existingId).toBeGreaterThan(0); // the pre-seeded row, untouched
  });

  it("still auto-creates/matches a client when a phone IS given", () => {
    const res = service.saveJob({
      device_name: "iPhone 12",
      client_name: "Jane Doe",
      client_phone: "71112222",
      cost_usd: 10,
      price_usd: 20,
      final_amount_usd: 20,
      currency: "USD",
      status: "Received",
    });

    expect(res.success).toBe(true);
    const job = db
      .prepare(`SELECT client_id FROM maintenance WHERE id = ?`)
      .get(res.id) as { client_id: number | null };
    expect(job.client_id).not.toBeNull();
  });

  it("keeps an explicitly chosen client_id even with no phone (rule 11)", () => {
    const existing = db
      .prepare(`INSERT INTO clients (full_name) VALUES ('Explicit Client')`)
      .run();
    const clientId = Number(existing.lastInsertRowid);

    const res = service.saveJob({
      device_name: "iPhone 12",
      client_id: clientId,
      client_name: "Explicit Client",
      cost_usd: 10,
      price_usd: 20,
      final_amount_usd: 20,
      currency: "USD",
      status: "Received",
    });

    expect(res.success).toBe(true);
    const job = db
      .prepare(`SELECT client_id FROM maintenance WHERE id = ?`)
      .get(res.id) as { client_id: number | null };
    expect(job.client_id).toBe(clientId);
  });
});
