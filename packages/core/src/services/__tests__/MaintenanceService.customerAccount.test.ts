/**
 * MaintenanceService — CUSTOMER_ACCOUNT checkout writes to debt_ledger (B3)
 *
 * A maintenance job checked out on the customer's account must increase what
 * the client owes: a debt_ledger row for the unpaid (account-charged) amount,
 * linked to the job's unified transaction. B3 reported the customer-account
 * leg silently dropping — the job read as paid while the client owed nothing.
 */

import Database from "better-sqlite3";
import { MaintenanceService } from "../MaintenanceService";
import { MaintenanceRepository } from "../../repositories/MaintenanceRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

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
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, tenant_id INTEGER DEFAULT 1);
    INSERT INTO users (id, username) VALUES (1, 'admin');

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

function debtRows(db: Database.Database) {
  return db
    .prepare(`SELECT * FROM debt_ledger ORDER BY id ASC`)
    .all() as Array<{
    client_id: number;
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    transaction_id: number | null;
  }>;
}

describe("MaintenanceService — CUSTOMER_ACCOUNT checkout (B3)", () => {
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

  it("full CUSTOMER_ACCOUNT payment writes a debt_ledger row for the full amount", () => {
    const res = service.saveJob({
      device_name: "iPhone 12",
      client_name: "B3 Client",
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
    });
    expect(res.success).toBe(true);

    const rows = debtRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction_type).toBe("Maintenance Debt");
    expect(rows[0].amount_usd).toBeCloseTo(50, 2);
    expect(rows[0].amount_lbp).toBe(0);
    expect(rows[0].transaction_id).not.toBeNull();

    // No drawer movement for an on-account job.
    const general = db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE drawer_name='General' AND currency_code='USD'`,
      )
      .get() as { balance: number };
    expect(general.balance).toBeCloseTo(1000, 2);
  });

  it("split CASH + CUSTOMER_ACCOUNT books only the account share as debt", () => {
    const res = service.saveJob({
      device_name: "Samsung A52",
      client_name: "B3 Split Client",
      client_phone: "70445566",
      price_usd: 80,
      final_amount_usd: 80,
      currency: "USD",
      exchange_rate: 90000,
      status: "Delivered_Paid",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 30 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 },
      ],
    });
    expect(res.success).toBe(true);

    const rows = debtRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_usd).toBeCloseTo(50, 2);
  });

  it("fully cash-paid job writes NO debt row", () => {
    const res = service.saveJob({
      device_name: "Pixel 7",
      client_name: "B3 Cash Client",
      client_phone: "70778899",
      price_usd: 40,
      final_amount_usd: 40,
      currency: "USD",
      exchange_rate: 90000,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 40 }],
    });
    expect(res.success).toBe(true);
    expect(debtRows(db)).toHaveLength(0);
  });
});

describe("MaintenanceService — deleteJob semantics (owner feedback 2026-07-03)", () => {
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

  it("deleting an unpaid draft is a PURE status change — no voiding, no reversal rows", () => {
    const created = service.saveJob({
      device_name: "Draft phone",
      issue_description: "screen",
      client_name: "Del Draft",
      price_usd: 30,
      final_amount_usd: 30,
      currency: "USD",
      status: "Received", // draft: never paid, no transaction
    });
    expect(created.success).toBe(true);
    const txnsBefore = db
      .prepare(`SELECT COUNT(*) n FROM transactions`)
      .get() as { n: number };

    const res = service.deleteJob(created.id!);
    expect(res.success).toBe(true);

    const job = db
      .prepare(`SELECT status FROM maintenance WHERE id = ?`)
      .get(created.id) as { status: string };
    expect(job.status).toBe("Deleted");
    // NOTHING happened on the money side: no new (reversal) transactions.
    const txnsAfter = db
      .prepare(`SELECT COUNT(*) n FROM transactions`)
      .get() as { n: number };
    expect(txnsAfter.n).toBe(txnsBefore.n);
    // And the deleted job is hidden from the default list.
    const listed = service.getJobs() as Array<{ id: number }>;
    expect(listed.find((j) => j.id === created.id)).toBeUndefined();
  });

  it("deleting a PAID job is blocked — its transaction stays ACTIVE and untouched", () => {
    const created = service.saveJob({
      device_name: "Paid phone",
      issue_description: "battery",
      client_name: "Del Paid",
      client_phone: "70123123",
      cost_usd: 5,
      price_usd: 12,
      final_amount_usd: 12,
      currency: "USD",
      exchange_rate: 90000,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 12 }],
    });
    expect(created.success).toBe(true);

    const res = service.deleteJob(created.id!);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/refund or void/i);

    // Pre-fix behavior: the txn was voided AND a −12 reversal row appeared.
    const txn = db
      .prepare(
        `SELECT status FROM transactions WHERE source_table='maintenance' AND source_id = ?`,
      )
      .get(created.id) as { status: string };
    expect(txn.status).toBe("ACTIVE");
    const reversals = db
      .prepare(`SELECT COUNT(*) n FROM transactions WHERE amount_usd < 0`)
      .get() as { n: number };
    expect(reversals.n).toBe(0);
  });
});

// ─── note 14 — thin-summary enrichment ────────────────────────────────────────
//
// MaintenanceRepository.processPayments used to stamp only
// "Maintenance Job #N: $X" / "...LBP" — the job's device/issue never made it
// into the Transactions page summary even though `maintenance.device_name`/
// `issue_description` are right there on the row. Appended after the existing
// prefix (never restructured — some test/e2e specs may match on the prefix).

describe("MaintenanceService — thin summary enrichment (note 14)", () => {
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

  function summaryFor(jobId: number): string {
    const row = db
      .prepare(
        `SELECT summary FROM transactions WHERE source_table='maintenance' AND source_id = ?`,
      )
      .get(jobId) as { summary: string };
    return row.summary;
  }

  it("appends device name + issue description after the existing prefix", () => {
    const res = service.saveJob({
      device_name: "iPhone 12",
      issue_description: "screen replacement",
      client_name: "Summary Client",
      client_phone: "70999888",
      cost_usd: 20,
      price_usd: 40,
      final_amount_usd: 40,
      currency: "USD",
      exchange_rate: 90000,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 40 }],
    });
    expect(res.success).toBe(true);

    const summary = summaryFor(res.id!);
    // Prefix stays byte-identical (prefix-matching specs must not break).
    expect(summary.startsWith("Maintenance Job #")).toBe(true);
    expect(summary).toContain("$40");
    expect(summary).toContain("iPhone 12");
    expect(summary).toContain("screen replacement");
  });

  it("LBP job appends device + issue after the LBP prefix", () => {
    const res = service.saveJob({
      device_name: "Samsung A52",
      issue_description: "battery swap",
      client_name: "LBP Client",
      client_phone: "70999777",
      cost_lbp: 900000,
      price_lbp: 1800000,
      final_amount_lbp: 1800000,
      currency: "LBP",
      exchange_rate: 90000,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "LBP", amount: 1800000 }],
    });
    expect(res.success).toBe(true);

    const summary = summaryFor(res.id!);
    expect(summary.startsWith("Maintenance Job #")).toBe(true);
    expect(summary).toContain("LBP");
    expect(summary).toContain("Samsung A52");
    expect(summary).toContain("battery swap");
  });

  it("handles a missing issue_description gracefully — no dangling separator", () => {
    const res = service.saveJob({
      device_name: "No-issue phone",
      client_name: "NoIssue Client",
      client_phone: "70999666",
      cost_usd: 5,
      price_usd: 15,
      final_amount_usd: 15,
      currency: "USD",
      exchange_rate: 90000,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
    });
    expect(res.success).toBe(true);

    const summary = summaryFor(res.id!);
    expect(summary).toBe(
      "Maintenance Job #" + res.id + ": $15 — No-issue phone",
    );
    expect(summary.endsWith("—")).toBe(false);
  });

  it("truncates a long issue_description to a sensible length", () => {
    const longIssue =
      "This is a very long issue description that goes on and on describing every tiny detail of the phone problem";
    const res = service.saveJob({
      device_name: "Verbose phone",
      issue_description: longIssue,
      client_name: "Verbose Client",
      client_phone: "70999555",
      cost_usd: 5,
      price_usd: 15,
      final_amount_usd: 15,
      currency: "USD",
      exchange_rate: 90000,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
    });
    expect(res.success).toBe(true);

    const summary = summaryFor(res.id!);
    // The full (113-char) description must not ride verbatim into the summary.
    expect(summary).not.toContain(longIssue);
    expect(summary.length).toBeLessThan(longIssue.length);
  });
});
