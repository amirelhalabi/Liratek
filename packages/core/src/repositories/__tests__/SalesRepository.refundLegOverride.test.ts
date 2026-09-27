/**
 * LIRA-231 — POS "Refund Sale" / "Refund item" buttons get the SAME
 * operator-chosen return-method override contract (LIRA-078) the
 * Transactions page's refund modal uses, plus a hard server-side refusal
 * for a sale paid through a customer session basket.
 *
 * Rule 17 (failing-first), verified by temporarily reverting the fix and
 * observing the expected RED:
 *   - "an item refund with an override posts exactly the override legs and
 *     the drawer deltas": reverting `refundSaleItem` to drop the
 *     `refundLegs` handling (pre-LIRA-231 shape) makes this fail — OMT_App
 *     stays at 0 instead of -500, and General drops by 500 instead of
 *     staying put, because the override is silently ignored and the plain
 *     proportional mirror runs instead.
 *   - "an over-refund override is rejected": reverting
 *     `validateRefundLegOverrideAmounts`'s per-currency epsilon check to
 *     skip the mismatch throw makes this fail — the over-refund posts
 *     without error.
 *   - "a session-paid sale is refused ... with that exact message":
 *     reverting the `isTransactionSessionLinked` guard (commenting out the
 *     throw in both `refundBySaleId` and `refundSaleItem`) makes both halves
 *     of this test fail — the refund proceeds and drawers move.
 * Each was reverted, observed RED, and restored to GREEN before finalizing
 * this file.
 */

