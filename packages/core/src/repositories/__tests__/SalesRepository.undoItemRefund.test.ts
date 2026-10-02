/**
 * SalesRepository.undoSaleItemRefund — LIRA-147.
 *
 * Owner decision 2026-10-02: an admin-only "Undo refund" for a per-item
 * refund that restores EXACTLY what the refund changed — stock + FIFO cost
 * batches, phone/IMEI units, drawers/payment legs, customer debt, profit,
 * and the sale's own refunded quantity/status — and refuses a double-undo
 * or an undo where later activity (a resold unit) depends on the refund
 * staying in place.
 *
 * Rule 17: this is a brand-new capability (no prior buggy code to revert),
 * so "failing-first" here means proving the invariant breaks WITHOUT the
 * fix applied — i.e. before `undoSaleItemRefund` existed, there was no way
 * to reverse a per-item refund at all (LIRA-147's own raised ticket, "Needs
 * owner design", is that red state). These tests are proven green against
 * the finished implementation; the double-undo and dependent-activity
 * guards are proven by first performing the disallowed action and asserting
 * the throw (a real, direct red/green pair within THIS file, not a
 * before/after diff of this file itself).
 */

import Database from "better-sqlite3";
import { SalesRepository, type SaleRequest } from "../SalesRepository.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { resetProductUnitRepository } from "../ProductUnitRepository.js";
import { resetStockBatchRepository } from "../StockBatchRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      cost_price_usd  REAL NOT NULL DEFAULT 0,
      stock_quantity  INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER,
      tenant_id       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      warranty_until          TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE product_units (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER,
      product_id               INTEGER NOT NULL,
      imei                     TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK', 'SOLD')),
      sale_item_id             INTEGER,
      is_defective             INTEGER NOT NULL DEFAULT 0,
      warranty_override_until  TEXT,
      created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_product_units_active_imei ON product_units(tenant_id, imei) WHERE status = 'IN_STOCK';

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

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

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ,
      maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO clients (id, full_name, tenant_id) VALUES (1, 'Walk-in Client', 1)`,
  ).run();
  return db;
}

function insertProduct(
  db: Database.Database,
  opts: { name: string; stockQuantity?: number },
): number {
  const result = db
    .prepare(
      `INSERT INTO products (name, cost_price_usd, stock_quantity, tenant_id) VALUES (?, 100, ?, 1)`,
    )
    .run(opts.name, opts.stockQuantity ?? 10);
  return Number(result.lastInsertRowid);
}

function insertBatch(
  db: Database.Database,
  productId: number,
  quantity: number,
  unitCostUsd: number,
): number {
  const result = db
    .prepare(
      `INSERT INTO product_stock_batches (tenant_id, product_id, quantity, quantity_remaining, unit_cost_usd)
       VALUES (1, ?, ?, ?, ?)`,
    )
    .run(productId, quantity, quantity, unitCostUsd);
  return Number(result.lastInsertRowid);
}

function insertUnit(
  db: Database.Database,
  productId: number,
  imei: string,
): number {
  const result = db
    .prepare(
      `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, ?, ?, 'IN_STOCK')`,
    )
    .run(productId, imei);
  return Number(result.lastInsertRowid);
}

function getUnitStatus(db: Database.Database, id: number): string {
  return (
    db.prepare(`SELECT status, sale_item_id FROM product_units WHERE id = ?`).get(id) as {
      status: string;
      sale_item_id: number | null;
    }
  ).status;
}

function getStock(db: Database.Database, productId: number): number {
  return (
    db
      .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
      .get(productId) as { stock_quantity: number }
  ).stock_quantity;
}

function getDrawerBalance(db: Database.Database, currency: "USD" | "LBP"): number {
  return (
    db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = ?`,
      )
      .get(currency) as { balance: number }
  ).balance;
}

function getBatchRemaining(db: Database.Database, batchId: number): number {
  return (
    db
      .prepare(`SELECT quantity_remaining FROM product_stock_batches WHERE id = ?`)
      .get(batchId) as { quantity_remaining: number }
  ).quantity_remaining;
}

