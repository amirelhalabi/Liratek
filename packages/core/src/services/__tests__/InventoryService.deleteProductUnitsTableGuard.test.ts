/**
 * InventoryService.deleteProduct / batchDeleteProducts — the LIRA-148
 * `product_units` TABLE-ABSENT guard.
 *
 * ## The bug
 *
 * Both methods wrap the soft delete and the IN_STOCK unit cascade
 * (`ProductUnitRepository.deleteInStockForProduct(s)`) in ONE
 * `productUnitRepo.transaction(...)`. `deleteInStockForProduct(s)` queries
 * `product_units` UNCONDITIONALLY. On a pre-v157 database — or any
 * hand-built test schema that never created the table — that query throws
 * `no such table: product_units`, the transaction rolls back, and the soft
 * delete is lost along with a cascade that was never applicable to begin
 * with. Every OTHER `product_units` consumer in this codebase already
 * guards with a cached `sqlite_master` probe
 * (`TransactionRepository._productUnitsTableExists`); this pair of methods
 * did not.
 *
 * ## The fix
 *
 * `ProductUnitRepository.productUnitsTableExists()` (delegating to the new
 * `BaseRepository.tableExists`, rule 14 — one probe owner) lets the service
 * ASK before cascading, without the service ever touching the database
 * itself (rule 13): when the table is absent, the cascade is skipped and
 * substituted with `deleteInStockForProducts`'s own empty-result shape
 * (`{ count: 0, imeis: [] }`) — the soft delete always runs either way.
 *
 * ## Rule 17 — failing-first, recorded
 *
 * Run against the pre-fix code (the cascade called unconditionally, no
 * `productUnitsTableExists()` guard), the "table absent" cases below failed
 * with the delete itself reporting failure, not merely a missing cascade —
 * i.e. the exact bug this guard fixes: losing the soft delete along with an
 * inapplicable cascade. See the ticket handover for the captured verbatim
 * failure text; the mechanism is pinned here by these same tests staying
 * green post-fix.
 *
 * ## Fresh instances per schema variant
 *
 * `BaseRepository.tableExists` caches its answer per REPOSITORY INSTANCE
 * (the schema shape never changes once a process is up) — so every case
 * below builds its own `Database`, its own fresh `ProductRepository` /
 * `ProductUnitRepository`, and its own `InventoryService` wired to them
 * explicitly (never the module singletons, which would leak a cached
 * answer — or a cached db handle — from a previous case).
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../../repositories/ProductRepository.js";
import { ProductUnitRepository } from "../../repositories/ProductUnitRepository.js";
import { InventoryService } from "../InventoryService.js";
import { runWithTenant } from "../../db/tenantContext.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

/**
 * `tenants` + `products` only — exactly the tables/columns
 * `ProductRepository.softDeleteById`/`batchSoftDelete` touch (`id`,
 * `tenant_id`, `is_deleted`, `updated_at`, both tenant-scoped via
 * `WHERE ... AND tenant_id = ?`). Deliberately does NOT create
 * `product_units` — that absence is the case under test.
 */
