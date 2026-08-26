/**
 * ProductRepository — inventory product-list SQL filters +
 * `getProductFilterOptions`.
 *
 * Covers the backend filtering the Inventory list drives:
 * category/supplier `IN` sets, inclusive added-date bounds, and
 * cost/retail/profit%/stock ranges — plus the two invariants that protect
 * the callers that DON'T filter:
 *
 *  1. with no filters (or an all-`undefined` / empty-array filter set) the
 *     generated SQL and params are byte-identical to the pre-filter query,
 *     so POS and the low-stock report cannot have shifted; and
 *  2. filters only ever AND with the existing `search` block.
 *
 * Hand-built minimal schema, same house pattern as
 * `ProductRepository.categoryFlagAndWarranty.test.ts` (products +
 * product_categories + product_units, no create_db.sql base).
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../ProductRepository";
import { runWithTenant } from "../../db/tenantContext";
import type { ProductListFilters } from "../../validators/product";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

/**
 * The EXACT SQL `findAllProducts()` produced before filtering existed,
 * transcribed from the pre-change source. Pinned here (rather than merely
 * comparing the new code against itself) because "unfiltered callers are
 * untouched" is the one claim this change cannot prove by behavior alone —
 * POS, the low-stock report and `findProductsPaginated` all ride on it.
 * A deliberate change to the base query is expected to update this string
 * and to update `findProductDtoById`'s SELECT list in the same commit.
 */
const PRE_FILTER_UNFILTERED_SQL =
  `
        SELECT
          p.id, p.barcode, p.name, p.stock_quantity, p.min_stock_level,
          p.image_url, p.is_active, p.is_deleted, p.created_at,
          p.cost_price_usd as cost_price,
          p.selling_price_usd as retail_price,
          p.supplier,
          p.category_id,
          p.warranty_months,
          COALESCE(pc.name, p.category) as category,
          COALESCE(pc.tracks_imei_units, 0) as tracks_imei_units
        FROM products p
        LEFT JOIN product_categories pc ON pc.id = p.category_id AND pc.tenant_id = ?
        WHERE p.is_active = 1 AND p.is_deleted = 0
          AND p.item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
          AND p.tenant_id = ?
      ` + ` ORDER BY p.name ASC`;

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

/**
 * Record every `prepare(...).all(...)` the repository issues inside `fn`.
 * Shadows the instance methods with own properties and restores after.
 */
function captureQueries(
  db: Database.Database,
  fn: () => void,
): CapturedQuery[] {
  const captured: CapturedQuery[] = [];
  const target = db as unknown as {
    prepare: (sql: string) => { all: (...p: unknown[]) => unknown[] };
  };
  const originalPrepare = target.prepare.bind(db);

  target.prepare = (sql: string) => {
    const stmt = originalPrepare(sql);
    const originalAll = stmt.all.bind(stmt);
    stmt.all = (...params: unknown[]): unknown[] => {
      captured.push({ sql, params });
      return originalAll(...params);
    };
    return stmt;
  };

  try {
    fn();
  } finally {
    delete (target as unknown as Record<string, unknown>).prepare;
  }
  return captured;
}

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
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER REFERENCES tenants(id),
      product_id   INTEGER NOT NULL REFERENCES products(id),
      imei         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'IN_STOCK',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

interface SeedProduct {
  tenantId?: number;
  name: string;
  category?: string | null;
  categoryId?: number | null;
  cost?: number;
  retail?: number;
  stock?: number;
  supplier?: string | null;
  createdAt?: string;
  itemType?: string;
  isActive?: number;
  isDeleted?: number;
}

