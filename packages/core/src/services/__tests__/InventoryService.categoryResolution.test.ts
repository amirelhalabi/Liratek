/**
 * InventoryService — category NAME → `products.category_id` resolution
 * (rule 14/19b: ONE resolution path, BOTH transports).
 *
 * The gap this guards: the resolution used to live ONLY in the Electron IPC
 * handler (`inventory:create-product` / `inventory:update-product` called
 * `catRepo.getOrCreate(name)` and handed the service a pre-resolved
 * `category_id`). The REST twin (`backend/src/api/inventory.ts`) passes the
 * category NAME straight through, so a product created over the web got
 * `category_id` NULL — and since every product read COALESCEs
 * `tracks_imei_units` off the joined category, web-created products could
 * never track IMEI units (LIRA-143 decision #9). Worse on update:
 * `updateProductFull` writes `category_id` unconditionally, so a web EDIT
 * of a desktop-created product actively NULLed a correct id.
 *
 * Also pins the UPDATE contract that came out of that move: a category
 * omitted/blank on update leaves the product's existing `category` AND
 * `category_id` alone (it neither NULLs them, as HEAD did, nor invents a
 * 'General' row), and a caller-supplied `category_id` cannot contradict the
 * name it is stored next to.
 *
 * House style: real ProductRepository/CategoryRepository over an in-memory
 * SQLite DB via the `__LIRATEK_TEST_DB__` hook (same as
 * InventoryService.resolveScanCode.test.ts).
 *
 * Deliberately does NOT inject the category repository: the service's own
 * default wiring (`getCategoryRepository()`) is part of what needs proving,
 * since that is what both transports actually run. Hence ONE DB for the
 * whole file (the CategoryRepository singleton captures its handle on first
 * use and there is no reset hook for it) with the two tables truncated
 * between tests.
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../../repositories/ProductRepository.js";
import { InventoryService } from "../InventoryService.js";
import { runWithTenant } from "../../db/tenantContext.js";

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
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two');

    CREATE TABLE product_categories (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
      -- COLLATE NOCASE mirrors production (electron-app/create_db.sql:271):
      -- with UNIQUE (tenant_id, name) below, that is what makes the
      -- uniqueness case-INsensitive here as well, so a regression that
      -- inserted a case variant fails in this fixture the same way it would
      -- in the real DB (SQLITE_CONSTRAINT_UNIQUE) instead of passing quietly.
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
  `);
  return db;
}

describe("InventoryService — category name → category_id resolution", () => {
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

  function insertCategory(opts: {
    tenantId: number;
    name: string;
    tracksImeiUnits?: boolean;
  }): number {
    const result = db
      .prepare(
        `INSERT INTO product_categories (tenant_id, name, sort_order, tracks_imei_units) VALUES (?, ?, 1, ?)`,
      )
      .run(opts.tenantId, opts.name, opts.tracksImeiUnits ? 1 : 0);
    return Number(result.lastInsertRowid);
  }

  function categoryIdOf(productId: number): number | null {
    const row = db
      .prepare(`SELECT category_id FROM products WHERE id = ?`)
      .get(productId) as { category_id: number | null } | undefined;
    return row?.category_id ?? null;
  }

  /** The product's stored (free-text) category and name, straight off the row. */
  function rowOf(productId: number): { name: string; category: string | null } {
    return db
      .prepare(`SELECT name, category FROM products WHERE id = ?`)
      .get(productId) as { name: string; category: string | null };
  }

  function categoryRowsNamed(
    name: string,
  ): { id: number; tenant_id: number }[] {
    return db
      .prepare(
        `SELECT id, tenant_id FROM product_categories WHERE name = ? COLLATE NOCASE`,
      )
      .all(name) as { id: number; tenant_id: number }[];
  }

  /** tracks_imei_units as the PRODUCT READ projects it (the COALESCE join). */
  function flagOf(productId: number): number | undefined {
    return service.getProducts().find((p) => p.id === productId)
      ?.tracks_imei_units;
  }

  describe("createProduct", () => {
    it("stamps category_id from the category NAME so the read projects tracks_imei_units", () => {
      const categoryId = insertCategory({
        tenantId: 1,
        name: "Phones",
        tracksImeiUnits: true,
      });

      // NO category_id in the payload — exactly what the REST route sends.
      const result = service.createProduct({
        barcode: "CR-1111",
        name: "iPhone 15",
        category: "Phones",
        cost_price: 100,
        retail_price: 200,
      });

      expect(result.success).toBe(true);
      expect(categoryIdOf(result.id as number)).toBe(categoryId);
      expect(flagOf(result.id as number)).toBe(1);
    });

    it("creates the category row when the name is new (find-or-CREATE)", () => {
      expect(categoryRowsNamed("Phones-ish new name")).toHaveLength(0);

      const result = service.createProduct({
        barcode: "CR-2222",
        name: "Nothing Phone",
        category: "Phones-ish new name",
        cost_price: 100,
        retail_price: 200,
      });

      expect(result.success).toBe(true);
      const rows = categoryRowsNamed("Phones-ish new name");
      expect(rows).toHaveLength(1);
      expect(categoryIdOf(result.id as number)).toBe(rows[0].id);
    });

    it("reuses an existing category case-insensitively instead of duplicating it", () => {
      const categoryId = insertCategory({
        tenantId: 1,
        name: "Phones",
        tracksImeiUnits: true,
      });

      const result = service.createProduct({
        barcode: "CR-3333",
        name: "Galaxy S24",
        category: "  pHoNeS  ",
        cost_price: 100,
        retail_price: 200,
      });

      expect(result.success).toBe(true);
      expect(categoryRowsNamed("Phones")).toHaveLength(1);
      expect(categoryIdOf(result.id as number)).toBe(categoryId);
      // …and the flag still projects, because the id is the flagged row's.
      expect(flagOf(result.id as number)).toBe(1);
    });

    it("rejects a create that names no category instead of inventing one", () => {
      // 'General' is the products.category *schema* default
      // (create_db.sql:243), NOT a service fallback: createProduct refuses a
      // blank category on both transports and writes nothing at all — in
      // particular it must not find-or-create a 'General' category row.
      for (const category of ["", "   "]) {
        const result = service.createProduct({
          barcode: `CR-BLANK-${category.length}`,
          name: "Uncategorized thing",
          category,
          cost_price: 100,
          retail_price: 200,
        });
        expect(result).toEqual({
          success: false,
          error: "Category is required",
        });
      }
      expect(categoryRowsNamed("General")).toHaveLength(0);
      expect(
        db.prepare(`SELECT COUNT(*) AS n FROM products`).get() as { n: number },
      ).toEqual({ n: 0 });
    });

    it("never reuses another tenant's same-named category (tenant-scoped find-or-create)", () => {
      const tenant1CategoryId = insertCategory({
        tenantId: 1,
        name: "Phones",
        tracksImeiUnits: true,
      });

      const result = runWithTenant(2, () =>
        service.createProduct({
          barcode: "CR-4444",
          name: "Tenant Two Phone",
          category: "Phones",
          cost_price: 100,
          retail_price: 200,
        }),
      );

      expect(result.success).toBe(true);
      const stamped = categoryIdOf(result.id as number);
      expect(stamped).not.toBeNull();
      expect(stamped).not.toBe(tenant1CategoryId);
      const rows = categoryRowsNamed("Phones");
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === stamped)?.tenant_id).toBe(2);
      // Tenant 2's brand-new category is unflagged — tenant 1's flag must
      // NOT leak across the boundary.
      expect(runWithTenant(2, () => flagOf(result.id as number))).toBe(0);
    });
  });

  describe("updateProduct", () => {
    function createIn(category: string, barcode: string): number {
      const created = service.createProduct({
        barcode,
        name: `Product ${barcode}`,
        category,
        cost_price: 100,
        retail_price: 200,
      });
      expect(created.success).toBe(true);
      return created.id as number;
    }

    it("re-resolves category_id when the product moves to another category", () => {
      insertCategory({
        tenantId: 1,
        name: "Accessories",
        tracksImeiUnits: false,
      });
      const phonesId = insertCategory({
        tenantId: 1,
        name: "Phones",
        tracksImeiUnits: true,
      });
      const productId = createIn("Accessories", "UP-1111");
      expect(flagOf(productId)).toBe(0);

      // No category_id in the payload — what the REST PUT body carries.
      const result = service.updateProduct(productId, {
        barcode: "UP-1111",
        name: "Product UP-1111",
        category: "Phones",
        cost_price: 100,
        retail_price: 200,
        min_stock_level: 5,
      });

      expect(result.success).toBe(true);
      expect(categoryIdOf(productId)).toBe(phonesId);
      expect(flagOf(productId)).toBe(1);
    });

    it("does NOT null out an already-resolved category_id on an unrelated edit", () => {
      const phonesId = insertCategory({
        tenantId: 1,
        name: "Phones",
        tracksImeiUnits: true,
      });
      const productId = createIn("Phones", "UP-2222");
      expect(categoryIdOf(productId)).toBe(phonesId);

      const result = service.updateProduct(productId, {
        barcode: "UP-2222",
        name: "Renamed, same category",
        category: "Phones",
        cost_price: 110,
        retail_price: 220,
        min_stock_level: 5,
      });

      expect(result.success).toBe(true);
      expect(categoryIdOf(productId)).toBe(phonesId);
      expect(flagOf(productId)).toBe(1);
    });

    const noCategoryCases: Array<[string, string | undefined]> = [
      ["omitted entirely", undefined],
      ["blank", ""],
      ["whitespace-only", "   "],
    ];

    it.each(noCategoryCases)(
      "leaves the existing category AND category_id untouched when the update's category is %s",
      (_label, category) => {
        const phonesId = insertCategory({
          tenantId: 1,
          name: "Phones",
          tracksImeiUnits: true,
        });
        const productId = createIn("Phones", "UP-4444");
        expect(categoryIdOf(productId)).toBe(phonesId);

        // What the unvalidated REST `PUT /products/:id` can deliver (the
        // desktop IPC door rejects this at ProductUpdateSchema). HEAD NULLed
        // both columns here; the interim fix reclassified the product into a
        // freshly invented 'General'. Neither is right: omitted = unchanged.
        const result = service.updateProduct(productId, {
          barcode: "UP-4444",
          name: "Edited with no category",
          ...(category === undefined ? {} : { category }),
          cost_price: 110,
          retail_price: 220,
          min_stock_level: 7,
        });

        expect(result.success).toBe(true);
        // classification untouched…
        expect(rowOf(productId).category).toBe("Phones");
        expect(categoryIdOf(productId)).toBe(phonesId);
        expect(flagOf(productId)).toBe(1);
        // …no junk category row invented…
        expect(categoryRowsNamed("General")).toHaveLength(0);
        expect(categoryRowsNamed("Phones")).toHaveLength(1);
        // …and the rest of the edit still landed.
        expect(rowOf(productId).name).toBe("Edited with no category");
      },
    );

    it("ignores a caller-supplied category_id that contradicts the category name", () => {
      // The REST PUT is unvalidated, so a client can send both. The NAME is
      // authoritative (updateProduct does not forward `category_id`), so the
      // two columns cannot be stored disagreeing — which is what the product
      // READ's COALESCE(pc.name, p.category) would otherwise paper over.
      const accessoriesId = insertCategory({
        tenantId: 1,
        name: "Accessories",
        tracksImeiUnits: false,
      });
      const phonesId = insertCategory({
        tenantId: 1,
        name: "Phones",
        tracksImeiUnits: true,
      });
      const productId = createIn("Accessories", "UP-5555");

      const result = service.updateProduct(productId, {
        barcode: "UP-5555",
        name: "Name says Accessories, id says Phones",
        category: "Accessories",
        category_id: phonesId,
        cost_price: 100,
        retail_price: 200,
        min_stock_level: 5,
      });

      expect(result.success).toBe(true);
      expect(categoryIdOf(productId)).toBe(accessoriesId);
      expect(rowOf(productId).category).toBe("Accessories");
      expect(flagOf(productId)).toBe(0);
    });

    it("creates the category on update when the name is new, without duplicating on a re-save", () => {
      const productId = createIn("Accessories", "UP-3333");

      for (const pass of [1, 2]) {
        const result = service.updateProduct(productId, {
          barcode: "UP-3333",
          name: `Pass ${pass}`,
          category: "Phones-ish new name",
          cost_price: 100,
          retail_price: 200,
          min_stock_level: 5,
        });
        expect(result.success).toBe(true);
      }

      const rows = categoryRowsNamed("Phones-ish new name");
      expect(rows).toHaveLength(1);
      expect(categoryIdOf(productId)).toBe(rows[0].id);
    });
  });
});
