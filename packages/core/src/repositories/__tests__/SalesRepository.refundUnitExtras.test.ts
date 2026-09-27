/**
 * LIRA-231 follow-up (owner decision 2026-09-26) — the POS refund window
 * (`RefundMethodModal`, opened from `SaleDetailModal.tsx`'s "Refund Sale"/
 * "Refund item" buttons) gets the SAME "Returned phones" per-unit
 * defective/warranty-override flagging the Transactions page's whole-refund
 * flow has always had. That flagging previously lived ONLY on
 * `TransactionRepository.refundTransaction`'s `refundUnitExtras` (see the
 * now-stale comment this ticket removes, both in
 * `TransactionRepository._reverseProductUnits`'s doc and in
 * `SalesRepository.refundSaleItemUnitFlip.test.ts`'s header) — this file
 * proves the SAME capability now also reaches:
 *   1. `SalesRepository.refundSaleItem` (per-item refund) — a NEW
 *      `unitExtras` param, validated against THAT ITEM's own linked units
 *      only, applied via `ProductUnitRepository.markInStock` as the unit
 *      flips back to IN_STOCK.
 *   2. `TransactionRepository.refundBySaleId` (POS whole-sale refund) — a
 *      NEW `opts.refundUnitExtras` field, forwarded verbatim to the
 *      already-existing `refundTransaction`/`_reverseProductUnits` path.
 *
 * Rule 17 (failing-first) — every case below was run against the pre-fix
 * tree (`refundSaleItem` took no `unitExtras` param at all;
 * `refundBySaleId`'s `opts` type had no `refundUnitExtras` field) and
 * observed RED:
 *   - "a valid unitExtras...": TypeScript itself rejected the call
 *     (`Object literal may only specify known properties, and 'unitExtras'
 *     does not exist in type '{ ... }'`) — ts-jest's `diagnostics: false`
 *     lets it through at runtime, where the extra property was silently
 *     dropped by the 9b block reading `params.unitExtras` as `undefined`;
 *     the unit still flipped to IN_STOCK but `is_defective` stayed 0 and
 *     `warranty_override_until` stayed NULL. Assertion failed on both.
 *   - "an id belonging to a DIFFERENT sale item is rejected...": with no
 *     validation call at all, the extras were silently ignored (same
 *     drop-on-the-floor as above) instead of throwing — the
 *     `.toThrow(...)` assertion failed (nothing thrown), so the "nothing
 *     written" assertions after it never even ran under the old code path
 *     for the RIGHT reason (they'd have incorrectly passed anyway, which is
 *     exactly why the `.toThrow` is the load-bearing assertion here).
 *   - "a whole-sale POS refund forwards refundUnitExtras...": failed the
 *     same way as case 1 (`refundBySaleId`'s `opts` object had no such key
 *     to forward), unit flipped with flags unset.
 * Restored to the fixed shape, all three passed.
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

function getUnit(
  db: Database.Database,
  id: number,
): { status: string; is_defective: number; warranty_override_until: string | null } {
  return db
    .prepare(
      `SELECT status, is_defective, warranty_override_until FROM product_units WHERE id = ?`,
    )
    .get(id) as {
    status: string;
    is_defective: number;
    warranty_override_until: string | null;
  };
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

describe("SalesRepository/TransactionRepository — POS refund window 'Returned phones' (unitExtras)", () => {
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

  it("a valid unitExtras entry sets is_defective/warranty_override_until on exactly that unit", () => {
    const productId = insertProduct(db, "iPhone 13");
    const unitId = insertUnit(db, productId, "AAAAAAAAAAAAAAA");
    const result = salesRepo.processSale(
      baseSale({
        items: [
          { product_id: productId, quantity: 1, price: 500, product_unit_id: unitId },
        ],
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

    salesRepo.refundSaleItem({
      saleId,
      saleItemId: saleItem.id,
      refundQuantity: 1,
      userId: 1,
      unitExtras: [
        { unit_id: unitId, is_defective: true, warranty_override_until: "2027-01-01" },
      ],
    });

    const unit = getUnit(db, unitId);
    expect(unit.status).toBe("IN_STOCK");
    expect(unit.is_defective).toBe(1);
    expect(unit.warranty_override_until).toBe("2027-01-01");
  });

  it("a unit_id belonging to a DIFFERENT sale item is rejected — nothing is written", () => {
    const productId = insertProduct(db, "iPhone 13");
    const unitA = insertUnit(db, productId, "BBBBBBBBBBBBBBB");
    const unitB = insertUnit(db, productId, "CCCCCCCCCCCCCCC");
    const result = salesRepo.processSale(
      baseSale({
        items: [
          { product_id: productId, quantity: 1, price: 500, product_unit_id: unitA },
          { product_id: productId, quantity: 1, price: 500, product_unit_id: unitB },
        ],
        total_amount: 1000,
        final_amount: 1000,
        payment_usd: 1000,
      }),
      1,
    );
    expect(result.success).toBe(true);
    const saleId = result.id!;
    const items = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC`)
      .all(saleId) as { id: number }[];
    expect(items).toHaveLength(2);
    const itemA = items[0]; // linked to unitA
    const beforeGeneral = drawerBalance(db, "General", "USD");
    const beforeRefundedQty = (
      db
        .prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`)
        .get(itemA.id) as { refunded_quantity: number }
    ).refunded_quantity;

    // Refund item A's line, but the operator (bug, or malicious client)
    // targets unit B's id — B is linked to the OTHER sale_items line, not
    // this one.
    expect(() =>
      salesRepo.refundSaleItem({
        saleId,
        saleItemId: itemA.id,
        refundQuantity: 1,
        userId: 1,
        unitExtras: [{ unit_id: unitB, is_defective: true }],
      }),
    ).toThrow(/not linked/);

    // Nothing was written: unit A never flipped, refunded_quantity unmoved,
    // drawer unmoved, unit B untouched.
    expect(getUnit(db, unitA).status).toBe("SOLD");
    expect(getUnit(db, unitB).status).toBe("SOLD");
    expect(getUnit(db, unitB).is_defective).toBe(0);
    expect(drawerBalance(db, "General", "USD")).toBe(beforeGeneral);
    const afterRefundedQty = (
      db
        .prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`)
        .get(itemA.id) as { refunded_quantity: number }
    ).refunded_quantity;
    expect(afterRefundedQty).toBe(beforeRefundedQty);
  });

  it("a whole-sale POS refund forwards refundUnitExtras through refundBySaleId", () => {
    const productId = insertProduct(db, "iPhone 13");
    const unitId = insertUnit(db, productId, "DDDDDDDDDDDDDDD");
    const result = salesRepo.processSale(
      baseSale({
        items: [
          { product_id: productId, quantity: 1, price: 500, product_unit_id: unitId },
        ],
        total_amount: 500,
        final_amount: 500,
        payment_usd: 500,
      }),
      1,
    );
    expect(result.success).toBe(true);
    const saleId = result.id!;

    const txnRepo = getTransactionRepository();
    txnRepo.refundBySaleId(saleId, 1, {
      refundUnitExtras: [{ unit_id: unitId, is_defective: true }],
    });

    const unit = getUnit(db, unitId);
    expect(unit.status).toBe("IN_STOCK");
    expect(unit.is_defective).toBe(1);
  });
});
