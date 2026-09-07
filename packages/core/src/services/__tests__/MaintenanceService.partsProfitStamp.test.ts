/**
 * LIRA-176 phase 8a — MaintenanceService parts profit stamp: parts margin
 * folded into `profit_usd`, the two-currency stamp (LBP labour + USD parts
 * on the SAME transaction), and a no-parts job's byte-identical stamp.
 *
 * Harness mirrors MaintenanceRepository.partsLifecycle.test.ts (same
 * three-singleton wiring: MaintenanceRepository/Service, TransactionRepository,
 * StockBatchRepository, via the `globalThis.__LIRATEK_TEST_DB__` hook).
 *
 * Rule 17 — "4. Profit includes parts margin" below is failing-first; see its
 * doc comment for the exact one-line bug reintroduced and the observed
 * failure.
 */

import Database from "better-sqlite3";
import { MaintenanceRepository } from "../../repositories/MaintenanceRepository";
import { MaintenanceService } from "../MaintenanceService";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import {
  resetStockBatchRepository,
} from "../../repositories/StockBatchRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'admin'
    );
    INSERT INTO users (id, tenant_id, username, role) VALUES (1, 1, 'admin', 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      cost_price_usd REAL DEFAULT 0,
      selling_price_usd REAL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
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
      refunded_at TEXT DEFAULT NULL,
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

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT,
      source_id INTEGER,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
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
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 500);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 20000000);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      session_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      refunded_at TEXT DEFAULT NULL
    );
  `);
  return db;
}

function seedProduct(
  db: Database.Database,
  opts: { name: string; costUsd: number; stock: number },
): number {
  const res = db
    .prepare(
      `INSERT INTO products (tenant_id, name, cost_price_usd, selling_price_usd, stock_quantity)
       VALUES (1, ?, ?, ?, ?)`,
    )
    .run(opts.name, opts.costUsd, opts.costUsd * 2, opts.stock);
  return Number(res.lastInsertRowid);
}

function jobTransaction(db: Database.Database, jobId: number) {
  return db
    .prepare(
      `SELECT amount_usd, amount_lbp, profit_usd, profit_lbp
       FROM transactions WHERE source_table = 'maintenance' AND source_id = ? AND type = 'MAINTENANCE'`,
    )
    .get(jobId) as {
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
  };
}

describe("MaintenanceService — parts profit stamp (LIRA-176 phase 8a)", () => {
  let db: Database.Database;
  let repo: MaintenanceRepository;
  let service: MaintenanceService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetStockBatchRepository();
    repo = new MaintenanceRepository();
    service = new MaintenanceService(repo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetStockBatchRepository();
    resetTenantContext();
  });

  // ---------------------------------------------------------------------
  // 4. Profit includes parts margin (failing-first).
  // ---------------------------------------------------------------------
  it("4. USD job: labour cost 10/price 25 + one part cost 4/price 9 stamps profit_usd=20 (not 15) and amount_usd=34", () => {
    const productA = seedProduct(db, { name: "Cable", costUsd: 4, stock: 10 });

    const res = service.saveJob({
      device_name: "iPhone 13",
      currency: "USD",
      cost_usd: 10,
      price_usd: 25,
      final_amount_usd: 25,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 34 }],
      parts: [{ product_id: productA, quantity: 1, unit_price_usd: 9 }],
    });
    expect(res.success).toBe(true);
    const jobId = res.id as number;

    const txn = jobTransaction(db, jobId);
    expect(txn.amount_usd).toBeCloseTo(34, 6);
    expect(txn.profit_usd).toBeCloseTo(20, 6);
  });

  // ---------------------------------------------------------------------
  // 7. The two-currency stamp — LBP labour + USD parts on ONE transaction.
  // ---------------------------------------------------------------------
  it("7. LBP job: labour 500,000 LBP (cost 300,000) + one part cost $4/price $9 stamps amount_lbp=500000, amount_usd=9, profit_lbp=200000, profit_usd=5", () => {
    const productA = seedProduct(db, { name: "Battery", costUsd: 4, stock: 10 });

    const res = service.saveJob({
      device_name: "Samsung A54",
      currency: "LBP",
      cost_lbp: 300000,
      price_lbp: 500000,
      final_amount_lbp: 500000,
      exchange_rate: 90000,
      status: "Delivered_Paid",
      payments: [
        { method: "CASH", currency_code: "LBP", amount: 500000 },
        { method: "CASH", currency_code: "USD", amount: 9 },
      ],
      parts: [{ product_id: productA, quantity: 1, unit_price_usd: 9 }],
    });
    expect(res.success).toBe(true);
    const jobId = res.id as number;

    const txn = jobTransaction(db, jobId);
    expect(txn.amount_lbp).toBeCloseTo(500000, 6);
    expect(txn.amount_usd).toBeCloseTo(9, 6);
    expect(txn.profit_lbp).toBeCloseTo(200000, 6);
    expect(txn.profit_usd).toBeCloseTo(5, 6);
  });

  // ---------------------------------------------------------------------
  // 11. A no-parts job is unchanged — concrete pre-parts-era numbers.
  // ---------------------------------------------------------------------
  it("11. a no-parts USD job stamps exactly its labour-only totals: amount_usd=50, profit_usd=30, parts_price_usd=0, parts_cost_usd=0", () => {
    const res = service.saveJob({
      device_name: "iPhone 13",
      currency: "USD",
      cost_usd: 20,
      price_usd: 50,
      final_amount_usd: 50,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
    });
    expect(res.success).toBe(true);
    const jobId = res.id as number;

    const txn = jobTransaction(db, jobId);
    expect(txn.amount_usd).toBeCloseTo(50, 6);
    expect(txn.amount_lbp).toBe(0);
    expect(txn.profit_usd).toBeCloseTo(30, 6);
    expect(txn.profit_lbp).toBe(0);

    const job = repo.findById(jobId);
    expect(job?.final_amount_usd).toBeCloseTo(50, 6);
    expect(job?.parts_price_usd).toBe(0);
    expect(job?.parts_cost_usd).toBe(0);
  });
});
