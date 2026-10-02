/**
 * CustomServiceRepository — LIRA-083 work-status read/write/filter tests.
 *
 * Covers the repository-layer half of the ticket: a new service always
 * defaults `work_status` to 'Received' (createService never threads it
 * through the INSERT — the DB column default does the work, see
 * migration v190's up()), `getAll`/`getById` project it, `updateWorkStatus`
 * is a mechanical write with NO transition-legality check (unlike
 * `updateFulfillmentStatus`), and `getAll({ workStatus })` filters by it.
 *
 * Schema/table set copied verbatim from
 * CustomServiceRepository.fulfillment.test.ts (same unconditional code path
 * — a plain CASH create, no product_id/voucher/partner/CUSTOMER_ACCOUNT),
 * with `work_status` added so the TEST-SCHEMA TRAP that file warns about
 * doesn't resurface here: getColumns() now projects `work_status`, so a
 * schema missing it would kill every test in SETUP.
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      username  TEXT,
      role      TEXT
    );
    INSERT INTO users (id, tenant_id, username, role) VALUES (1, 1, 'tester', 'admin');

    CREATE TABLE custom_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      paid_by TEXT NOT NULL DEFAULT 'CASH',
      status TEXT NOT NULL DEFAULT 'completed',
      client_id INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note TEXT,
      category TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      product_id INTEGER,
      partner_mode TEXT,
      fulfillment_status TEXT,
      fulfilled_at TEXT,
      direction TEXT NOT NULL DEFAULT 'IN',
      work_status TEXT NOT NULL DEFAULT 'Received'
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount    REAL NOT NULL DEFAULT 0,
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
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
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
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
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('CASH', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('CASH', 'LBP', 0);
  `);

  return db;
}

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

describe("CustomServiceRepository — work status (LIRA-083)", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function createService(): number {
    const result = repo.createService({
      description: "Official paper processing",
      cost_usd: 5,
      price_usd: 15,
      paid_by: "CASH",
      status: "completed",
    } as any);
    if (!result.success || !result.id) {
      throw new Error(`createService failed: ${result.error}`);
    }
    return result.id;
  }

  describe("create", () => {
    it("defaults work_status to 'Received' for a new row (the DB column default, not an explicit INSERT value)", () => {
      const id = createService();
      const entity = repo.getById(id);
      expect(entity?.work_status).toBe("Received");

      const all = repo.getAll();
      expect(all.find((s) => s.id === id)?.work_status).toBe("Received");
    });
  });

  describe("updateWorkStatus", () => {
    it("writes any of the four values with no transition-legality check (unlike updateFulfillmentStatus)", () => {
      const id = createService();

      // Skip straight to 'Delivered' — illegal for fulfillment_status, legal
      // here by design (CustomServiceService.setWorkStatus's doc comment).
      let updated = repo.updateWorkStatus(id, "Delivered");
      expect(updated?.work_status).toBe("Delivered");

      // And back to an earlier step — also legal here.
      updated = repo.updateWorkStatus(id, "In_Progress");
      expect(updated?.work_status).toBe("In_Progress");
      expect(repo.getById(id)?.work_status).toBe("In_Progress");
    });

    it("returns null for a non-existent id without throwing", () => {
      expect(repo.updateWorkStatus(999999, "Ready")).toBeNull();
    });
  });

  describe("getAll workStatus filter", () => {
    it("returns only rows matching the requested work_status", () => {
      const receivedId = createService();
      const readyId = createService();
      repo.updateWorkStatus(readyId, "Ready");

      const ready = repo.getAll({ workStatus: "Ready" });
      expect(ready.map((s) => s.id)).toEqual([readyId]);

      const received = repo.getAll({ workStatus: "Received" });
      expect(received.map((s) => s.id)).toEqual([receivedId]);
    });
  });
});
