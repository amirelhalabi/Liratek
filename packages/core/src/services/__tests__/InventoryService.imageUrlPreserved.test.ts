/**
 * LIRA-222 — every product edit silently NULLs the product's image.
 *
 * `ProductRepository.updateProductFull` writes `image_url = ?` UNCONDITIONALLY
 * with `data.image_url ?? null`, while `InventoryService.updateProduct` only
 * forwards `image_url` in the payload when it is non-null (`...(data.image_url
 * != null ? { image_url: data.image_url } : {})`). The product edit form never
 * sends one (no image-upload UI exists yet — `frontend/src/features/inventory
 * /pages/Inventory/ProductForm.tsx` has no `image_url` field), so every
 * ordinary edit reaches `updateProductFull` with the key ABSENT, which binds
 * `undefined ?? null` -> `null` and NULLs a previously-set image on an
 * otherwise unrelated field edit.
 *
 * Reproduced first (rule 28/17), through the real `InventoryService.updateProduct`
 * path — not by reading `updateProductFull` in isolation — over a real
 * in-memory SQLite DB (house style, same fixture as
 * InventoryService.categoryResolution.test.ts).
 *
 * The fix mirrors the already-correct sibling column: `category`/`category_id`
 * (and the repo's OTHER, unused `updateProduct` method) both write
 * `image_url = COALESCE(?, image_url)` — an omitted/undefined value leaves the
 * stored one untouched. `updateProductFull`'s image_url column is the only
 * one of its SET-list columns with this shape: every other field
 * (barcode/name/cost_price/retail_price/min_stock_level/supplier/
 * warranty_months) is REQUIRED or always forwarded by
 * `InventoryService.updateProduct` on every call (see its own comments), so
 * none of them can go silently missing the way image_url does — swept and
 * confirmed, not assumed.
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../../repositories/ProductRepository.js";
import { InventoryService } from "../InventoryService.js";

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
      name               TEXT NOT NULL COLLATE NOCASE,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      is_active          INTEGER NOT NULL DEFAULT 1,
      tracks_imei_units  INTEGER NOT NULL DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, name)
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

    -- ProductRepository.findAllProducts always SELECTs a correlated subquery
    -- over this table (v165, COST_TIERS_SUBQUERY) — required to exist even
    -- though this file never inserts a batch (see
    -- InventoryService.categoryResolution.test.ts's matching comment).
    CREATE TABLE product_stock_batches (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      product_id         INTEGER NOT NULL,
      supplier_id        INTEGER,
      quantity           INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd      DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt         INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id    INTEGER,
      transaction_id     INTEGER,
      is_opening         INTEGER NOT NULL DEFAULT 0,
      created_by         INTEGER,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("InventoryService.updateProduct — image_url survives an unrelated edit (LIRA-222)", () => {
  let db: Database.Database;
  let service: InventoryService;

  beforeAll(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    service = new InventoryService(new ProductRepository());
  });

  afterAll(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  beforeEach(() => {
    db.exec(`DELETE FROM products; DELETE FROM product_categories;`);
  });

  function imageUrlOf(productId: number): string | null {
    const row = db
      .prepare(`SELECT image_url FROM products WHERE id = ?`)
      .get(productId) as { image_url: string | null };
    return row.image_url;
  }

  it("keeps a previously-set image_url when the edit form's payload carries no image_url key at all", () => {
    const created = service.createProduct({
      barcode: "IMG-1111",
      name: "Product With Photo",
      category: "Accessories",
      cost_price: 10,
      retail_price: 20,
      image_url: "https://cdn.example.com/img-1111.jpg",
    });
    expect(created.success).toBe(true);
    const productId = created.id as number;
    expect(imageUrlOf(productId)).toBe("https://cdn.example.com/img-1111.jpg");

    // Exactly what ProductForm.tsx's `updatePayload` sends on an ordinary
    // edit — the form has no image_url field, so the key is ABSENT, not
    // explicitly null.
    const result = service.updateProduct(productId, {
      barcode: "IMG-1111",
      name: "Product With Photo (renamed)",
      category: "Accessories",
      cost_price: 12,
      retail_price: 22,
      min_stock_level: 5,
    });

    expect(result.success).toBe(true);
    // The bug: this used to read `null` — an unrelated field edit silently
    // destroyed the stored image.
    expect(imageUrlOf(productId)).toBe("https://cdn.example.com/img-1111.jpg");
  });

  it("still allows a caller that DOES pass image_url to change it", () => {
    const created = service.createProduct({
      barcode: "IMG-2222",
      name: "Product With Photo Two",
      category: "Accessories",
      cost_price: 10,
      retail_price: 20,
      image_url: "https://cdn.example.com/old.jpg",
    });
    const productId = created.id as number;

    const result = service.updateProduct(productId, {
      barcode: "IMG-2222",
      name: "Product With Photo Two",
      category: "Accessories",
      cost_price: 10,
      retail_price: 20,
      min_stock_level: 5,
      image_url: "https://cdn.example.com/new.jpg",
    });

    expect(result.success).toBe(true);
    expect(imageUrlOf(productId)).toBe("https://cdn.example.com/new.jpg");
  });
});
