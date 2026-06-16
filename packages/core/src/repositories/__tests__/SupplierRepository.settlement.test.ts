/**
 * SupplierRepository — Settlement Tests
 *
 * Tests the atomic settleTransactions() method which:
 * 1. Creates a SETTLEMENT supplier_ledger entry
 * 2. Marks financial_services rows as is_settled = 1
 * 3. Credits commission to General drawer
 * 4. Debits net payment from the specified drawer
 * 5. Creates a unified transactions row for audit trail
 *
 * Also tests the RechargeRepository.topUpFromSupplier() flow for
 * Katsh/iPick supplier-credit topups.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import { RechargeRepository } from "../RechargeRepository";

// ─── Minimal in-memory schema ─────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      module_key TEXT,
      provider TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','PAYMENT','ADJUSTMENT','SETTLEMENT')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed drawers
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 500);
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

function seedSupplier(db: Database.Database, provider = "OMT"): number {
  const res = db
    .prepare(
      "INSERT INTO suppliers (name, provider, is_system) VALUES (?, ?, 1)",
    )
    .run(provider, provider);
  return Number(res.lastInsertRowid);
}

function seedUnsettledTransaction(
  db: Database.Database,
  provider: string,
  amount: number,
  commission: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission, is_settled)
       VALUES (?, 'RECEIVE', ?, 'USD', ?, 0)`,
    )
    .run(provider, amount, commission);
  return Number(res.lastInsertRowid);
}

function seedSettledTransaction(
  db: Database.Database,
  provider: string,
  amount: number,
  commission: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission, is_settled)
       VALUES (?, 'SEND', ?, 'USD', ?, 1)`,
    )
    .run(provider, amount, commission);
  return Number(res.lastInsertRowid);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SupplierRepository.settleTransactions()", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic happy path
  // ─────────────────────────────────────────────────────────────────────────

  it("creates a SETTLEMENT ledger entry with negative net amount", () => {
    const supplierId = seedSupplier(db);
    const txn1 = seedUnsettledTransaction(db, "OMT", 100, 0.1);
    const txn2 = seedUnsettledTransaction(db, "OMT", 150, 0.2);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txn1, txn2],
      amount_usd: 249.7, // net after deducting commission
      amount_lbp: 0,
      commission_usd: 0.3,
      commission_lbp: 0,
      drawer_name: "General",
      created_by: 1,
      note: "March settlement",
    });

    const entry = db
      .prepare("SELECT * FROM supplier_ledger WHERE supplier_id = ?")
      .get(supplierId) as any;

    expect(entry).toBeDefined();
    expect(entry.entry_type).toBe("SETTLEMENT");
    expect(entry.amount_usd).toBe(-249.7); // stored as negative (shop paying out)
    expect(entry.note).toBe("March settlement");
  });

  it("marks all selected financial_services rows as is_settled = 1", () => {
    const supplierId = seedSupplier(db);
    const txn1 = seedUnsettledTransaction(db, "OMT", 100, 0.1);
    const txn2 = seedUnsettledTransaction(db, "OMT", 150, 0.2);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txn1, txn2],
      amount_usd: 249.7,
      amount_lbp: 0,
      commission_usd: 0.3,
      commission_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });

    const rows = db
      .prepare(
        "SELECT id, is_settled, settled_at, settlement_id FROM financial_services WHERE id IN (?, ?)",
      )
      .all(txn1, txn2) as any[];

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.is_settled).toBe(1);
      expect(row.settled_at).not.toBeNull();
      expect(row.settlement_id).toBeGreaterThan(0);
    }
  });

  it("sets settled_at and settlement_id on settled rows", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    const before = Date.now();
    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });

    const row = db
      .prepare(
        "SELECT settled_at, settlement_id FROM financial_services WHERE id = ?",
      )
      .get(txnId) as any;

    expect(row.settlement_id).toBe(result.id);
    expect(new Date(row.settled_at).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("credits commission_usd to General drawer", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      drawer_name: "OMT_System",
      created_by: 1,
    });

    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;

    expect(general.balance).toBeCloseTo(0.1, 4); // was 0, now +0.1
  });

  it("debits net amount_usd from the specified drawer", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    const before = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      drawer_name: "OMT_System",
      created_by: 1,
    });

    const after = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;

    expect(after).toBeCloseTo(before - 99.9, 2);
  });

  it("creates a unified SUPPLIER_SETTLEMENT transaction row", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'")
      .get() as any;

    expect(txn).toBeDefined();
    expect(txn.type).toBe("SUPPLIER_SETTLEMENT");
    expect(txn.source_table).toBe("supplier_ledger");
    expect(txn.amount_usd).toBeCloseTo(99.9, 2);
  });

  it("links the ledger entry to the unified transaction via transaction_id", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });

    const ledgerEntry = db
      .prepare(
        "SELECT transaction_id FROM supplier_ledger WHERE supplier_id = ?",
      )
      .get(supplierId) as any;
    const unifiedTxn = db
      .prepare("SELECT id FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'")
      .get() as any;

    expect(ledgerEntry.transaction_id).toBe(unifiedTxn.id);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Guard: double-settle prevention
  // ─────────────────────────────────────────────────────────────────────────

  it("does NOT re-settle already-settled rows (is_settled = 0 guard)", () => {
    const supplierId = seedSupplier(db);
    const alreadySettled = seedSettledTransaction(db, "OMT", 100, 0.1);

    // Pre-mark as settled
    db.prepare("UPDATE financial_services SET is_settled = 1 WHERE id = ?").run(
      alreadySettled,
    );

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [alreadySettled],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });

    // settled_at should still be null (was never set for SEND rows in test)
    const row = db
      .prepare("SELECT settlement_id FROM financial_services WHERE id = ?")
      .get(alreadySettled) as any;
    // UPDATE WHERE is_settled = 0 won't match — settlement_id stays null
    expect(row.settlement_id).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────────────────────────────────

  it("throws DatabaseError when financial_service_ids is empty", () => {
    const supplierId = seedSupplier(db);

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        drawer_name: "General",
        created_by: 1,
      }),
    ).toThrow("No transactions selected for settlement");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Atomic rollback
  // ─────────────────────────────────────────────────────────────────────────

  it("rolls back entirely if an error occurs mid-transaction", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    // Break the drawer_balances table to cause a mid-transaction failure
    db.exec("DROP TABLE drawer_balances");

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [txnId],
        amount_usd: 99.9,
        amount_lbp: 0,
        commission_usd: 0.1,
        commission_lbp: 0,
        drawer_name: "General",
        created_by: 1,
      }),
    ).toThrow();

    // Restore table and verify nothing was committed
    db.exec(`
      CREATE TABLE drawer_balances (
        drawer_name TEXT NOT NULL,
        currency_code TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (drawer_name, currency_code)
      );
    `);

    const ledgerCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM supplier_ledger").get() as any
    ).cnt;
    const stillUnsettled = (
      db
        .prepare("SELECT is_settled FROM financial_services WHERE id = ?")
        .get(txnId) as any
    ).is_settled;

    expect(ledgerCount).toBe(0); // no ledger entry committed
    expect(stillUnsettled).toBe(0); // financial_services row not marked settled
  });

  // ─────────────────────────────────────────────────────────────────────────
  // End-to-end: INTRA $100 receive, $1 fee, $0.10 commission
  // ─────────────────────────────────────────────────────────────────────────

  it("correctly settles a $100 INTRA RECEIVE with $0.10 commission", () => {
    const supplierId = seedSupplier(db, "OMT");
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    // fee = $1, commission = 10% of $1 = $0.10
    // net pay to OMT = $100 - $0.10 = $99.90
    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      drawer_name: "OMT_System",
      created_by: 1,
      note: "INTRA $100 settlement",
    });

    expect(result.id).toBeGreaterThan(0);

    // Verify ledger entry
    const ledger = db
      .prepare("SELECT * FROM supplier_ledger WHERE id = ?")
      .get(result.id) as any;
    expect(ledger.amount_usd).toBeCloseTo(-99.9, 2);

    // Verify financial_services settled
    const fs = db
      .prepare(
        "SELECT is_settled, settlement_id FROM financial_services WHERE id = ?",
      )
      .get(txnId) as any;
    expect(fs.is_settled).toBe(1);
    expect(fs.settlement_id).toBe(result.id);

    // Verify General got +$0.10 commission
    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(general.balance).toBeCloseTo(0.1, 4);

    // Verify OMT_System deducted $99.90
    const omtSystem = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(omtSystem.balance).toBeCloseTo(500 - 99.9, 2); // was 500
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multiple transactions in one settlement
  // ─────────────────────────────────────────────────────────────────────────

  it("settles multiple transactions with correct totals", () => {
    const supplierId = seedSupplier(db, "OMT");
    const txn1 = seedUnsettledTransaction(db, "OMT", 100, 0.1); // $100 recv, $0.10 commission
    const txn2 = seedUnsettledTransaction(db, "OMT", 150, 0.2); // $150 recv, $0.20 commission

    // total owed = 250, total commission = 0.30, net pay = 249.70
    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txn1, txn2],
      amount_usd: 249.7,
      amount_lbp: 0,
      commission_usd: 0.3,
      commission_lbp: 0,
      drawer_name: "OMT_System",
      created_by: 1,
    });

    const settled = db
      .prepare(
        "SELECT id, is_settled FROM financial_services WHERE id IN (?, ?)",
      )
      .all(txn1, txn2) as any[];
    expect(settled.every((r) => r.is_settled === 1)).toBe(true);

    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(general.balance).toBeCloseTo(0.3, 4);
  });
});

// ─── Extended schema for topUpFromSupplier tests ─────────────────────────────
// Adds the recharges table that RechargeRepository requires.

function createExtendedTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      module_key TEXT,
      provider TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','PAYMENT','ADJUSTMENT','SETTLEMENT')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT NOT NULL,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER NOT NULL DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (drawer_name, currency_code)
    );

    CREATE TABLE transactions (
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
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed provider drawers for Katsh and iPick
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);

  return db;
}

// ─── RechargeRepository.topUpFromSupplier() tests ────────────────────────────

describe("RechargeRepository.topUpFromSupplier()", () => {
  let db: Database.Database;
  let rechargeRepo: RechargeRepository;
  let supplierRepo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createExtendedTestDb();
    setDb(db);
    rechargeRepo = new RechargeRepository();
    supplierRepo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
  });

  it("increases Katsh drawer balance and creates supplier_ledger TOP_UP entry", () => {
    // Arrange: seed a Katsh supplier
    const supplierRes = db
      .prepare("INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)")
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    // Act
    const result = rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 100,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(true);

    // Assert: Katsh drawer increased by 100 USD
    const drawer = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Katsh' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(drawer.balance).toBeCloseTo(100, 2);

    // Assert: supplier_ledger has a TOP_UP entry with amount_usd = 100
    const ledgerEntry = db
      .prepare(
        "SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'TOP_UP'",
      )
      .get(supplierId) as any;
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.entry_type).toBe("TOP_UP");
    expect(ledgerEntry.amount_usd).toBeCloseTo(100, 2);
    expect(ledgerEntry.amount_lbp).toBe(0);

    // Assert: NO source drawer was deducted — General stays at 500
    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(general.balance).toBeCloseTo(500, 2);
  });

  it("records a recharge row with paid_by = SUPPLIER and type = TOP_UP", () => {
    db.prepare("INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)")
      .run("Katsh Supplier", "Katsh");

    rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 50,
      currency: "USD",
      userId: 1,
    });

    const recharge = db
      .prepare("SELECT * FROM recharges WHERE carrier = 'Katsh'")
      .get() as any;
    expect(recharge).toBeDefined();
    expect(recharge.recharge_type).toBe("TOP_UP");
    expect(recharge.paid_by).toBe("SUPPLIER");
    expect(recharge.amount).toBeCloseTo(50, 2);
    expect(recharge.currency_code).toBe("USD");
  });

  it("creates a unified transaction row for the top-up", () => {
    db.prepare("INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)")
      .run("Katsh Supplier", "Katsh");

    rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 75,
      currency: "USD",
      userId: 1,
    });

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'RECHARGE_TOPUP'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.amount_usd).toBeCloseTo(75, 2);
    expect(txn.source_table).toBe("recharges");
  });

  it("works when no supplier is found — still increases drawer, skips ledger", () => {
    // No supplier seeded for Katsh

    const result = rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 200,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(true);

    // Drawer increased
    const drawer = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Katsh' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(drawer.balance).toBeCloseTo(200, 2);

    // No ledger entries created
    const ledgerCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM supplier_ledger").get() as any
    ).cnt;
    expect(ledgerCount).toBe(0);
  });

  it("handles LBP currency — sets amount_lbp in ledger and not amount_usd", () => {
    const supplierRes = db
      .prepare("INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)")
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 1_000_000,
      currency: "LBP",
      userId: 1,
    });

    const ledgerEntry = db
      .prepare(
        "SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'TOP_UP'",
      )
      .get(supplierId) as any;
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.amount_lbp).toBeCloseTo(1_000_000, 0);
    expect(ledgerEntry.amount_usd).toBe(0);

    const drawer = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Katsh' AND currency_code = 'LBP'",
      )
      .get() as any;
    expect(drawer.balance).toBeCloseTo(1_000_000, 0);
  });
});

// ─── Supplier settlement flow tests ──────────────────────────────────────────

describe("Supplier settlement flow for Katsh", () => {
  let db: Database.Database;
  let supplierRepo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createExtendedTestDb();
    setDb(db);
    supplierRepo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
  });

  it("deducts from General drawer and creates PAYMENT entry, netting balance to 0", () => {
    // Arrange: seed supplier and a TOP_UP liability of $100
    const supplierRes = db
      .prepare("INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)")
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    db.prepare(
      "INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, created_by) VALUES (?, 'TOP_UP', 100, 0, 1)",
    ).run(supplierId);

    // Verify pre-condition: net owed = +100
    const balanceBefore = db
      .prepare(
        "SELECT COALESCE(SUM(amount_usd), 0) as total FROM supplier_ledger WHERE supplier_id = ?",
      )
      .get(supplierId) as any;
    expect(balanceBefore.total).toBeCloseTo(100, 2);

    // Act: pay the supplier $100 from General drawer
    supplierRepo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: 100,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
      note: "Settle Katsh supplier debt",
    });

    // Assert: General drawer decreased by 100 (was 500)
    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(general.balance).toBeCloseTo(400, 2); // 500 - 100

    // Assert: supplier_ledger has a PAYMENT entry with amount_usd = -100
    const paymentEntry = db
      .prepare(
        "SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'PAYMENT'",
      )
      .get(supplierId) as any;
    expect(paymentEntry).toBeDefined();
    expect(paymentEntry.amount_usd).toBeCloseTo(-100, 2);

    // Assert: net balance (SUM of all ledger entries) = 0
    const netBalance = db
      .prepare(
        "SELECT COALESCE(SUM(amount_usd), 0) as total FROM supplier_ledger WHERE supplier_id = ?",
      )
      .get(supplierId) as any;
    expect(netBalance.total).toBeCloseTo(0, 4);
  });

  it("creates a SUPPLIER_PAYMENT unified transaction on settlement", () => {
    const supplierRes = db
      .prepare("INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)")
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    supplierRepo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: 50,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'SUPPLIER_PAYMENT'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.amount_usd).toBeCloseTo(50, 2);
    expect(txn.source_table).toBe("supplier_ledger");
  });
});
