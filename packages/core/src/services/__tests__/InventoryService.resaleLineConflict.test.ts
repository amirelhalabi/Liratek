/**
 * LIRA-309 (FR-005) — a phone number is a shop line OR a line held for sale,
 * never both. The Inventory side: creating or editing a lines-category
 * product may not take the number of an ACTIVE shop line, however it is
 * typed. (The other direction lives in CarrierLineService.)
 *
 * Written before the guard; first run failed (both creates/updates
 * succeeded).
 */
import Database from "better-sqlite3";
import { ProductRepository } from "../../repositories/ProductRepository.js";
import { InventoryService } from "../InventoryService.js";
import { LINE_NUMBER_TAKEN_ERROR } from "../ResaleLineService.js";

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

    -- Referenced by ProductRepository.search's IMEI-match EXISTS subquery at
    -- PREPARE time regardless of row count — must exist even though no test
    -- here seeds a unit (same reasoning as product_stock_batches below).
    CREATE TABLE product_units (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER DEFAULT 1,
      product_id               INTEGER NOT NULL,
      imei                     TEXT,
      status                   TEXT NOT NULL DEFAULT 'IN_STOCK',
      sale_item_id             INTEGER,
      is_defective             INTEGER NOT NULL DEFAULT 0,
      warranty_override_until  TEXT,
      created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by ProductRepository's correlated cost_tiers subquery at
    -- PREPARE time regardless of row count (see categoryResolution.test.ts's
    -- matching comment) — must exist even though no test here seeds a batch.
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
    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      days_owed           INTEGER NOT NULL DEFAULT 0,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("InventoryService — a for-sale line may not take a shop line's number (LIRA-309)", () => {
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
    db.exec(`DELETE FROM products; DELETE FROM product_categories; DELETE FROM carrier_lines;`);
    db.prepare(
      `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, is_active) VALUES (1, 'mtc', '03 555 101', 1)`,
    ).run();
  });

  const line = (barcode: string, category = "Phone Lines") => ({
    barcode,
    name: `Line ${barcode}`,
    category,
    cost_price: 15,
    retail_price: 25,
  });

  it("refuses to create a for-sale line with an active shop line's number", () => {
    const result = service.createProduct(line("+961 3 555 101"));
    expect(result).toMatchObject({ success: false, error: LINE_NUMBER_TAKEN_ERROR });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM products`).get()).toEqual({ n: 0 });
  });

  it("refuses to change a for-sale line's number to an active shop line's number", () => {
    const created = service.createProduct(line("03 999 999"));
    expect(created.success).toBe(true);
    const result = service.updateProduct(created.id as number, {
      ...line("03-555-101"),
      min_stock_level: 0,
    });
    expect(result).toMatchObject({ success: false, error: LINE_NUMBER_TAKEN_ERROR });
  });

  it("allows the number again once the shop line is archived", () => {
    db.exec(`UPDATE carrier_lines SET is_active = 0`);
    expect(service.createProduct(line("03 555 101")).success).toBe(true);
  });

  it("never applies to a product outside a lines category", () => {
    expect(service.createProduct(line("03555101", "Accessories")).success).toBe(true);
  });
});
