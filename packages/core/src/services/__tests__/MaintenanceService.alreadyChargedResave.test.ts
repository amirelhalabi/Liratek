/**
 * MaintenanceService — never charge a job twice (LIRA-258, POSTING_INTEGRITY_PLAN
 * item 2.6, POSTING_MAP gap G7, owner decision D8 2026-10-06):
 *
 *   "Never charge twice. Once a job has its payment transaction, saving again
 *    changes nothing about money. To change the payment, refund it first."
 *
 * The old "already paid?" gate counted `payments` rows. A job checked out
 * fully on CUSTOMER_ACCOUNT (no drawer leg) or deferred to a session basket
 * (basket owns the legs) has NO payments rows, so re-saving it as paid ran
 * processPayments again: a second MAINTENANCE transaction and a second
 * 'Maintenance Debt'. The gate must read the job's ACTIVE, unreversed
 * MAINTENANCE transaction instead, and every re-save must post nothing.
 */

import Database from "better-sqlite3";
import { MaintenanceService, type SaveJobParams } from "../MaintenanceService";
import { MaintenanceRepository } from "../../repositories/MaintenanceRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import {
  snapshotLedgers,
  expectPostings,
} from "../../repositories/testHelpers/postingAssert";

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

    -- Needed by maintenancePartsStock.restoreMaintenanceJobParts, which
    -- deleteJob() calls unconditionally: better-sqlite3 validates a prepared
    -- statement's referenced tables at prepare() time, even when the parts
    -- list is empty and the UPDATE is never executed.
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

function maintenanceTxnCount(db: Database.Database, jobId: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) n FROM transactions
          WHERE source_table = 'maintenance' AND source_id = ? AND type = 'MAINTENANCE'`,
      )
      .get(jobId) as { n: number }
  ).n;
}

function debtCount(db: Database.Database): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) n FROM debt_ledger WHERE transaction_type = 'Maintenance Debt'`,
      )
      .get() as { n: number }
  ).n;
}

