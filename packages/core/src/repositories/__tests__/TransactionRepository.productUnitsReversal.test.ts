/**
 * TransactionRepository — LIRA-143 phase 4, rule 20 reversal owner for a
 * SALE's `product_units` side effects (`_reverseProductUnits`), plus the
 * `_restoreStock` over-restore fix that rides along in this same phase.
 *
 * Hand-built schema (same shape as SalesRepository.imeiUnitsWarranty.test.ts)
 * so a real `SalesRepository.processSale`/`refundSaleItem` call produces the
 * SALE transaction, payments, and product_units rows this file then
 * void/refunds through `TransactionRepository`.
 *
 * Rule 17 (failing-first): every scenario below was verified to FAIL against
 * a temporarily-reverted implementation before this file was finalized:
 *   - "void flips ... back to IN_STOCK" / "refund flips ... back to IN_STOCK":
 *     verified RED when the `this._reverseProductUnits(...)` call was
 *     commented out of the void/refund step list respectively (units stayed
 *     SOLD after void/refund).
 *   - "throws before any flip when refundUnitExtras targets a foreign unit":
 *     verified RED when the `_validateRefundUnitExtras` call inside
 *     `_reverseProductUnits` was commented out (the foreign unit's flags got
 *     silently written instead of throwing).
 *   - "restores stock to EXACTLY the original amount": verified RED when
 *     `_restoreStock`'s fix was reverted to the old
 *     `SELECT product_id, quantity FROM sale_items` (no
 *     `refunded_quantity` subtraction) — stock over-restored by the quantity
 *     already returned via the earlier per-item refund.
 * See the handover notes for the exact revert diff + failure output per case.
 */

import Database from "better-sqlite3";
import { SalesRepository, type SaleRequest } from "../SalesRepository.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { resetProductUnitRepository } from "../ProductUnitRepository.js";
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
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
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

