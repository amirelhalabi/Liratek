/**
 * InventoryService.resolveScanCode — LIRA-143 Phase 3, owner decision #2:
 * a scanned/typed code resolves barcode-first, then an active (IN_STOCK)
 * unit IMEI, preselecting the matched unit.
 *
 * House style (same as InventoryService.stockAdjustment.test.ts): real
 * ProductRepository/ProductUnitRepository over an in-memory SQLite DB via
 * the `__LIRATEK_TEST_DB__` test hook, not fully mocked repos — the
 * process-wide fixed tenant context (packages/core/src/jest.setup.ts,
 * tenant 1) means no explicit `runWithTenant()` wrapping is needed here.
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../../repositories/ProductRepository.js";
import { ProductUnitRepository } from "../../repositories/ProductUnitRepository.js";
import { InventoryService } from "../InventoryService.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // Same house rationale as ProductUnitRepository.test.ts: the "dangling
  // product" scenario below deletes a product row while a product_units
  // row still points at it, which would otherwise trip the real
  // `product_id REFERENCES products(id)` FK.
  db.pragma("foreign_keys = OFF");
  // `product_categories` + `products.category_id`/`warranty_months` added
  // 2026-08-25 alongside the `findProductDtoById` fix (ProductRepository.ts)
  // — `resolveScanCode` now returns the DTO shape (LEFT JOIN
  // product_categories), matching every consumer's declared type
  // (electron.d.ts's `Product`) instead of the raw `ProductEntity` shape
  // that crashed the POS scan-add cart line. This fixture predates that
  // join and never needed the table before.
  db.exec(`
    CREATE TABLE product_categories (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      name               TEXT NOT NULL,
      tracks_imei_units  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE products (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      barcode            TEXT,
      name               TEXT NOT NULL,
      item_type          TEXT NOT NULL DEFAULT 'Product',
      category           TEXT,
      category_id        INTEGER,
      description        TEXT,
      cost_price_usd     REAL DEFAULT 0,
      selling_price_usd  REAL DEFAULT 0,
      min_stock_level    INTEGER DEFAULT 5,
      stock_quantity     INTEGER DEFAULT 0,
      imei               TEXT,
      color              TEXT,
      image_url          TEXT,
      status             TEXT DEFAULT 'Active',
      warranty_months    INTEGER,
      is_active          INTEGER NOT NULL DEFAULT 1,
      is_deleted         INTEGER NOT NULL DEFAULT 0,
      supplier           TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE product_units (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER DEFAULT 1,
      product_id               INTEGER NOT NULL REFERENCES products(id),
      imei                     TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK', 'SOLD')),
      sale_item_id             INTEGER,
      is_defective             INTEGER NOT NULL DEFAULT 0,
      warranty_override_until  TEXT,
      created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_product_units_active_imei ON product_units(tenant_id, imei) WHERE status = 'IN_STOCK';
  `);
  return db;
}

function insertProduct(
  db: Database.Database,
  opts: { name: string; barcode?: string | null; isActive?: boolean },
): number {
  const result = db
    .prepare(`INSERT INTO products (name, barcode, is_active) VALUES (?, ?, ?)`)
    .run(opts.name, opts.barcode ?? null, opts.isActive === false ? 0 : 1);
  return Number(result.lastInsertRowid);
}

function insertUnit(
  db: Database.Database,
  opts: { productId: number; imei: string; status?: "IN_STOCK" | "SOLD" },
): number {
  const result = db
    .prepare(
      `INSERT INTO product_units (product_id, imei, status) VALUES (?, ?, ?)`,
    )
    .run(opts.productId, opts.imei, opts.status ?? "IN_STOCK");
  return Number(result.lastInsertRowid);
}

describe("InventoryService.resolveScanCode (LIRA-143 Phase 3)", () => {
  let db: Database.Database;
  let service: InventoryService;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    service = new InventoryService(
      new ProductRepository(),
      undefined,
      new ProductUnitRepository(),
    );
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("resolves an exact barcode hit with matched_unit null", () => {
    const productId = insertProduct(db, {
      name: "iPhone 13",
      barcode: "1234567890",
    });

    const result = service.resolveScanCode("1234567890");

    expect(result).not.toBeNull();
    expect(result!.product.id).toBe(productId);
    expect(result!.matched_unit).toBeNull();
  });

  it("barcode wins over IMEI when the same code is both a barcode of product A and an IMEI on product B", () => {
    const productA = insertProduct(db, {
      name: "Product A",
      barcode: "SHARED123",
    });
    const productB = insertProduct(db, { name: "Product B" });
    insertUnit(db, { productId: productB, imei: "SHARED123" });

    const result = service.resolveScanCode("SHARED123");

    expect(result).not.toBeNull();
    expect(result!.product.id).toBe(productA);
    expect(result!.matched_unit).toBeNull();
    void productB;
  });

  it("falls back to an active unit IMEI when no barcode matches, and preselects that unit", () => {
    const productId = insertProduct(db, { name: "Galaxy S23" });
    const unitId = insertUnit(db, {
      productId,
      imei: "356938035643809",
    });

    const result = service.resolveScanCode("356938035643809");

    expect(result).not.toBeNull();
    expect(result!.product.id).toBe(productId);
    expect(result!.matched_unit).not.toBeNull();
    expect(result!.matched_unit!.id).toBe(unitId);
    expect(result!.matched_unit!.imei).toBe("356938035643809");
  });

  it("does not fall back to a SOLD unit's IMEI — only IN_STOCK units resolve a scan", () => {
    const productId = insertProduct(db, { name: "Galaxy S23" });
    insertUnit(db, {
      productId,
      imei: "111122223333444",
      status: "SOLD",
    });

    const result = service.resolveScanCode("111122223333444");

    expect(result).toBeNull();
  });

  it("returns null for a code that matches neither a barcode nor any active unit IMEI", () => {
    insertProduct(db, { name: "iPhone 13", barcode: "1234567890" });

    const result = service.resolveScanCode("no-such-code");

    expect(result).toBeNull();
  });

  it("returns null for a blank or whitespace-only code", () => {
    expect(service.resolveScanCode("")).toBeNull();
    expect(service.resolveScanCode("   ")).toBeNull();
  });

  it("trims the code before resolving", () => {
    const productId = insertProduct(db, {
      name: "iPhone 13",
      barcode: "1234567890",
    });

    const result = service.resolveScanCode("  1234567890  ");
    expect(result!.product.id).toBe(productId);
  });

  it("returns null (and does not throw) when an active unit points at a product row that no longer exists", () => {
    const productId = insertProduct(db, { name: "Ghost Product" });
    insertUnit(db, { productId, imei: "555566667777888" });
    db.prepare(`DELETE FROM products WHERE id = ?`).run(productId);

    expect(() => service.resolveScanCode("555566667777888")).not.toThrow();
    expect(service.resolveScanCode("555566667777888")).toBeNull();
  });

  it("returns null (and does not throw) when an active unit's product is soft-deleted/inactive", () => {
    const productId = insertProduct(db, {
      name: "Deactivated Product",
      isActive: false,
    });
    insertUnit(db, { productId, imei: "222233334444555" });

    expect(service.resolveScanCode("222233334444555")).toBeNull();
  });
});