function originalTxnId(db: Database.Database, jobId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions
          WHERE source_table = 'maintenance' AND source_id = ? AND type = 'MAINTENANCE'
          ORDER BY id ASC LIMIT 1`,
      )
      .get(jobId) as { id: number }
  ).id;
}

/** Mirrors a REAL refundTransaction(): original stays ACTIVE, an ACTIVE
 *  REFUND row points back at it, and the job is flagged is_refunded. Same
 *  shape as MaintenanceRepository.amountEditGate.test.ts's helper. */
function simulateRefund(db: Database.Database, jobId: number): void {
  const orig = originalTxnId(db, jobId);
  db.prepare(
    `INSERT INTO transactions (type, status, source_table, source_id, amount_usd, reverses_id)
     VALUES ('REFUND', 'ACTIVE', 'maintenance', ?, -50, ?)`,
  ).run(jobId, orig);
  db.prepare(`UPDATE maintenance SET is_refunded = 1 WHERE id = ?`).run(jobId);
}

/** Mirrors a REAL voidTransaction(): original flips to VOIDED and a
 *  permanently-ACTIVE same-type reversal row is inserted. */
function simulateVoid(db: Database.Database, jobId: number): void {
  const orig = originalTxnId(db, jobId);
  db.prepare(`UPDATE transactions SET status = 'VOIDED' WHERE id = ?`).run(orig);
  db.prepare(
    `INSERT INTO transactions (type, status, source_table, source_id, amount_usd, reverses_id)
     VALUES ('MAINTENANCE', 'ACTIVE', 'maintenance', ?, -50, ?)`,
  ).run(jobId, orig);
  db.prepare(`UPDATE maintenance SET is_refunded = 1 WHERE id = ?`).run(jobId);
}

const BASE: SaveJobParams = {
  device_name: "iPhone 12",
  client_name: "Twice Client",
  client_phone: "70258258",
  cost_usd: 20,
  price_usd: 50,
  final_amount_usd: 50,
  currency: "USD",
  exchange_rate: 90000,
};

const ON_ACCOUNT: SaveJobParams = {
  ...BASE,
  status: "Delivered_Paid",
  payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 }],
};

const CASH: SaveJobParams = {
  ...BASE,
  status: "Delivered_Paid",
  payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
};

const ALREADY_PAID = /already paid.*refund it first/i;

describe("MaintenanceService — never charge a job twice (LIRA-258 / D8)", () => {
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

  it("re-checking-out an on-account job posts nothing and says it is already paid", () => {
    const first = service.saveJob(ON_ACCOUNT);
    expect(first.success).toBe(true);
    const jobId = first.id!;
    expect(maintenanceTxnCount(db, jobId)).toBe(1);
    expect(debtCount(db)).toBe(1);

    const before = snapshotLedgers(db);
    const again = service.saveJob({ ...ON_ACCOUNT, id: jobId });

    expect(again.success).toBe(false);
    expect(again.error).toMatch(ALREADY_PAID);
    expectPostings(before, snapshotLedgers(db), {});
    expect(maintenanceTxnCount(db, jobId)).toBe(1);
    expect(debtCount(db)).toBe(1);
  });

  it("re-saving an on-account job WITHOUT payment lines saves status/notes and posts nothing", () => {
    const jobId = service.saveJob(ON_ACCOUNT).id!;

    const before = snapshotLedgers(db);
    const again = service.saveJob({
      ...BASE,
      id: jobId,
      status: "Delivered",
      note: "customer picked up",
    });

    expect(again.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {});
    expect(maintenanceTxnCount(db, jobId)).toBe(1);
    const job = db
      .prepare(`SELECT status, note FROM maintenance WHERE id = ?`)
      .get(jobId) as { status: string; note: string };
    expect(job).toEqual({ status: "Delivered", note: "customer picked up" });
  });

  it("re-submitting a session-deferred job does not create a second transaction", () => {
    const first = service.saveJob({ ...CASH, deferPayment: true });
    expect(first.success).toBe(true);
    const jobId = first.id!;
    expect(maintenanceTxnCount(db, jobId)).toBe(1);

    const before = snapshotLedgers(db);
    const again = service.saveJob({ ...CASH, id: jobId, deferPayment: true });

    expect(again.success).toBe(false);
    expect(again.error).toMatch(ALREADY_PAID);
    expectPostings(before, snapshotLedgers(db), {});
    expect(maintenanceTxnCount(db, jobId)).toBe(1);
  });

  it("re-checking-out a cash-paid job is refused with a clear message, not silently ignored", () => {
    const jobId = service.saveJob(CASH).id!;

    const before = snapshotLedgers(db);
    const again = service.saveJob({ ...CASH, id: jobId });

    expect(again.success).toBe(false);
    expect(again.error).toMatch(ALREADY_PAID);
    expectPostings(before, snapshotLedgers(db), {});
    expect(maintenanceTxnCount(db, jobId)).toBe(1);
  });

  it.each([
    ["refunded", simulateRefund],
    ["voided", simulateVoid],
  ])(
    "a %s job can be checked out again, and the earlier payment rows are kept",
    (_label, reverse) => {
      const jobId = service.saveJob(CASH).id!;
      const paymentsBefore = (
        db.prepare(`SELECT COUNT(*) n FROM payments`).get() as { n: number }
      ).n;
      expect(paymentsBefore).toBe(1);
      reverse(db, jobId);

      const before = snapshotLedgers(db);
      const again = service.saveJob({ ...CASH, id: jobId });

      expect(again.success).toBe(true);
      expectPostings(before, snapshotLedgers(db), {
        drawers: { "General|USD": 50 },
      });
      // processPayments used to DELETE every earlier payment row for the job
      // (without touching drawer balances) — history must survive.
      const paymentsAfter = (
        db.prepare(`SELECT COUNT(*) n FROM payments`).get() as { n: number }
      ).n;
      expect(paymentsAfter).toBe(2);

      // The job is live-paid again, so deleting it must be blocked (it must
      // not still read as "refunded").
      const del = service.deleteJob(jobId);
      expect(del.success).toBe(false);
      expect(del.error).toMatch(/refund or void/i);

      // And once re-charged, a further re-checkout is refused again.
      const third = service.saveJob({ ...CASH, id: jobId });
      expect(third.success).toBe(false);
      expect(third.error).toMatch(ALREADY_PAID);
    },
  );
});
