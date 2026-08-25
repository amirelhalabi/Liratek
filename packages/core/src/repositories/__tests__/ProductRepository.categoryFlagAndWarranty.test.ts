/**
 * ProductRepository — tracks_imei_units projection + warranty_months
 * round-trip (LIRA-143 v157 decisions #4 and #9).
 *
 * `findAllProducts` (the source for POS/Inventory product lists, per
 * ProductDTO) must project the category's `tracks_imei_units` flag onto
 * every product row (0 for a product with no category), and
 * `warranty_months` (set on the product form, NOT inherited from the
 * category) must round-trip through createProduct and updateProductFull —
 * the live path InventoryService.updateProduct calls.
 *
 * Hand-built minimal schema, same house pattern as
 * `ProductRepository.imeiSearch.test.ts` (products + product_categories,
 * no create_db.sql base) — extended here with the two v157 columns the
 * imeiSearch fixture doesn't need.
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../ProductRepository";
import { runWithTenant } from "../../db/tenantContext";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL UNIQUE
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE product_categories (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
      name               TEXT NOT NULL,
      tracks_imei_units  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE products (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
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
      supplier           TEXT,
      status             TEXT DEFAULT 'Active',
      warranty_months    INTEGER,
      is_active          INTEGER NOT NULL DEFAULT 1,
      is_deleted         INTEGER NOT NULL DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function insertCategory(
  db: Database.Database,
  opts: { tenantId: number; name: string; tracksImeiUnits?: boolean },
): number {
  const result = db
    .prepare(
      `INSERT INTO product_categories (tenant_id, name, tracks_imei_units) VALUES (?, ?, ?)`,
    )
    .run(opts.tenantId, opts.name, opts.tracksImeiUnits ? 1 : 0);
  return Number(result.lastInsertRowid);
}

describe("ProductRepository — tracks_imei_units projection + warranty_months round-trip (LIRA-143 v157)", () => {
  let db: Database.Database;
  let repo: ProductRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    repo = new ProductRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  describe("findAllProducts(search) — tracks_imei_units", () => {
    it("returns tracks_imei_units=1 for a product in a flagged category", () => {
      const categoryId = insertCategory(db, {
        tenantId: 1,
        name: "Phones",
        tracksImeiUnits: true,
      });

      const created = runWithTenant(1, () =>
        repo.createProduct({
          barcode: "1111",
          name: "iPhone 13",
          category: "Phones",
          category_id: categoryId,
          cost_price: 100,
          retail_price: 200,
        }),
      );

      const results = runWithTenant(1, () => repo.findAllProducts());
      const product = results.find((p) => p.id === created.id);
      expect(product?.tracks_imei_units).toBe(1);
    });

    it("returns tracks_imei_units=0 for an uncategorized product", () => {
      const created = runWithTenant(1, () =>
        repo.createProduct({
          barcode: "2222",
          name: "USB Cable",
          category: "General",
          category_id: null,
          cost_price: 1,
          retail_price: 3,
        }),
      );

      const results = runWithTenant(1, () => repo.findAllProducts());
      const product = results.find((p) => p.id === created.id);
      expect(product?.tracks_imei_units).toBe(0);
    });

    it("returns tracks_imei_units=0 for a product in a non-flagged category", () => {
      const categoryId = insertCategory(db, {
        tenantId: 1,
        name: "Accessories",
        tracksImeiUnits: false,
      });

      const created = runWithTenant(1, () =>
        repo.createProduct({
          barcode: "3333",
          name: "Phone Case",
          category: "Accessories",
          category_id: categoryId,
          cost_price: 2,
          retail_price: 5,
        }),
      );

      const results = runWithTenant(1, () => repo.findAllProducts());
      const product = results.find((p) => p.id === created.id);
      expect(product?.tracks_imei_units).toBe(0);
    });
  });

  describe("warranty_months — create/update round-trip", () => {
    it("persists warranty_months on create and projects it via findAllProducts", () => {
      const created = runWithTenant(1, () =>
        repo.createProduct({
          barcode: "4444",
          name: "Galaxy S23",
          category: "Phones",
          cost_price: 300,
          retail_price: 500,
          warranty_months: 12,
        }),
      );

      const results = runWithTenant(1, () => repo.findAllProducts());
      const product = results.find((p) => p.id === created.id);
      expect(product?.warranty_months).toBe(12);
    });

    it("defaults warranty_months to null when omitted on create", () => {
      const created = runWithTenant(1, () =>
        repo.createProduct({
          barcode: "5555",
          name: "No Warranty Widget",
          category: "General",
          cost_price: 10,
          retail_price: 20,
        }),
      );

      const results = runWithTenant(1, () => repo.findAllProducts());
      const product = results.find((p) => p.id === created.id);
      expect(product?.warranty_months).toBeNull();
    });

    it("updates warranty_months via updateProductFull (the live update path)", () => {
      const created = runWithTenant(1, () =>
        repo.createProduct({
          barcode: "6666",
          name: "Pixel 8",
          category: "Phones",
          cost_price: 400,
          retail_price: 600,
          warranty_months: 6,
        }),
      );

      runWithTenant(1, () =>
        repo.updateProductFull(created.id, {
          barcode: "6666",
          name: "Pixel 8",
          category: "Phones",
          cost_price: 400,
          retail_price: 600,
          min_stock_level: 5,
          warranty_months: 24,
        }),
      );

      const results = runWithTenant(1, () => repo.findAllProducts());
      const product = results.find((p) => p.id === created.id);
      expect(product?.warranty_months).toBe(24);
    });

    it("clears warranty_months to null via updateProductFull when omitted", () => {
      const created = runWithTenant(1, () =>
        repo.createProduct({
          barcode: "7777",
          name: "Pixel 8 Pro",
          category: "Phones",
          cost_price: 400,
          retail_price: 600,
          warranty_months: 6,
        }),
      );

      runWithTenant(1, () =>
        repo.updateProductFull(created.id, {
          barcode: "7777",
          name: "Pixel 8 Pro",
          category: "Phones",
          cost_price: 400,
          retail_price: 600,
          min_stock_level: 5,
        }),
      );

      const results = runWithTenant(1, () => repo.findAllProducts());
      const product = results.find((p) => p.id === created.id);
      expect(product?.warranty_months).toBeNull();
    });
  });
});