function insertUnit(db: Database.Database, productId: number, imei: string): number {
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
): {
  status: string;
  is_defective: number;
  warranty_override_until: string | null;
} {
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

function getStock(db: Database.Database, productId: number): number {
  return (
    db
      .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
      .get(productId) as { stock_quantity: number }
  ).stock_quantity;
}

function getSaleTxnId(db: Database.Database, saleId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'SALE' AND source_table = 'sales' AND source_id = ?`,
      )
      .get(saleId) as { id: number }
  ).id;
}

describe("TransactionRepository — product_units reversal owner (LIRA-143 phase 4, rule 20)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetProductUnitRepository();
    salesRepo = new SalesRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetProductUnitRepository();
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

  function sellTwoUnits(): {
    saleId: number;
    productId: number;
    unitA: number;
    unitB: number;
    txnId: number;
  } {
    const productId = insertProduct(db, { name: "iPhone 13", stockQuantity: 5 });
    const unitA = insertUnit(db, productId, "AAAAAAAAAAAAAAA");
    const unitB = insertUnit(db, productId, "BBBBBBBBBBBBBBB");
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
    return { saleId, productId, unitA, unitB, txnId: getSaleTxnId(db, saleId) };
  }

  describe("whole-sale refund", () => {
    it("flips both SOLD units back to IN_STOCK, restores stock exactly, and applies per-unit extras", () => {
      const { productId, unitA, unitB, txnId } = sellTwoUnits();
      const stockAfterSale = getStock(db, productId); // 5 - 2 = 3

      const txnRepo = getTransactionRepository();
      txnRepo.refundTransaction(txnId, 1, {
        refundUnitExtras: [
          { unit_id: unitA, is_defective: true, warranty_override_until: "2027-01-01" },
        ],
      });

      expect(getUnit(db, unitA)).toEqual({
        status: "IN_STOCK",
        is_defective: 1,
        warranty_override_until: "2027-01-01",
      });
      // unitB got no extras — flips back untouched.
      expect(getUnit(db, unitB)).toEqual({
        status: "IN_STOCK",
        is_defective: 0,
        warranty_override_until: null,
      });
      expect(getStock(db, productId)).toBe(stockAfterSale + 2);
    });

    it("throws before any flip when refundUnitExtras targets a unit from another sale", () => {
      const { unitA, txnId } = sellTwoUnits();

      const otherProductId = insertProduct(db, { name: "Samsung S23" });
      const foreignUnit = insertUnit(db, otherProductId, "FFFFFFFFFFFFFFF");
      const otherSale = salesRepo.processSale(
        baseSale({
          items: [
            {
              product_id: otherProductId,
              quantity: 1,
              price: 300,
              product_unit_id: foreignUnit,
            },
          ],
          total_amount: 300,
          final_amount: 300,
          payment_usd: 300,
        }),
        1,
      );
      expect(otherSale.success).toBe(true);

      const txnRepo = getTransactionRepository();
      expect(() =>
        txnRepo.refundTransaction(txnId, 1, {
          refundUnitExtras: [{ unit_id: foreignUnit, is_defective: true }],
        }),
      ).toThrow(/not linked to sale/i);

      // Nothing was flipped — the whole call rolled back before touching
      // even the legitimate units on THIS sale.
      expect(getUnit(db, unitA).status).toBe("SOLD");
      // The foreign unit's own (unrelated) sale is untouched too.
      expect(getUnit(db, foreignUnit).status).toBe("SOLD");
    });
  });

  describe("whole-sale void", () => {
    it("flips both SOLD units back to IN_STOCK with no extras", () => {
      const { unitA, unitB, txnId } = sellTwoUnits();

      getTransactionRepository().voidTransaction(txnId, 1);

      expect(getUnit(db, unitA).status).toBe("IN_STOCK");
      expect(getUnit(db, unitB).status).toBe("IN_STOCK");
    });
  });

  // Adversarial-review finding 2 (MAJOR): unit A (imei X) is SOLD, then the
  // same imei X is legitimately re-registered IN_STOCK on a different
  // product B (decision #3 allows this while A is SOLD). Refunding A's sale
  // now makes `_reverseProductUnits` → `markInStock(A)` collide with the
  // partial unique index. The refund correctly rolls back either way
  // (proven passing today); the failing-first proof is the ERROR MESSAGE —
  // unfixed, it's the raw `UNIQUE constraint failed: product_units.
  // tenant_id, product_units.imei` instead of the named, actionable one.
  describe("whole-sale refund vs. a re-registered IMEI collision (adversarial-review finding 2)", () => {
    it("throws the named collision error and rolls back the WHOLE refund — sale stays completed, stock/units unchanged, no REFUND row", () => {
      const productId = insertProduct(db, { name: "iPhone 13", stockQuantity: 5 });
      const unitA = insertUnit(db, productId, "CCCCCCCCCCCCCCC");
      const result = salesRepo.processSale(
        baseSale({
          items: [
            { product_id: productId, quantity: 1, price: 500, product_unit_id: unitA },
          ],
          total_amount: 500,
          final_amount: 500,
          payment_usd: 500,
        }),
        1,
      );
      expect(result.success).toBe(true);
      const saleId = result.id!;
      const txnId = getSaleTxnId(db, saleId);
      const stockAfterSale = getStock(db, productId); // 5 - 1 = 4

      // Legitimately re-register the SAME imei on a different product
      // while unit A is SOLD (decision #3).
      const otherProductId = insertProduct(db, { name: "Galaxy S23" });
      const unitC = insertUnit(db, otherProductId, "CCCCCCCCCCCCCCC");

      const txnRepo = getTransactionRepository();
      expect(() => txnRepo.refundTransaction(txnId, 1)).toThrow(
        new RegExp(
          `Cannot return IMEI CCCCCCCCCCCCCCC to stock: it is currently registered in stock on product "Galaxy S23" \\(unit #${unitC}\\)`,
        ),
      );

      // Whole refund rolled back: sale row untouched, unit A still SOLD,
      // unit C still IN_STOCK and untouched, stock unchanged, no REFUND row.
      expect(getUnit(db, unitA).status).toBe("SOLD");
      expect(getUnit(db, unitC).status).toBe("IN_STOCK");
      expect(getStock(db, productId)).toBe(stockAfterSale);
      const saleStatus = db
        .prepare(`SELECT status FROM sales WHERE id = ?`)
        .get(saleId) as { status: string };
      expect(saleStatus.status).toBe("completed");
      const refundRow = db
        .prepare(`SELECT id FROM transactions WHERE type = 'REFUND' AND source_id = ?`)
        .get(saleId);
      expect(refundRow).toBeUndefined();
    });
  });

  describe("_restoreStock over-restore fix", () => {
    it("a full refund after a prior partial item refund restores stock to EXACTLY the original amount", () => {
      const productId = insertProduct(db, { name: "Charger", stockQuantity: 10 });
      const result = salesRepo.processSale(
        baseSale({
          items: [{ product_id: productId, quantity: 3, price: 10 }],
          total_amount: 30,
          final_amount: 30,
          payment_usd: 30,
        }),
        1,
      );
      expect(result.success).toBe(true);
      const saleId = result.id!;
      expect(getStock(db, productId)).toBe(7); // 10 - 3

      const saleItem = db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
        .get(saleId) as { id: number };
      salesRepo.refundSaleItem({
        saleId,
        saleItemId: saleItem.id,
        refundQuantity: 1,
        userId: 1,
      });
      expect(getStock(db, productId)).toBe(8); // 7 + 1 (partial restore)

      const txnId = getSaleTxnId(db, saleId);
      getTransactionRepository().refundTransaction(txnId, 1);

      // Only the REMAINING 2 units (3 - 1 already restored) come back —
      // landing exactly at the original 10, never 11.
      expect(getStock(db, productId)).toBe(10);
    });
  });
});
