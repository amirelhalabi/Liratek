/**
 * SalesRepository.refundSaleItem — LIRA-143 phase 4 per-item unit flip.
 *
 * Under the one-unit-per-line rule (`processSale` requires `quantity === 1`
 * for any unit-tracked line), refunding a unit-tracked `sale_items` row
 * always has exactly one linked `product_units` row to flip back to
 * IN_STOCK — no extras here; the phone-refund UI's defective/warranty-
 * override flagging lives only on the Transactions-page WHOLE-refund flow
 * (owner decision 2026-07-04), covered separately in
 * TransactionRepository.productUnitsReversal.test.ts.
 *
 * 2026-08-26 update: the second case here used to run a per-item refund and
 * then a WHOLE-sale `refundTransaction` on the same sale. That sequence is now
 * refused outright (owner decision — it double-debited the drawer by the
 * already-refunded share; see
 * TransactionRepository.partialRefundWholeGuard.test.ts), so the case asserts
 * the refusal and then completes the return through the per-item path, which
 * is the same no-double-effects proof for stock and units.
 *
 * Rule 17 (failing-first): "flips the linked SOLD unit back to IN_STOCK" was
 * verified RED when the 9b block (`if (this._productUnitsTableExists()) {
 * ... }` in `refundSaleItem`) was temporarily commented out — the unit
 * stayed SOLD after the per-item refund. "produces no double effects" was
 * verified RED (in TransactionRepository.productUnitsReversal.test.ts's
 * sibling proof) when `_restoreStock`'s refunded_quantity subtraction was
 * reverted — see that file's header for the exact revert. Restored + re-run
 * green before finalizing.
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

function getUnitStatus(db: Database.Database, id: number): string {
  return (
    db.prepare(`SELECT status FROM product_units WHERE id = ?`).get(id) as {
      status: string;
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

describe("SalesRepository.refundSaleItem — product_units per-item flip (LIRA-143 phase 4)", () => {
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

  it("flips the linked SOLD unit back to IN_STOCK when its sale_items line is refunded", () => {
    const productId = insertProduct(db, { name: "iPhone 13", stockQuantity: 5 });
    const unitId = insertUnit(db, productId, "CCCCCCCCCCCCCCC");

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
    expect(getUnitStatus(db, unitId)).toBe("SOLD");

    const saleItem = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
      .get(saleId) as { id: number };

    salesRepo.refundSaleItem({
      saleId,
      saleItemId: saleItem.id,
      refundQuantity: 1,
      userId: 1,
    });

    expect(getUnitStatus(db, unitId)).toBe("IN_STOCK");
  });

  it("a unit line refunded via refundSaleItem blocks the whole-sale refund; refunding the remaining line produces no double effects", () => {
    const productId = insertProduct(db, { name: "iPhone 13", stockQuantity: 5 });
    const unitA = insertUnit(db, productId, "DDDDDDDDDDDDDDD");
    const unitB = insertUnit(db, productId, "EEEEEEEEEEEEEEE");

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
    const stockAfterSale = getStock(db, productId); // 5 - 2 = 3

    const items = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC`)
      .all(saleId) as { id: number }[];
    expect(items).toHaveLength(2);

    // Refund unit A's line individually first.
    salesRepo.refundSaleItem({
      saleId,
      saleItemId: items[0].id,
      refundQuantity: 1,
      userId: 1,
    });
    expect(getUnitStatus(db, unitA)).toBe("IN_STOCK");
    expect(getUnitStatus(db, unitB)).toBe("SOLD");
    expect(getStock(db, productId)).toBe(stockAfterSale + 1);

    // A whole-sale refund is now REFUSED once any line has been
    // item-refunded (owner decision 2026-08-26) — the money half of this
    // sequence double-debited the drawer, and no netting of the payment legs
    // is reconstructible. See
    // TransactionRepository.partialRefundWholeGuard.test.ts.
    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'SALE' AND source_table = 'sales' AND source_id = ?`,
      )
      .get(saleId) as { id: number };
    expect(() => getTransactionRepository().refundTransaction(txn.id, 1)).toThrow(
      /This sale was partially refunded/,
    );
    // Refused before any write: unit B is still SOLD and stock is unmoved.
    expect(getUnitStatus(db, unitB)).toBe("SOLD");
    expect(getStock(db, productId)).toBe(stockAfterSale + 1);

    // The remaining line goes back through the per-item path — the route the
    // operator is now directed to. Both units end IN_STOCK and stock lands on
    // EXACTLY the original 5, never 6.
    salesRepo.refundSaleItem({
      saleId,
      saleItemId: items[1].id,
      refundQuantity: 1,
      userId: 1,
    });
    expect(getUnitStatus(db, unitA)).toBe("IN_STOCK");
    expect(getUnitStatus(db, unitB)).toBe("IN_STOCK");
    expect(getStock(db, productId)).toBe(5);
  });
});