function insertProduct(db: Database.Database, p: SeedProduct): number {
  const result = db
    .prepare(
      `INSERT INTO products
         (tenant_id, name, category, category_id, cost_price_usd, selling_price_usd,
          stock_quantity, supplier, created_at, item_type, is_active, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.tenantId ?? 1,
      p.name,
      p.category ?? null,
      p.categoryId ?? null,
      p.cost ?? 0,
      p.retail ?? 0,
      p.stock ?? 0,
      p.supplier === undefined ? null : p.supplier,
      p.createdAt ?? "2026-01-01 00:00:00",
      p.itemType ?? "Product",
      p.isActive ?? 1,
      p.isDeleted ?? 0,
    );
  return Number(result.lastInsertRowid);
}

/** Category ids seeded by {@link seedFixture}. */
const CATEGORY_PHONES = 1;
const CATEGORY_ACCESSORIES = 2;

/**
 * Five visible tenant-1 products spanning every filter axis, plus four
 * rows that must never appear anywhere (soft-deleted, inactive, virtual,
 * other tenant).
 *
 *  name           | display category | cost | retail | profit% | stock | supplier | added
 *  Alpha Phone    | Phones           |  100 |    150 |      50 |     5 | Acme     | 2026-01-10
 *  Beta Cable     | Cables (legacy)  |    2 |      4 |     100 |    50 | Bolt     | 2026-02-15
 *  Delta Zero     | Cables (legacy)  |    0 |      0 |       0 |     0 | (null)   | 2026-03-20
 *  Epsilon Loss   | Accessories      |  100 |     80 |     -20 |    -2 | ''       | 2026-04-01
 *  Gamma Freebie  | Accessories      |    0 |     20 |     100 |     3 | Acme     | 2026-03-20 (ISO-T)
 */
function seedFixture(db: Database.Database): void {
  db.prepare(
    `INSERT INTO product_categories (id, tenant_id, name) VALUES (?, ?, ?)`,
  ).run(CATEGORY_PHONES, 1, "Phones");
  db.prepare(
    `INSERT INTO product_categories (id, tenant_id, name) VALUES (?, ?, ?)`,
  ).run(CATEGORY_ACCESSORIES, 1, "Accessories");

  insertProduct(db, {
    name: "Alpha Phone",
    category: "LegacyIgnored",
    categoryId: CATEGORY_PHONES,
    cost: 100,
    retail: 150,
    stock: 5,
    supplier: "Acme",
    createdAt: "2026-01-10 09:00:00",
  });
  insertProduct(db, {
    name: "Beta Cable",
    category: "Cables",
    cost: 2,
    retail: 4,
    stock: 50,
    supplier: "Bolt",
    createdAt: "2026-02-15 09:00:00",
  });
  insertProduct(db, {
    name: "Delta Zero",
    category: "Cables",
    cost: 0,
    retail: 0,
    stock: 0,
    supplier: null,
    createdAt: "2026-03-20 23:59:59",
  });
  insertProduct(db, {
    name: "Epsilon Loss",
    categoryId: CATEGORY_ACCESSORIES,
    cost: 100,
    retail: 80,
    stock: -2,
    supplier: "",
    createdAt: "2026-04-01 09:00:00",
  });
  // ISO-`T` created_at: both storage forms exist in this DB and date()
  // must normalize them the same way.
  insertProduct(db, {
    name: "Gamma Freebie",
    categoryId: CATEGORY_ACCESSORIES,
    cost: 0,
    retail: 20,
    stock: 3,
    supplier: "Acme",
    createdAt: "2026-03-20T08:30:00.000Z",
  });

  // Rows that must be invisible to BOTH findAllProducts and
  // getProductFilterOptions.
  insertProduct(db, {
    name: "Zeta Deleted",
    category: "GhostCategoryDeleted",
    supplier: "GhostSupplierDeleted",
    isDeleted: 1,
  });
  insertProduct(db, {
    name: "Eta Inactive",
    category: "GhostCategoryInactive",
    supplier: "GhostSupplierInactive",
    isActive: 0,
  });
  insertProduct(db, {
    name: "Theta Virtual",
    category: "GhostCategoryVirtual",
    supplier: "GhostSupplierVirtual",
    itemType: "Virtual_MTC",
  });
  insertProduct(db, {
    tenantId: 2,
    name: "Other Tenant Widget",
    category: "OtherTenantCategory",
    supplier: "OtherTenantSupplier",
  });
}

const ALL_VISIBLE = [
  "Alpha Phone",
  "Beta Cable",
  "Delta Zero",
  "Epsilon Loss",
  "Gamma Freebie",
];

describe("ProductRepository — inventory list filters", () => {
  let db: Database.Database;
  let repo: ProductRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    repo = new ProductRepository();
    seedFixture(db);
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  const names = (filters?: ProductListFilters, search?: string): string[] =>
    runWithTenant(1, () => repo.findAllProducts(search, filters)).map(
      (p) => p.name,
    );

  // ---------------------------------------------------------------------------
  // Unfiltered behavior is unchanged
  // ---------------------------------------------------------------------------

  describe("no filters — unchanged for every existing caller", () => {
    it("returns the same rows as an argument-less call", () => {
      expect(names()).toEqual(ALL_VISIBLE);
    });

    it("emits SQL and params byte-identical to the pre-filter query", () => {
      const [captured] = captureQueries(db, () => {
        runWithTenant(1, () => repo.findAllProducts());
      });
      expect(captured.sql).toBe(PRE_FILTER_UNFILTERED_SQL);
      expect(captured.params).toEqual([1, 1]);
    });

    it.each<[string, ProductListFilters | undefined]>([
      ["undefined", undefined],
      ["an empty object", {}],
      ["an all-undefined filter set", { categories: undefined, costMin: undefined }],
      ["empty arrays (cleared filters, not 'match nothing')", { categories: [], suppliers: [] }],
    ])("treats %s as no filter at all", (_label, filters) => {
      const [captured] = captureQueries(db, () => {
        runWithTenant(1, () => repo.findAllProducts(undefined, filters));
      });
      expect(captured.sql).toBe(PRE_FILTER_UNFILTERED_SQL);
      expect(captured.params).toEqual([1, 1]);
      expect(names(filters)).toEqual(ALL_VISIBLE);
    });
  });

  // ---------------------------------------------------------------------------
  // Category / supplier
  // ---------------------------------------------------------------------------

  describe("categories", () => {
    it("matches a category resolved through the product_categories join", () => {
      expect(names({ categories: ["Phones"] })).toEqual(["Alpha Phone"]);
    });

    it("matches a legacy free-text products.category value", () => {
      expect(names({ categories: ["Cables"] })).toEqual([
        "Beta Cable",
        "Delta Zero",
      ]);
    });

    it("ignores the shadowed legacy column when a joined category exists", () => {
      // Alpha Phone has category='LegacyIgnored' AND category_id=Phones; the
      // DISPLAYED value (and therefore the filter) is 'Phones'.
      expect(names({ categories: ["LegacyIgnored"] })).toEqual([]);
    });

    it("ORs multiple values within the category filter", () => {
      expect(names({ categories: ["Phones", "Accessories"] })).toEqual([
        "Alpha Phone",
        "Epsilon Loss",
        "Gamma Freebie",
      ]);
    });

    it("binds category values as parameters, never inlined SQL", () => {
      const [captured] = captureQueries(db, () => {
        runWithTenant(1, () => repo.findAllProducts(undefined, { categories: ["A", "B"] }));
      });
      expect(captured.sql).toContain("IN (?, ?)");
      expect(captured.sql).not.toContain("'A'");
      expect(captured.params).toEqual([1, 1, "A", "B"]);
    });

    it("returns nothing rather than erroring on a quote-bearing value", () => {
      expect(names({ categories: ["'; DROP TABLE products; --"] })).toEqual([]);
      expect(names()).toEqual(ALL_VISIBLE);
    });
  });

  describe("suppliers", () => {
    it("matches a single supplier", () => {
      expect(names({ suppliers: ["Acme"] })).toEqual([
        "Alpha Phone",
        "Gamma Freebie",
      ]);
    });

    it("ORs multiple suppliers", () => {
      expect(names({ suppliers: ["Acme", "Bolt"] })).toEqual([
        "Alpha Phone",
        "Beta Cable",
        "Gamma Freebie",
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Added-date range (inclusive both ends)
  // ---------------------------------------------------------------------------

  describe("addedFrom / addedTo", () => {
    it("applies addedFrom alone, inclusive of the boundary day", () => {
      expect(names({ addedFrom: "2026-03-20" })).toEqual([
        "Delta Zero",
        "Epsilon Loss",
        "Gamma Freebie",
      ]);
    });

    it("applies addedTo alone, inclusive of the boundary day", () => {
      expect(names({ addedTo: "2026-01-10" })).toEqual(["Alpha Phone"]);
    });

    it("applies both bounds, inclusive on each end", () => {
      expect(names({ addedFrom: "2026-01-10", addedTo: "2026-02-15" })).toEqual([
        "Alpha Phone",
        "Beta Cable",
      ]);
    });

    it("normalizes both created_at storage forms to the same day", () => {
      // Delta Zero is '2026-03-20 23:59:59'; Gamma Freebie is the ISO-`T`
      // '2026-03-20T08:30:00.000Z'. A single-day window must catch both.
      expect(names({ addedFrom: "2026-03-20", addedTo: "2026-03-20" })).toEqual([
        "Delta Zero",
        "Gamma Freebie",
      ]);
    });

    it("returns an empty set for an inverted range rather than rejecting it", () => {
      expect(names({ addedFrom: "2026-04-01", addedTo: "2026-01-01" })).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Numeric ranges
  // ---------------------------------------------------------------------------

  describe("cost range", () => {
    it("applies costMin alone", () => {
      expect(names({ costMin: 100 })).toEqual(["Alpha Phone", "Epsilon Loss"]);
    });

    it("applies costMax alone (including cost = 0)", () => {
      expect(names({ costMax: 0 })).toEqual(["Delta Zero", "Gamma Freebie"]);
    });

    it("applies both bounds", () => {
      expect(names({ costMin: 2, costMax: 100 })).toEqual([
        "Alpha Phone",
        "Beta Cable",
        "Epsilon Loss",
      ]);
    });
  });

  describe("retail range", () => {
    it("applies retailMin alone", () => {
      expect(names({ retailMin: 100 })).toEqual(["Alpha Phone"]);
    });

    it("applies retailMax alone", () => {
      expect(names({ retailMax: 4 })).toEqual(["Beta Cable", "Delta Zero"]);
    });

    it("applies both bounds", () => {
      expect(names({ retailMin: 4, retailMax: 20 })).toEqual([
        "Beta Cable",
        "Gamma Freebie",
      ]);
    });
  });

  describe("stock range", () => {
    it("applies stockMin alone", () => {
      expect(names({ stockMin: 5 })).toEqual(["Alpha Phone", "Beta Cable"]);
    });

    it("applies stockMax alone, keeping negative stock", () => {
      expect(names({ stockMax: 0 })).toEqual(["Delta Zero", "Epsilon Loss"]);
    });

    it("applies both bounds across zero", () => {
      expect(names({ stockMin: -2, stockMax: 3 })).toEqual([
        "Delta Zero",
        "Epsilon Loss",
        "Gamma Freebie",
      ]);
    });
  });

  describe("profit% range — matches the DISPLAYED profit column", () => {
    it("treats cost = 0 with retail > 0 as 100%", () => {
      // Gamma Freebie (cost 0, retail 20) and Beta Cable (2 -> 4) both sit
      // at exactly 100.
      expect(names({ profitPctMin: 100 })).toEqual([
        "Beta Cable",
        "Gamma Freebie",
      ]);
    });

    it("treats cost = 0 with retail = 0 as 0%, not 100%", () => {
      expect(names({ profitPctMin: 100 })).not.toContain("Delta Zero");
      expect(names({ profitPctMin: 0, profitPctMax: 0 })).toEqual(["Delta Zero"]);
    });

    it("computes a normal margin", () => {
      expect(names({ profitPctMin: 50, profitPctMax: 50 })).toEqual([
        "Alpha Phone",
      ]);
    });

    it("keeps negative margins reachable via profitPctMax", () => {
      expect(names({ profitPctMax: 0 })).toEqual(["Delta Zero", "Epsilon Loss"]);
      expect(names({ profitPctMax: -1 })).toEqual(["Epsilon Loss"]);
    });

    it("uses one expression for both bounds", () => {
      const [captured] = captureQueries(db, () => {
        runWithTenant(1, () =>
          repo.findAllProducts(undefined, { profitPctMin: 1, profitPctMax: 2 }),
        );
      });
      const occurrences = captured.sql.split("CASE WHEN p.cost_price_usd > 0").length - 1;
      expect(occurrences).toBe(2);
      expect(captured.params).toEqual([1, 1, 1, 2]);
    });
  });

  // ---------------------------------------------------------------------------
  // Composition
  // ---------------------------------------------------------------------------

  describe("composition", () => {
    it("ANDs multiple filters together", () => {
      expect(names({ categories: ["Cables"], costMin: 1 })).toEqual([
        "Beta Cable",
      ]);
    });

    it("ANDs filters with the existing search block", () => {
      // 'Cables' matches Beta Cable and Delta Zero via the category LIKE;
      // stockMin then drops Delta Zero (stock 0).
      expect(names(undefined, "Cables")).toEqual(["Beta Cable", "Delta Zero"]);
      expect(names({ stockMin: 1 }, "Cables")).toEqual(["Beta Cable"]);
    });

    it("keeps the search params ahead of the filter params", () => {
      const [captured] = captureQueries(db, () => {
        runWithTenant(1, () => repo.findAllProducts("Cab", { stockMin: 1 }));
      });
      expect(captured.params).toEqual([1, 1, "%Cab%", "%Cab%", "%Cab%", "%Cab%", 1]);
    });

    it("returns an empty set when filters contradict", () => {
      expect(names({ categories: ["Phones"], suppliers: ["Bolt"] })).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Excluded rows
  // ---------------------------------------------------------------------------

  describe("excluded rows stay excluded under filters", () => {
    it("never surfaces soft-deleted, inactive, virtual or other-tenant rows", () => {
      const wideOpen: ProductListFilters = {
        addedFrom: "2000-01-01",
        addedTo: "2099-12-31",
        costMin: 0,
        stockMin: -1000,
        stockMax: 1000,
        profitPctMin: -1000,
        profitPctMax: 1000,
      };
      expect(names(wideOpen)).toEqual(ALL_VISIBLE);
    });

    it("cannot be reached by naming their category or supplier", () => {
      expect(
        names({
          categories: [
            "GhostCategoryDeleted",
            "GhostCategoryInactive",
            "GhostCategoryVirtual",
            "OtherTenantCategory",
          ],
        }),
      ).toEqual([]);
      expect(
        names({
          suppliers: [
            "GhostSupplierDeleted",
            "GhostSupplierInactive",
            "GhostSupplierVirtual",
            "OtherTenantSupplier",
          ],
        }),
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getProductFilterOptions
  // ---------------------------------------------------------------------------

  describe("getProductFilterOptions", () => {
    it("returns deduped, case-insensitively sorted DISPLAYED categories", () => {
      const options = runWithTenant(1, () => repo.getProductFilterOptions());
      // 'Cables' appears on two products and collapses to one entry;
      // 'LegacyIgnored' never appears because its product is categorized.
      expect(options.categories).toEqual(["Accessories", "Cables", "Phones"]);
    });

    it("returns deduped suppliers, excluding NULL and empty string", () => {
      const options = runWithTenant(1, () => repo.getProductFilterOptions());
      expect(options.suppliers).toEqual(["Acme", "Bolt"]);
    });

    it("sorts case-insensitively", () => {
      insertProduct(db, { name: "zz lower", category: "aardvark", supplier: "zulu" });
      insertProduct(db, { name: "zz upper", category: "Banana", supplier: "Alpha" });
      const options = runWithTenant(1, () => repo.getProductFilterOptions());
      expect(options.categories).toEqual([
        "aardvark",
        "Accessories",
        "Banana",
        "Cables",
        "Phones",
      ]);
      expect(options.suppliers).toEqual(["Acme", "Alpha", "Bolt", "zulu"]);
    });

    it("excludes soft-deleted, inactive and virtual products", () => {
      const options = runWithTenant(1, () => repo.getProductFilterOptions());
      const joined = [...options.categories, ...options.suppliers].join("|");
      expect(joined).not.toContain("Ghost");
    });

    it("is tenant-scoped", () => {
      const tenantOne = runWithTenant(1, () => repo.getProductFilterOptions());
      expect(tenantOne.categories).not.toContain("OtherTenantCategory");
      expect(tenantOne.suppliers).not.toContain("OtherTenantSupplier");

      const tenantTwo = runWithTenant(2, () => repo.getProductFilterOptions());
      expect(tenantTwo.categories).toEqual(["OtherTenantCategory"]);
      expect(tenantTwo.suppliers).toEqual(["OtherTenantSupplier"]);
    });

    it("offers only values that match at least one visible product", () => {
      const options = runWithTenant(1, () => repo.getProductFilterOptions());
      for (const category of options.categories) {
        expect(names({ categories: [category] }).length).toBeGreaterThan(0);
      }
      for (const supplier of options.suppliers) {
        expect(names({ suppliers: [supplier] }).length).toBeGreaterThan(0);
      }
    });

    it("returns empty lists for a tenant with no products", () => {
      db.prepare(`DELETE FROM products`).run();
      const options = runWithTenant(1, () => repo.getProductFilterOptions());
      expect(options).toEqual({ categories: [], suppliers: [] });
    });
  });
});