function createSchemaWithoutProductUnits(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

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

/** Same base schema, PLUS `product_units` — the regression-guard variant,
 *  proving the fix did not disable the cascade generally. */
function createSchemaWithProductUnits(): Database.Database {
  const db = createSchemaWithoutProductUnits();
  db.exec(`
    CREATE TABLE product_units (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER REFERENCES tenants(id),
      product_id               INTEGER NOT NULL REFERENCES products(id),
      imei                     TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK', 'SOLD')),
      sale_item_id             INTEGER,
      is_defective             INTEGER NOT NULL DEFAULT 0,
      warranty_override_until  TEXT,
      created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_product_units_active_imei ON product_units(tenant_id, imei) WHERE status = 'IN_STOCK';
  `);
  return db;
}

/** Wires the test DB into `getDatabase()`'s test hook and builds a fresh
 *  repo/service trio for it — never a module singleton (rule: fresh
 *  instances per schema variant, see file doc). */
function buildService(db: Database.Database): {
  service: InventoryService;
  productRepo: ProductRepository;
  unitRepo: ProductUnitRepository;
} {
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  const productRepo = new ProductRepository();
  const unitRepo = new ProductUnitRepository();
  const service = new InventoryService(productRepo, undefined, unitRepo);
  return { service, productRepo, unitRepo };
}

function insertProduct(db: Database.Database, name: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, stock_quantity) VALUES (1, ?, 3)`,
      )
      .run(name).lastInsertRowid,
  );
}

function isDeleted(db: Database.Database, productId: number): number {
  return (
    db
      .prepare(`SELECT is_deleted FROM products WHERE id = ?`)
      .get(productId) as { is_deleted: number }
  ).is_deleted;
}

describe("InventoryService — product_units table-absent guard (LIRA-148)", () => {
  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  });

  describe("schema WITHOUT product_units — cascade must be skipped, not the delete", () => {
    it("deleteProduct still soft-deletes the product", () => {
      const db = createSchemaWithoutProductUnits();
      const { service } = buildService(db);
      const productId = insertProduct(db, "USB Cable");

      const result = runWithTenant(1, () => service.deleteProduct(productId));

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.removed_unit_count).toBeUndefined();
      expect(result.removed_unit_imeis).toBeUndefined();
      expect(isDeleted(db, productId)).toBe(1);

      db.close();
    });

    it("batchDeleteProducts still soft-deletes every id in the batch", () => {
      const db = createSchemaWithoutProductUnits();
      const { service } = buildService(db);
      const first = insertProduct(db, "USB Cable");
      const second = insertProduct(db, "Screen Protector");

      const result = runWithTenant(1, () =>
        service.batchDeleteProducts([first, second]),
      );

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(2);
      expect(result.removed_unit_count).toBeUndefined();
      expect(result.removed_unit_imeis).toBeUndefined();
      expect(isDeleted(db, first)).toBe(1);
      expect(isDeleted(db, second)).toBe(1);

      db.close();
    });
  });

  describe("schema WITH product_units — regression guard: cascade still runs", () => {
    it("deleteProduct still removes the product's IN_STOCK units", () => {
      const db = createSchemaWithProductUnits();
      const { service, unitRepo } = buildService(db);
      const productId = insertProduct(db, "iPhone 13");
      runWithTenant(1, () =>
        unitRepo.addUnits(productId, ["222000000000001", "222000000000002"]),
      );

      const result = runWithTenant(1, () => service.deleteProduct(productId));

      expect(result.success).toBe(true);
      expect(result.removed_unit_count).toBe(2);
      expect(result.removed_unit_imeis).toEqual([
        "222000000000001",
        "222000000000002",
      ]);
      expect(isDeleted(db, productId)).toBe(1);
      expect(
        db
          .prepare(`SELECT COUNT(*) AS c FROM product_units WHERE product_id = ?`)
          .get(productId) as { c: number },
      ).toEqual({ c: 0 });

      db.close();
    });

    it("batchDeleteProducts still removes IN_STOCK units for every id in the batch", () => {
      const db = createSchemaWithProductUnits();
      const { service, unitRepo } = buildService(db);
      const first = insertProduct(db, "iPhone 13");
      const second = insertProduct(db, "Galaxy S23");
      runWithTenant(1, () => {
        unitRepo.addUnits(first, ["223000000000001"]);
        unitRepo.addUnits(second, ["223000000000002"]);
      });

      const result = runWithTenant(1, () =>
        service.batchDeleteProducts([first, second]),
      );

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(2);
      expect(result.removed_unit_count).toBe(2);
      expect(result.removed_unit_imeis).toEqual([
        "223000000000001",
        "223000000000002",
      ]);
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM product_units`).get() as {
          c: number;
        },
      ).toEqual({ c: 0 });

      db.close();
    });
  });
});
