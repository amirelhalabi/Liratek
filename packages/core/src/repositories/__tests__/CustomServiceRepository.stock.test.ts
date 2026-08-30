/**
 * CustomServiceRepository — inventory-item stock consumption
 * (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 FINAL SPEC, §2b slice)
 *
 * Owner decision: an inventory-backed custom service "behaves like a POS
 * sale — stock decrements, no cash row" (the cost was already paid when the
 * stock was bought). §2a removed the cash row; this covers the missing
 * stock half.
 *
 * Mirrors SalesRepository.processSale's guarded conditional write
 * (~:720-760) and its `allowOutOfStock` escape hatch, and
 * TransactionRepository._restoreStock's reversal convention — but via the
 * NEW `_restoreCustomServiceStock` (custom services are a single row, not a
 * `sale_items` table, and always consume exactly 1 unit).
 *
 * Rule 15 note: every assertion below is a DELTA (before/after), never an
 * absolute stock_quantity read off a shared fixture.
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      tenant_id INTEGER NOT NULL DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

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
  return db;
}

function seedProduct(
  db: Database.Database,
  name: string,
  stockQuantity: number,
): number {
  const res = db
    .prepare(
      "INSERT INTO products (tenant_id, name, stock_quantity) VALUES (1, ?, ?)",
    )
    .run(name, stockQuantity);
  return Number(res.lastInsertRowid);
}

function stockOf(db: Database.Database, productId: number): number {
  return (
    db
      .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
      .get(productId) as { stock_quantity: number }
  ).stock_quantity;
}

describe("CustomServiceRepository — inventory-item stock consumption", () => {
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
  });

  afterEach(() => {
    resetTenantContext();
    resetTransactionRepository();
    db.close();
  });

  it("decrements stock_quantity by exactly 1 when product_id is set (inventory path)", () => {
    const productId = seedProduct(db, "iPhone 12 Screen", 5);
    const before = stockOf(db, productId);

    const res = repo.createService(
      {
        description: "iPhone 12 Screen",
        cost_usd: 8,
        cost_lbp: 0,
        price_usd: 15,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        product_id: productId,
      },
      1,
    );

    expect(res.success).toBe(true);
    expect(stockOf(db, productId)).toBe(before - 1);
  });

  it("preset/free-text paths (no product_id) do NOT touch stock — the regression that matters most", () => {
    // Seed a product that happens to share the same name as the service
    // description, to prove the repository isn't matching by name/description
    // — only an explicit product_id moves stock.
    const productId = seedProduct(db, "Screen Repair", 5);
    const before = stockOf(db, productId);

    const preset = repo.createService(
      {
        description: "Screen Repair",
        cost_usd: 2,
        cost_lbp: 0,
        price_usd: 10,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      },
      1,
    );
    expect(preset.success).toBe(true);
    expect(stockOf(db, productId)).toBe(before);

    const freeText = repo.createService(
      {
        description: "quick screen fix, walk-in",
        cost_usd: 2,
        cost_lbp: 0,
        price_usd: 10,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      },
      1,
    );
    expect(freeText.success).toBe(true);
    expect(stockOf(db, productId)).toBe(before);
  });

  it("a 'pending' inventory-backed service reserves no stock (mirrors POS: stock moves only on completed)", () => {
    const productId = seedProduct(db, "Charger Cable", 3);
    const before = stockOf(db, productId);

    const res = repo.createService(
      {
        description: "Charger Cable",
        cost_usd: 1,
        cost_lbp: 0,
        price_usd: 5,
        price_lbp: 0,
        paid_by: "CASH",
        status: "pending",
        product_id: productId,
      },
      1,
    );

    expect(res.success).toBe(true);
    expect(stockOf(db, productId)).toBe(before);
  });

  it("void (deleteService -> voidTransaction) restores the consumed stock exactly once", () => {
    const productId = seedProduct(db, "Screen Protector", 4);
    const before = stockOf(db, productId);

    const res = repo.createService(
      {
        description: "Screen Protector",
        cost_usd: 1,
        cost_lbp: 0,
        price_usd: 6,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        product_id: productId,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(stockOf(db, productId)).toBe(before - 1);

    const voidResult = repo.deleteService(res.id!);
    expect(voidResult.success).toBe(true);
    expect(stockOf(db, productId)).toBe(before);
  });

  it("refund via the GENERIC Transactions-table path (TransactionRepository.refundTransaction, bypassing deleteService) also restores stock exactly once", () => {
    // Proves the reversal owner lives in TransactionRepository, not
    // CustomServiceRepository.deleteService — a custom service voided/
    // refunded directly from the Transactions page never calls
    // deleteService at all.
    const productId = seedProduct(db, "Back Glass", 2);
    const before = stockOf(db, productId);

    const res = repo.createService(
      {
        description: "Back Glass",
        cost_usd: 3,
        cost_lbp: 0,
        price_usd: 12,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        product_id: productId,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(stockOf(db, productId)).toBe(before - 1);

    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = ?`,
      )
      .get(res.id) as { id: number };

    getTransactionRepository().refundTransaction(txn.id, 1);
    expect(stockOf(db, productId)).toBe(before);
  });

  it("out-of-stock: without allowOutOfStock, the create is rejected and rolled back (rows-affected guard, mirrors POS)", () => {
    const productId = seedProduct(db, "Rare Part", 0);

    const res = repo.createService(
      {
        description: "Rare Part",
        cost_usd: 5,
        cost_lbp: 0,
        price_usd: 20,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        product_id: productId,
      },
      1,
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not enough stock/i);
    // The whole db.transaction() rolled back — no half-written service row,
    // no stock change.
    expect(stockOf(db, productId)).toBe(0);
    const count = (
      db.prepare(`SELECT COUNT(*) c FROM custom_services`).get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(0);
  });

  it("out-of-stock with allowOutOfStock: true — decrements blindly into negative stock (mirrors POS's opt-in)", () => {
    const productId = seedProduct(db, "Rare Part 2", 0);

    const res = repo.createService(
      {
        description: "Rare Part 2",
        cost_usd: 5,
        cost_lbp: 0,
        price_usd: 20,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        product_id: productId,
      },
      1,
      { allowOutOfStock: true },
    );

    expect(res.success).toBe(true);
    expect(stockOf(db, productId)).toBe(-1);
  });
});