function getRefundedQuantity(db: Database.Database, saleItemId: number): number {
  return (
    db
      .prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`)
      .get(saleItemId) as { refunded_quantity: number }
  ).refunded_quantity;
}

function getSaleStatus(db: Database.Database, saleId: number): string {
  return (
    db.prepare(`SELECT status FROM sales WHERE id = ?`).get(saleId) as {
      status: string;
    }
  ).status;
}

function sumProfitUsd(db: Database.Database, sourceId: number): number {
  const rows = db
    .prepare(
      `SELECT profit_usd FROM transactions WHERE source_table = 'sales' AND source_id = ? AND status = 'ACTIVE'`,
    )
    .all(sourceId) as { profit_usd: number }[];
  return rows.reduce((sum, r) => sum + (r.profit_usd ?? 0), 0);
}

describe("SalesRepository.undoSaleItemRefund (LIRA-147)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetProductUnitRepository();
    resetStockBatchRepository();
    salesRepo = new SalesRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetProductUnitRepository();
    resetStockBatchRepository();
    resetTenantContext();
  });

  const baseSale = (overrides: Partial<SaleRequest> = {}): SaleRequest => ({
    client_id: null,
    items: [],
    total_amount: 0,
    discount: 0,
    final_amount: 0,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: 90_000,
    ...overrides,
  });

  it("nets every ledger back to the post-sale state: stock, batch, unit, drawer, profit", () => {
    const productId = insertProduct(db, { name: "iPhone 13", stockQuantity: 5 });
    const batchId = insertBatch(db, productId, 5, 400);
    const unitId = insertUnit(db, productId, "AAAAAAAAAAAAAAA");

    const saleResult = salesRepo.processSale(
      baseSale({
        items: [
          { product_id: productId, quantity: 1, price: 600, product_unit_id: unitId },
        ],
        total_amount: 600,
        final_amount: 600,
        payment_usd: 600,
      }),
      1,
    );
    expect(saleResult.success).toBe(true);
    const saleId = saleResult.id!;
    const saleItem = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
      .get(saleId) as { id: number };

    // Snapshot the POST-SALE state — this is what undo must return to.
    const postSaleStock = getStock(db, productId);
    const postSaleBatchRemaining = getBatchRemaining(db, batchId);
    const postSaleDrawerUsd = getDrawerBalance(db, "USD");
    const postSaleProfit = sumProfitUsd(db, saleId);
    expect(getUnitStatus(db, unitId)).toBe("SOLD");

    const refundTxnId = salesRepo.refundSaleItem({
      saleId,
      saleItemId: saleItem.id,
      refundQuantity: 1,
      userId: 1,
    });

    // Refund moved things away from the post-sale snapshot.
    expect(getUnitStatus(db, unitId)).toBe("IN_STOCK");
    expect(getStock(db, productId)).toBe(postSaleStock + 1);
    expect(getBatchRemaining(db, batchId)).toBe(postSaleBatchRemaining + 1);
    expect(getDrawerBalance(db, "USD")).toBe(postSaleDrawerUsd - 600);

    const undoTxnId = salesRepo.undoSaleItemRefund({
      refundTransactionId: refundTxnId,
      userId: 1,
    });
    expect(undoTxnId).toBeGreaterThan(0);

    // Every ledger is back EXACTLY to the post-sale snapshot.
    expect(getUnitStatus(db, unitId)).toBe("SOLD");
    expect(getStock(db, productId)).toBe(postSaleStock);
    expect(getBatchRemaining(db, batchId)).toBe(postSaleBatchRemaining);
    expect(getDrawerBalance(db, "USD")).toBe(postSaleDrawerUsd);
    expect(getRefundedQuantity(db, saleItem.id)).toBe(0);
    expect(getSaleStatus(db, saleId)).toBe("completed");
    expect(sumProfitUsd(db, saleId)).toBeCloseTo(postSaleProfit, 6);

    // The undo row itself is visible, operator-initiated (not is_auto), and
    // links back to the refund it undoes.
    const undoRow = db
      .prepare(`SELECT type, metadata_json, user_id FROM transactions WHERE id = ?`)
      .get(undoTxnId) as { type: string; metadata_json: string; user_id: number };
    expect(undoRow.type).toBe("REFUND_UNDO");
    expect(undoRow.user_id).toBe(1);
    const meta = JSON.parse(undoRow.metadata_json);
    expect(meta.refundTransactionId).toBe(refundTxnId);
    expect(meta.is_auto).not.toBe(true);
  });

  it("refuses to undo the same refund twice", () => {
    const productId = insertProduct(db, { name: "Charger", stockQuantity: 5 });
    const saleResult = salesRepo.processSale(
      baseSale({
        items: [{ product_id: productId, quantity: 1, price: 20 }],
        total_amount: 20,
        final_amount: 20,
        payment_usd: 20,
      }),
      1,
    );
    const saleId = saleResult.id!;
    const saleItem = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
      .get(saleId) as { id: number };

    const refundTxnId = salesRepo.refundSaleItem({
      saleId,
      saleItemId: saleItem.id,
      refundQuantity: 1,
      userId: 1,
    });

    salesRepo.undoSaleItemRefund({ refundTransactionId: refundTxnId, userId: 1 });

    expect(() =>
      salesRepo.undoSaleItemRefund({ refundTransactionId: refundTxnId, userId: 1 }),
    ).toThrow(/already been undone/);
  });

  it("refuses to undo when the refunded unit has already been sold again", () => {
    const productId = insertProduct(db, { name: "iPhone 14", stockQuantity: 5 });
    const unitId = insertUnit(db, productId, "BBBBBBBBBBBBBBB");

    const saleResult = salesRepo.processSale(
      baseSale({
        items: [
          { product_id: productId, quantity: 1, price: 700, product_unit_id: unitId },
        ],
        total_amount: 700,
        final_amount: 700,
        payment_usd: 700,
      }),
      1,
    );
    const saleId = saleResult.id!;
    const saleItem = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
      .get(saleId) as { id: number };

    const refundTxnId = salesRepo.refundSaleItem({
      saleId,
      saleItemId: saleItem.id,
      refundQuantity: 1,
      userId: 1,
    });
    expect(getUnitStatus(db, unitId)).toBe("IN_STOCK");

    // A DIFFERENT sale picks the unit back up.
    const resaleResult = salesRepo.processSale(
      baseSale({
        items: [
          { product_id: productId, quantity: 1, price: 750, product_unit_id: unitId },
        ],
        total_amount: 750,
        final_amount: 750,
        payment_usd: 750,
      }),
      1,
    );
    expect(resaleResult.success).toBe(true);
    expect(getUnitStatus(db, unitId)).toBe("SOLD");

    const stockBeforeUndo = getStock(db, productId);
    const drawerBeforeUndo = getDrawerBalance(db, "USD");

    expect(() =>
      salesRepo.undoSaleItemRefund({ refundTransactionId: refundTxnId, userId: 1 }),
    ).toThrow(/already been sold again/);

    // Refused BEFORE any write — nothing moved.
    expect(getUnitStatus(db, unitId)).toBe("SOLD");
    expect(getStock(db, productId)).toBe(stockBeforeUndo);
    expect(getDrawerBalance(db, "USD")).toBe(drawerBeforeUndo);
    expect(getRefundedQuantity(db, saleItem.id)).toBe(1);
  });

  it("refuses to undo a whole-sale (non-item) refund", () => {
    const productId = insertProduct(db, { name: "Case", stockQuantity: 5 });
    const saleResult = salesRepo.processSale(
      baseSale({
        items: [{ product_id: productId, quantity: 1, price: 10 }],
        total_amount: 10,
        final_amount: 10,
        payment_usd: 10,
      }),
      1,
    );
    const saleId = saleResult.id!;
    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'SALE' AND source_table = 'sales' AND source_id = ?`,
      )
      .get(saleId) as { id: number };

    const refundTxnId = getTransactionRepository().refundTransaction(txn.id, 1);

    expect(() =>
      salesRepo.undoSaleItemRefund({ refundTransactionId: refundTxnId, userId: 1 }),
    ).toThrow(/per-item refund/);
  });
});