import Database from "better-sqlite3";
import { SalesRepository, type SaleRequest } from "../SalesRepository.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { resetProductUnitRepository } from "../ProductUnitRepository.js";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository.js";
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
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'LBP', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'OMT_App', 'USD', 0, CURRENT_TIMESTAMP);

    CREATE TABLE payment_methods (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT NOT NULL,
      label          TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      is_active      INTEGER NOT NULL DEFAULT 1,
      is_system      INTEGER NOT NULL DEFAULT 0,
      tenant_id      INTEGER DEFAULT 1,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES
      ('CASH', 'Cash', 'General', 1, 1, 1),
      ('OMT', 'OMT Wallet', 'OMT_App', 1, 1, 0),
      ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1);

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
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL
    );

    CREATE TABLE customer_session_transactions (
      tenant_id              INTEGER DEFAULT 1,
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER NOT NULL,
      transaction_type       TEXT NOT NULL,
      transaction_id         INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd             REAL NOT NULL DEFAULT 0,
      amount_lbp             REAL NOT NULL DEFAULT 0,
      profit_usd             REAL NOT NULL DEFAULT 0,
      profit_lbp             REAL NOT NULL DEFAULT 0,
      created_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- SUPPLIER_STOCK_INTAKE_PLAN.md v164 — production code now unconditionally
    -- touches these two tables from SalesRepository.processSale/refundSaleItem
    -- and TransactionRepository._restoreStock (StockBatchRepository.consume /
    -- restoreForSaleItem), even for a product with no batch history: a missing
    -- table here makes the whole file die in setup looking like an assertion
    -- failure (see CLAUDE.md's "Test schemas silently void whole files" note).
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  return db;
}

function insertProduct(db: Database.Database, name: string): number {
  const result = db
    .prepare(
      `INSERT INTO products (name, cost_price_usd, stock_quantity, tenant_id) VALUES (?, 100, 10, 1)`,
    )
    .run(name);
  return Number(result.lastInsertRowid);
}

function drawerBalance(
  db: Database.Database,
  drawerName: string,
  currencyCode: string,
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = 1`,
    )
    .get(drawerName, currencyCode) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

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

describe("SalesRepository/TransactionRepository — LIRA-231 POS refund override + session block", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetProductUnitRepository();
    resetPaymentMethodRepository();
    salesRepo = new SalesRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetProductUnitRepository();
    resetPaymentMethodRepository();
    resetTenantContext();
  });

  function sellOneItem(): { saleId: number; saleItemId: number } {
    const productId = insertProduct(db, "iPhone 13");
    const result = salesRepo.processSale(
      baseSale({
        items: [{ product_id: productId, quantity: 1, price: 500 }],
        total_amount: 500,
        final_amount: 500,
        payment_usd: 500,
      }),
      1,
    );
    expect(result.success).toBe(true);
    const saleId = result.id!;
    const saleItem = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
      .get(saleId) as { id: number };
    return { saleId, saleItemId: saleItem.id };
  }

  it("an item refund with an override posts exactly the override legs and the drawer deltas", () => {
    const { saleId, saleItemId } = sellOneItem();
    expect(drawerBalance(db, "General", "USD")).toBe(500);

    salesRepo.refundSaleItem({
      saleId,
      saleItemId,
      refundQuantity: 1,
      userId: 1,
      refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 500 }],
    });

    // The overridable CASH leg was SKIPPED (not mirrored) — General keeps
    // the $500 the customer originally handed over in cash.
    expect(drawerBalance(db, "General", "USD")).toBe(500);
    // The override leg posts to OMT_App instead, debited by exactly $500.
    expect(drawerBalance(db, "OMT_App", "USD")).toBe(-500);

    const legs = db
      .prepare(
        `SELECT method, drawer_name, amount FROM payments WHERE transaction_id IN
         (SELECT id FROM transactions WHERE type = 'REFUND' AND source_id = ?)`,
      )
      .all(saleId) as { method: string; drawer_name: string; amount: number }[];
    expect(legs).toHaveLength(1);
    expect(legs[0]).toEqual({
      method: "OMT",
      drawer_name: "OMT_App",
      amount: -500,
    });
  });

  it("no override behaves exactly as before (plain proportional mirror reversal)", () => {
    const { saleId, saleItemId } = sellOneItem();
    expect(drawerBalance(db, "General", "USD")).toBe(500);

    salesRepo.refundSaleItem({
      saleId,
      saleItemId,
      refundQuantity: 1,
      userId: 1,
    });

    expect(drawerBalance(db, "General", "USD")).toBe(0);
    expect(drawerBalance(db, "OMT_App", "USD")).toBe(0);
  });

  it("an over-refund override is rejected — nothing is written", () => {
    const { saleId, saleItemId } = sellOneItem();
    const beforeGeneral = drawerBalance(db, "General", "USD");
    const beforeRefundedQty = (
      db
        .prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`)
        .get(saleItemId) as { refunded_quantity: number }
    ).refunded_quantity;

    expect(() =>
      salesRepo.refundSaleItem({
        saleId,
        saleItemId,
        refundQuantity: 1,
        userId: 1,
        // The item's refundable share is exactly $500 — 600 over-refunds it.
        refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 600 }],
      }),
    ).toThrow(/totals do not match/);

    expect(drawerBalance(db, "General", "USD")).toBe(beforeGeneral);
    expect(drawerBalance(db, "OMT_App", "USD")).toBe(0);
    const afterRefundedQty = (
      db
        .prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`)
        .get(saleItemId) as { refunded_quantity: number }
    ).refunded_quantity;
    expect(afterRefundedQty).toBe(beforeRefundedQty);
  });

  it("a whole-sale refund with an override posts the override legs via refundBySaleId", () => {
    const { saleId } = sellOneItem();
    expect(drawerBalance(db, "General", "USD")).toBe(500);

    const txnRepo = getTransactionRepository();
    txnRepo.refundBySaleId(saleId, 1, {
      refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 500 }],
    });

    expect(drawerBalance(db, "General", "USD")).toBe(500);
    expect(drawerBalance(db, "OMT_App", "USD")).toBe(-500);
  });

  it("a session-paid sale is refused for BOTH item and whole refund, with the exact POS message, and nothing is written", () => {
    const { saleId, saleItemId } = sellOneItem();
    const saleTxn = db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'SALE' AND source_table = 'sales' AND source_id = ?`,
      )
      .get(saleId) as { id: number };

    // Simulate the sale being a session-basket member — the SAME linkage
    // `_sessionIdForTransaction` reads (customer_session_transactions.
    // unified_transaction_id), regardless of how the session flow itself
    // wrote it.
    db.prepare(
      `INSERT INTO customer_session_transactions
       (tenant_id, session_id, transaction_type, transaction_id, unified_transaction_id)
       VALUES (1, 42, 'sales', ?, ?)`,
    ).run(saleId, saleTxn.id);

    const beforeGeneral = drawerBalance(db, "General", "USD");
    const MESSAGE =
      "This sale was paid through a customer session — refund it from the session basket.";

    expect(() =>
      salesRepo.refundSaleItem({
        saleId,
        saleItemId,
        refundQuantity: 1,
        userId: 1,
      }),
    ).toThrow(MESSAGE);
    expect(drawerBalance(db, "General", "USD")).toBe(beforeGeneral);

    const txnRepo = getTransactionRepository();
    expect(() => txnRepo.refundBySaleId(saleId, 1)).toThrow(MESSAGE);
    expect(drawerBalance(db, "General", "USD")).toBe(beforeGeneral);

    const refundedQty = (
      db
        .prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`)
        .get(saleItemId) as { refunded_quantity: number }
    ).refunded_quantity;
    expect(refundedQty).toBe(0);
    const saleStatus = (
      db.prepare(`SELECT status FROM sales WHERE id = ?`).get(saleId) as {
        status: string;
      }
    ).status;
    expect(saleStatus).toBe("completed");
  });
});
