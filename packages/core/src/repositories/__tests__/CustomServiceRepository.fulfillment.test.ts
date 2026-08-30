/**
 * CustomServiceRepository — LIRA-155 fulfilment-status read/write tests.
 *
 * Covers the repository-layer half of the ticket: creating a service with an
 * initial `fulfillment_status`, projecting `fulfillment_status`/
 * `fulfilled_at` back out through `getById`/`getAll` (getColumns()), and
 * `updateFulfillmentStatus`'s mechanical write (rule 13 — no transition
 * policy lives here; see CustomServiceService.fulfillment.test.ts for the
 * policy-layer rejection tests).
 *
 * Test-schema-trap check (top-to-bottom read of
 * CustomServiceRepository.createService/getAll/getById/
 * updateFulfillmentStatus, including every helper they call unconditionally
 * for the paths exercised here — no product_id/voucher/partner/
 * CUSTOMER_ACCOUNT paths are exercised, matching
 * CustomServiceRepository.forPartner.test.ts's own enumeration, whose exact
 * table set this file copies verbatim):
 *   - custom_services   (INSERT by createService; SELECT by getById/getAll;
 *                         UPDATE by updateFulfillmentStatus — now WITH
 *                         fulfillment_status/fulfilled_at columns, the exact
 *                         gap this ticket's TEST-SCHEMA TRAP note warns
 *                         about: getColumns() projects both, so a schema
 *                         missing either kills every test in SETUP)
 *   - partners / partner_ledger / drawer_balances / transactions / payments /
 *     debt_ledger — present only because createService's unconditional
 *     unified-transaction + payment-branch code path touches them for a
 *     plain CASH sale; empty tables otherwise (mirrors forPartner.test.ts).
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema (identical to CustomServiceRepository.forPartner.test.ts) ──

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    -- createService resolves the acting user (audit/created_by). Omitting this
    -- table makes every call return {success:false, error:"no such table:
    -- users"} and the whole file dies in setup, which reads like a broken
    -- assertion rather than a missing table.
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
      fulfilled_at TEXT
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

    -- Empty on purpose: _cancelDebt (run by every void/refund) is not
    -- exercised by these tests, but createService's transaction branch
    -- doesn't need debt_ledger to exist here since none of these tests use
    -- CUSTOMER_ACCOUNT — kept anyway for parity with the sibling test files.
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

// ─── Mock the connection module ────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tableRowCount(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as {
    n: number;
  };
  return row.n;
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
  return row?.balance ?? 0;
}

describe("CustomServiceRepository — fulfilment status (LIRA-155)", () => {
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

  function createPaidService(fulfillment_status?: "ORDERED"): number {
    const result = repo.createService({
      description: "Travel insurance",
      cost_usd: 20,
      price_usd: 35,
      paid_by: "CASH",
      status: "completed",
      ...(fulfillment_status ? { fulfillment_status } : {}),
    } as any);
    if (!result.success || !result.id) {
      throw new Error(`createService failed: ${result.error}`);
    }
    return result.id;
  }

  describe("create", () => {
    it("defaults fulfillment_status/fulfilled_at to NULL when not supplied (ordinary, non-insurance service — unchanged behaviour)", () => {
      const id = createPaidService();
      const entity = repo.getById(id);
      expect(entity?.fulfillment_status).toBeNull();
      expect(entity?.fulfilled_at).toBeNull();
    });

    it("persists an explicit fulfillment_status ('ORDERED') and projects it through BOTH getById and getAll", () => {
      const id = createPaidService("ORDERED");

      expect(repo.getById(id)?.fulfillment_status).toBe("ORDERED");
      expect(repo.getById(id)?.fulfilled_at).toBeNull();

      const all = repo.getAll();
      const row = all.find((s) => s.id === id);
      expect(row?.fulfillment_status).toBe("ORDERED");
    });
  });

  describe("updateFulfillmentStatus", () => {
    it("writes the new status and leaves fulfilled_at NULL for a non-DELIVERED status", () => {
      const id = createPaidService("ORDERED");

      const updated = repo.updateFulfillmentStatus(id, "ISSUED");

      expect(updated?.fulfillment_status).toBe("ISSUED");
      expect(updated?.fulfilled_at).toBeNull();
      // Also visible on a fresh read, not just the returned value.
      expect(repo.getById(id)?.fulfillment_status).toBe("ISSUED");
    });

    it("stamps fulfilled_at with a real timestamp exactly when the status becomes DELIVERED", () => {
      const id = createPaidService("ORDERED");
      repo.updateFulfillmentStatus(id, "ISSUED");
      repo.updateFulfillmentStatus(id, "RECEIVED");

      const delivered = repo.updateFulfillmentStatus(id, "DELIVERED");

      expect(delivered?.fulfillment_status).toBe("DELIVERED");
      expect(delivered?.fulfilled_at).not.toBeNull();
      expect(typeof delivered?.fulfilled_at).toBe("string");
    });

    it("clears fulfilled_at back to NULL if the row is written to a non-DELIVERED status afterward", () => {
      // Repository method carries no transition policy (rule 13) — this
      // exercises the mechanical CASE-expression write directly, independent
      // of whether CustomServiceService would ever allow this particular
      // call (it would not: DELIVERED is terminal — see
      // CustomServiceService.fulfillment.test.ts).
      const id = createPaidService("ORDERED");
      repo.updateFulfillmentStatus(id, "DELIVERED");
      expect(repo.getById(id)?.fulfilled_at).not.toBeNull();

      const reverted = repo.updateFulfillmentStatus(id, "ISSUED");

      expect(reverted?.fulfillment_status).toBe("ISSUED");
      expect(reverted?.fulfilled_at).toBeNull();
    });

    it("moves NO money and touches NO drawer/ledger — payments, drawer_balances, and partner_ledger are byte-identical before and after", () => {
      const id = createPaidService("ORDERED");

      const before = {
        payments: tableRowCount(db, "payments"),
        partnerLedger: tableRowCount(db, "partner_ledger"),
        debtLedger: tableRowCount(db, "debt_ledger"),
        generalUsd: balance(db, "General", "USD"),
        cashUsd: balance(db, "CASH", "USD"),
      };

      repo.updateFulfillmentStatus(id, "ISSUED");
      repo.updateFulfillmentStatus(id, "RECEIVED");
      repo.updateFulfillmentStatus(id, "DELIVERED");

      const after = {
        payments: tableRowCount(db, "payments"),
        partnerLedger: tableRowCount(db, "partner_ledger"),
        debtLedger: tableRowCount(db, "debt_ledger"),
        generalUsd: balance(db, "General", "USD"),
        cashUsd: balance(db, "CASH", "USD"),
      };

      expect(after).toEqual(before);
    });

    it("returns null for a non-existent id without throwing", () => {
      expect(repo.updateFulfillmentStatus(999999, "ISSUED")).toBeNull();
    });
  });
});
