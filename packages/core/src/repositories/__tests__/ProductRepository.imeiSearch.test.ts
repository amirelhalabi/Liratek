/**
 * ProductRepository — IMEI joins product search (LIRA-143 Phase 3, owner
 * decision #2: IMEI joins product search everywhere barcode works).
 *
 * Covers both search predicates named in CLAUDE.md rule 14 as the ONLY two
 * copies of the product search fragment: `findAllProducts` (aliased `p`)
 * and `search` (unaliased `products`) — both now OR in
 * `ProductRepository.unitImeiMatchFragment`, one extra `%term%` LIKE param
 * each, matching ALL unit statuses (decision #7 — a SOLD unit's IMEI must
 * still find its model).
 *
 * Hand-built minimal schema, same house pattern as
 * `ProductUnitRepository.test.ts` (products + product_units, no
 * create_db.sql base).
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
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one'), (2, 'Two', 'two');

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
    CREATE INDEX idx_product_units_tenant_id ON product_units(tenant_id);
    CREATE INDEX idx_product_units_imei ON product_units(tenant_id, imei);
    CREATE INDEX idx_product_units_product ON product_units(tenant_id, product_id, status);
  `);
  return db;
}

function insertProduct(
  db: Database.Database,
  opts: { tenantId: number; name: string },
): number {
  const result = db
    .prepare(
      `INSERT INTO products (tenant_id, name, barcode) VALUES (?, ?, ?)`,
    )
    .run(opts.tenantId, opts.name, null);
  return Number(result.lastInsertRowid);
}

function insertUnit(
  db: Database.Database,
  opts: {
    tenantId: number;
    productId: number;
    imei: string;
    status?: "IN_STOCK" | "SOLD";
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (?, ?, ?, ?)`,
    )
    .run(opts.tenantId, opts.productId, opts.imei, opts.status ?? "IN_STOCK");
  return Number(result.lastInsertRowid);
}

describe("ProductRepository — IMEI joins product search (LIRA-143 Phase 3)", () => {
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

  describe("findAllProducts(search)", () => {
    it("matches a product via a full unit IMEI term", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      insertUnit(db, { tenantId: 1, productId, imei: "356938035643809" });

      const results = runWithTenant(1, () =>
        repo.findAllProducts("356938035643809"),
      );
      expect(results.map((p) => p.id)).toEqual([productId]);
    });

    it("matches a product via a partial unit IMEI term", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const imei = "356938035643809";
      insertUnit(db, { tenantId: 1, productId, imei });

      // Sliced from the IMEI itself (not hand-transcribed) so the test can't
      // silently assert against a substring that was never actually there.
      const partial = imei.slice(4, 11);
      const results = runWithTenant(1, () => repo.findAllProducts(partial));
      expect(results.map((p) => p.id)).toEqual([productId]);
    });

    it("still matches via a SOLD unit's IMEI (decision #7)", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "Galaxy S23" });
      insertUnit(db, {
        tenantId: 1,
        productId,
        imei: "111122223333444",
        status: "SOLD",
      });

      const results = runWithTenant(1, () =>
        repo.findAllProducts("111122223333444"),
      );
      expect(results.map((p) => p.id)).toEqual([productId]);
    });

    it("does not match a unit IMEI belonging to a different tenant", () => {
      const productIdT1 = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const productIdT2 = insertProduct(db, { tenantId: 2, name: "iPhone 14" });
      insertUnit(db, {
        tenantId: 2,
        productId: productIdT2,
        imei: "999988887777666",
      });

      const results = runWithTenant(1, () =>
        repo.findAllProducts("999988887777666"),
      );
      expect(results).toHaveLength(0);

      // Sanity: tenant 2 (owning the unit) DOES find it.
      const resultsT2 = runWithTenant(2, () =>
        repo.findAllProducts("999988887777666"),
      );
      expect(resultsT2.map((p) => p.id)).toEqual([productIdT2]);
      void productIdT1;
    });

    it("returns nothing for a term matching neither name/barcode/category nor any unit IMEI", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      insertUnit(db, { tenantId: 1, productId, imei: "356938035643809" });

      const results = runWithTenant(1, () =>
        repo.findAllProducts("no-such-term-anywhere"),
      );
      expect(results).toHaveLength(0);
    });

    it("still matches by name when no IMEI is involved (existing behavior preserved)", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });

      const results = runWithTenant(1, () => repo.findAllProducts("iPhone"));
      expect(results.map((p) => p.id)).toEqual([productId]);
    });
  });

  describe("search(term)", () => {
    it("matches a product via a full unit IMEI term", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      insertUnit(db, { tenantId: 1, productId, imei: "356938035643809" });

      const results = runWithTenant(1, () =>
        repo.search("356938035643809"),
      );
      expect(results.map((p) => p.id)).toEqual([productId]);
    });

    it("matches a product via a partial unit IMEI term", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const imei = "356938035643809";
      insertUnit(db, { tenantId: 1, productId, imei });

      const partial = imei.slice(4, 11);
      const results = runWithTenant(1, () => repo.search(partial));
      expect(results.map((p) => p.id)).toEqual([productId]);
    });

    it("still matches via a SOLD unit's IMEI (decision #7)", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "Galaxy S23" });
      insertUnit(db, {
        tenantId: 1,
        productId,
        imei: "111122223333444",
        status: "SOLD",
      });

      const results = runWithTenant(1, () =>
        repo.search("111122223333444"),
      );
      expect(results.map((p) => p.id)).toEqual([productId]);
    });

    it("does not match a unit IMEI belonging to a different tenant", () => {
      const productIdT2 = insertProduct(db, { tenantId: 2, name: "iPhone 14" });
      insertUnit(db, {
        tenantId: 2,
        productId: productIdT2,
        imei: "999988887777666",
      });

      const results = runWithTenant(1, () =>
        repo.search("999988887777666"),
      );
      expect(results).toHaveLength(0);
    });

    it("returns nothing for a term matching neither name/barcode nor any unit IMEI", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      insertUnit(db, { tenantId: 1, productId, imei: "356938035643809" });

      const results = runWithTenant(1, () =>
        repo.search("no-such-term-anywhere"),
      );
      expect(results).toHaveLength(0);
    });

    it("still matches by name when no IMEI is involved (existing behavior preserved)", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });

      const results = runWithTenant(1, () => repo.search("iPhone"));
      expect(results.map((p) => p.id)).toEqual([productId]);
    });
  });
});
