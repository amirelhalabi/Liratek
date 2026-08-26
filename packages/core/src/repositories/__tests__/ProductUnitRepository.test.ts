/**
 * ProductUnitRepository — per-IMEI phone unit tracking (LIRA-143 Phase 2).
 *
 * Hand-built minimal schema (same house pattern as
 * `ExchangeLotRepository.test.ts`): products/product_categories/sales/
 * sale_items/clients/product_units, including the partial unique index
 * that backs decision #3 (duplicate IMEI blocked only while IN_STOCK).
 */

import Database from "better-sqlite3";
import {
  ProductUnitRepository,
  type ProductUnitEntity,
} from "../ProductUnitRepository";
import { runWithTenant } from "../../db/tenantContext";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // better-sqlite3 defaults `foreign_keys` ON for every new connection in
  // this codebase (see migration test files for the same note). Several
  // tests below stamp a synthetic `sale_item_id` (e.g. 999, 777) directly
  // via `markSold` without first creating a matching `sale_items` row —
  // that's fine for exercising `product_units`' own columns/constraints in
  // isolation, but it would otherwise trip the real
  // `sale_item_id REFERENCES sale_items(id)` FK. Off, same as the
  // migration test suite's house pattern.
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one'), (2, 'Two', 'two');

    CREATE TABLE product_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER REFERENCES tenants(id),
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1,
      tracks_imei_units INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
      barcode            TEXT,
      name               TEXT NOT NULL,
      category           TEXT,
      item_type          TEXT DEFAULT 'Product',
      cost_price_usd     DECIMAL(10, 2) DEFAULT 0,
      selling_price_usd  DECIMAL(10, 2) DEFAULT 0,
      stock_quantity     INTEGER DEFAULT 0,
      min_stock_level    INTEGER DEFAULT 5,
      warranty_months    INTEGER,
      is_active          INTEGER NOT NULL DEFAULT 1,
      is_deleted         INTEGER NOT NULL DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER REFERENCES tenants(id),
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sales (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER REFERENCES tenants(id),
      client_id   INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
      sale_id            INTEGER NOT NULL,
      product_id         INTEGER NOT NULL,
      quantity           INTEGER DEFAULT 1,
      sold_price_usd     DECIMAL(10, 2),
      is_refunded         BOOLEAN DEFAULT 0,
      refunded_quantity   INTEGER DEFAULT 0,
      warranty_until      TEXT
    );

    CREATE TABLE product_units (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER REFERENCES tenants(id),
      product_id               INTEGER NOT NULL REFERENCES products(id),
      imei                     TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK', 'SOLD')),
      sale_item_id             INTEGER REFERENCES sale_items(id) ON DELETE SET NULL,
      is_defective             INTEGER NOT NULL DEFAULT 0,
      warranty_override_until  TEXT,
      created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_product_units_active_imei ON product_units(tenant_id, imei) WHERE status = 'IN_STOCK';
    CREATE INDEX idx_product_units_tenant_id ON product_units(tenant_id);
    CREATE INDEX idx_product_units_imei ON product_units(tenant_id, imei);
    CREATE INDEX idx_product_units_product ON product_units(tenant_id, product_id, status);
    CREATE INDEX idx_product_units_sale_item ON product_units(sale_item_id);
  `);
  return db;
}

function insertProduct(
  db: Database.Database,
  opts: {
    tenantId: number;
    name: string;
    stockQuantity?: number;
    /** The MODEL's warranty term. Omitted/undefined = NULL, i.e. a model with
     *  no warranty at all — the default every pre-existing test relies on. */
    warrantyMonths?: number | null;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO products (tenant_id, name, stock_quantity, warranty_months)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      opts.tenantId,
      opts.name,
      opts.stockQuantity ?? 0,
      opts.warrantyMonths ?? null,
    );
  return Number(result.lastInsertRowid);
}

function insertClient(
  db: Database.Database,
  tenantId: number,
  fullName: string,
): number {
  const result = db
    .prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (?, ?)`)
    .run(tenantId, fullName);
  return Number(result.lastInsertRowid);
}

function insertSale(
  db: Database.Database,
  tenantId: number,
  clientId: number | null,
): number {
  const result = db
    .prepare(`INSERT INTO sales (tenant_id, client_id) VALUES (?, ?)`)
    .run(tenantId, clientId);
  return Number(result.lastInsertRowid);
}

function insertSaleItem(
  db: Database.Database,
  opts: {
    tenantId: number;
    saleId: number;
    productId: number;
    quantity?: number;
    soldPriceUsd?: number;
    isRefunded?: boolean;
    refundedQuantity?: number;
    warrantyUntil?: string | null;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO sale_items (
         tenant_id, sale_id, product_id, quantity, sold_price_usd,
         is_refunded, refunded_quantity, warranty_until
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.tenantId,
      opts.saleId,
      opts.productId,
      opts.quantity ?? 1,
      opts.soldPriceUsd ?? 0,
      opts.isRefunded ? 1 : 0,
      opts.refundedQuantity ?? 0,
      opts.warrantyUntil ?? null,
    );
  return Number(result.lastInsertRowid);
}

function unitRow(
  db: Database.Database,
  id: number,
): ProductUnitEntity | undefined {
  return db
    .prepare(`SELECT * FROM product_units WHERE id = ?`)
    .get(id) as ProductUnitEntity | undefined;
}

describe("ProductUnitRepository", () => {
  let db: Database.Database;
  let repo: ProductUnitRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    repo = new ProductUnitRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  // ---------------------------------------------------------------------------
  // addUnits
  // ---------------------------------------------------------------------------

  describe("addUnits", () => {
    it("registers a batch of trimmed IMEIs as IN_STOCK units", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });

      const units = runWithTenant(1, () =>
        repo.addUnits(productId, ["  111111111111111  ", "222222222222222"]),
      );

      expect(units).toHaveLength(2);
      expect(units[0].imei).toBe("111111111111111");
      expect(units[1].imei).toBe("222222222222222");
      expect(units.every((u) => u.status === "IN_STOCK")).toBe(true);
      expect(units.every((u) => u.tenant_id === 1)).toBe(true);
    });

    it("rejects an empty IMEI (after trim) and writes nothing", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });

      expect(() =>
        runWithTenant(1, () =>
          repo.addUnits(productId, ["111111111111111", "   "]),
        ),
      ).toThrow(/must not be empty/);

      const count = (
        db.prepare(`SELECT COUNT(*) AS c FROM product_units`).get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(0);
    });

    it("rejects an intra-batch duplicate IMEI and writes nothing", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });

      expect(() =>
        runWithTenant(1, () =>
          repo.addUnits(productId, ["111111111111111", "111111111111111"]),
        ),
      ).toThrow(/duplicate IMEI/);

      const count = (
        db.prepare(`SELECT COUNT(*) AS c FROM product_units`).get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(0);
    });

    it("names the holding product when the IMEI is already IN_STOCK elsewhere, and writes nothing from that batch", () => {
      const iphoneId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const galaxyId = insertProduct(db, { tenantId: 1, name: "Galaxy S23" });

      runWithTenant(1, () => repo.addUnits(iphoneId, ["111111111111111"]));

      expect(() =>
        runWithTenant(1, () =>
          repo.addUnits(galaxyId, ["222222222222222", "111111111111111"]),
        ),
      ).toThrow(/IMEI 111111111111111 is already registered in stock on product "iPhone 13"/);

      // The whole second batch rolled back — "222..." was never committed.
      const galaxyUnits = runWithTenant(1, () =>
        repo.getUnitsForProduct(galaxyId),
      );
      expect(galaxyUnits).toHaveLength(0);
    });

    it("allows the same IMEI to be registered independently for two different tenants", () => {
      const productA = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const productB = insertProduct(db, { tenantId: 2, name: "iPhone 13" });

      const unitsA = runWithTenant(1, () =>
        repo.addUnits(productA, ["111111111111111"]),
      );
      const unitsB = runWithTenant(2, () =>
        repo.addUnits(productB, ["111111111111111"]),
      );

      expect(unitsA[0].imei).toBe("111111111111111");
      expect(unitsB[0].imei).toBe("111111111111111");
      expect(unitsA[0].tenant_id).toBe(1);
      expect(unitsB[0].tenant_id).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // getUnitsForProduct
  // ---------------------------------------------------------------------------

  describe("getUnitsForProduct", () => {
    it("orders created_at ASC, id ASC and filters by status when given", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const units = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111", "222222222222222"]),
      );
      runWithTenant(1, () => repo.markSold(units[0].id, 999));

      const all = runWithTenant(1, () => repo.getUnitsForProduct(productId));
      expect(all.map((u) => u.id)).toEqual([units[0].id, units[1].id]);

      const inStockOnly = runWithTenant(1, () =>
        repo.getUnitsForProduct(productId, "IN_STOCK"),
      );
      expect(inStockOnly.map((u) => u.id)).toEqual([units[1].id]);

      const soldOnly = runWithTenant(1, () =>
        repo.getUnitsForProduct(productId, "SOLD"),
      );
      expect(soldOnly.map((u) => u.id)).toEqual([units[0].id]);
    });
  });

  // ---------------------------------------------------------------------------
  // getSummaryForProducts
  // ---------------------------------------------------------------------------

  describe("getSummaryForProducts", () => {
    it("returns undefined (no key) for a unit-less product, and correct counts otherwise", () => {
      const withUnits = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const withoutUnits = insertProduct(db, { tenantId: 1, name: "Galaxy S23" });

      const units = runWithTenant(1, () =>
        repo.addUnits(withUnits, [
          "111111111111111",
          "222222222222222",
          "333333333333333",
        ]),
      );
      runWithTenant(1, () => repo.markSold(units[0].id, 501));
      runWithTenant(1, () =>
        repo.markInStock(units[0].id, { isDefective: true }),
      );
      runWithTenant(1, () => repo.markSold(units[0].id, 502));

      const summary = runWithTenant(1, () =>
        repo.getSummaryForProducts([withUnits, withoutUnits, 9999]),
      );

      expect(summary[withUnits]).toEqual({
        in_stock: 2,
        sold: 1,
        defective: 1,
      });
      expect(summary[withoutUnits]).toBeUndefined();
      expect(summary[9999]).toBeUndefined();

      expect(runWithTenant(1, () => repo.getSummaryForProducts([]))).toEqual(
        {},
      );
    });
  });

  // ---------------------------------------------------------------------------
  // markSold / markInStock
  // ---------------------------------------------------------------------------

  describe("markSold", () => {
    it("flips to SOLD, sets sale_item_id, and clears warranty_override_until", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );
      db.prepare(
        `UPDATE product_units SET warranty_override_until = '2026-12-31' WHERE id = ?`,
      ).run(unit.id);

      runWithTenant(1, () => repo.markSold(unit.id, 777));

      const after = unitRow(db, unit.id)!;
      expect(after.status).toBe("SOLD");
      expect(after.sale_item_id).toBe(777);
      expect(after.warranty_override_until).toBeNull();
    });

    it("throws on a second call — an already-SOLD unit cannot be sold again", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );
      runWithTenant(1, () => repo.markSold(unit.id, 777));

      expect(() => runWithTenant(1, () => repo.markSold(unit.id, 778))).toThrow(
        /not found, already sold, or wrong tenant/,
      );
    });

    it("keeps is_defective across a re-sale (unit history, not a blocker)", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );
      runWithTenant(1, () => repo.markSold(unit.id, 777));
      runWithTenant(1, () =>
        repo.markInStock(unit.id, { isDefective: true }),
      );
      runWithTenant(1, () => repo.markSold(unit.id, 778));

      const after = unitRow(db, unit.id)!;
      expect(after.is_defective).toBe(1);
      expect(after.sale_item_id).toBe(778);
    });
  });

  describe("markInStock", () => {
    it("returns false (no throw) when the unit is already IN_STOCK — idempotent under double-refund", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );

      const result = runWithTenant(1, () => repo.markInStock(unit.id));
      expect(result).toBe(false);
      expect(unitRow(db, unit.id)!.status).toBe("IN_STOCK");
    });

    it("sets is_defective/warranty_override_until only when provided, and keeps sale_item_id", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );
      runWithTenant(1, () => repo.markSold(unit.id, 900));

      // No opts: flips status only, leaves is_defective/override untouched.
      const flipped = runWithTenant(1, () => repo.markInStock(unit.id));
      expect(flipped).toBe(true);
      let after = unitRow(db, unit.id)!;
      expect(after.status).toBe("IN_STOCK");
      expect(after.is_defective).toBe(0);
      expect(after.warranty_override_until).toBeNull();
      expect(after.sale_item_id).toBe(900); // historical pointer kept

      runWithTenant(1, () => repo.markSold(unit.id, 901));
      runWithTenant(1, () =>
        repo.markInStock(unit.id, {
          isDefective: true,
          warrantyOverrideUntil: "2027-01-01",
        }),
      );
      after = unitRow(db, unit.id)!;
      expect(after.is_defective).toBe(1);
      expect(after.warranty_override_until).toBe("2027-01-01");
      expect(after.sale_item_id).toBe(901);

      // Explicit null clears the override.
      runWithTenant(1, () => repo.markSold(unit.id, 902));
      runWithTenant(1, () =>
        repo.markInStock(unit.id, { warrantyOverrideUntil: null }),
      );
      after = unitRow(db, unit.id)!;
      expect(after.warranty_override_until).toBeNull();
      expect(after.is_defective).toBe(1); // untouched by this call
    });

    // Adversarial-review finding 2 (MAJOR): decision #3 allows a SOLD
    // unit's imei to be re-registered IN_STOCK on a different product.
    // Refunding the ORIGINAL sale then makes this UPDATE collide with the
    // partial unique index (idx_product_units_active_imei) and, unguarded,
    // that raw `UNIQUE constraint failed: product_units.tenant_id,
    // product_units.imei` propagated straight to the operator. This is the
    // failing-first proof: run against the unfixed markInStock, it throws
    // that raw SQLite message instead of the named one asserted below.
    it("throws a named, actionable error when this unit's imei has been re-registered IN_STOCK on another product (adversarial-review finding 2)", () => {
      const productA = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const productB = insertProduct(db, { tenantId: 1, name: "Galaxy S23" });

      // Unit A: SOLD, imei X.
      const [unitA] = runWithTenant(1, () =>
        repo.addUnits(productA, ["111111111111111"]),
      );
      runWithTenant(1, () => repo.markSold(unitA.id, 900));

      // Unit C: legitimately re-registered IN_STOCK with the SAME imei on
      // product B (decision #3 — allowed while unit A is SOLD).
      const [unitC] = runWithTenant(1, () =>
        repo.addUnits(productB, ["111111111111111"]),
      );

      // Refunding unit A's sale now collides.
      expect(() => runWithTenant(1, () => repo.markInStock(unitA.id))).toThrow(
        new RegExp(
          `Cannot return IMEI 111111111111111 to stock: it is currently registered in stock on product "Galaxy S23" \\(unit #${unitC.id}\\)`,
        ),
      );

      // Fail-closed: unit A stays SOLD, unit C is untouched.
      const afterA = unitRow(db, unitA.id)!;
      expect(afterA.status).toBe("SOLD");
      const afterC = unitRow(db, unitC.id)!;
      expect(afterC.status).toBe("IN_STOCK");
    });

    it("still returns false (no throw) when the target unit is already IN_STOCK, even though another (SOLD) unit shares its imei", () => {
      const productA = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const productB = insertProduct(db, { tenantId: 1, name: "Galaxy S23" });

      // Same collision fixture as above: unit A SOLD imei X, unit C
      // IN_STOCK imei X on a different product.
      const [unitA] = runWithTenant(1, () =>
        repo.addUnits(productA, ["444444444444444"]),
      );
      runWithTenant(1, () => repo.markSold(unitA.id, 900));
      const [unitC] = runWithTenant(1, () =>
        repo.addUnits(productB, ["444444444444444"]),
      );

      // unitC is the one already IN_STOCK — calling markInStock on it must
      // no-op silently (the not-SOLD guard fires BEFORE any collision
      // check), even though unitA elsewhere shares the same imei.
      const result = runWithTenant(1, () => repo.markInStock(unitC.id));
      expect(result).toBe(false);
      expect(unitRow(db, unitC.id)!.status).toBe("IN_STOCK");
      // Untouched — unitA is still SOLD, unaffected by this no-op call.
      expect(unitRow(db, unitA.id)!.status).toBe("SOLD");
    });
  });

  // ---------------------------------------------------------------------------
  // deleteUnit
  // ---------------------------------------------------------------------------

  describe("deleteUnit", () => {
    it("deletes an IN_STOCK unit", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );

      runWithTenant(1, () => repo.deleteUnit(unit.id));
      expect(unitRow(db, unit.id)).toBeUndefined();
    });

    it("blocks deleting a SOLD unit with a named error", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );
      runWithTenant(1, () => repo.markSold(unit.id, 999));

      expect(() => runWithTenant(1, () => repo.deleteUnit(unit.id))).toThrow(
        /is SOLD — a sold unit is history and cannot be deleted/,
      );
      expect(unitRow(db, unit.id)).toBeDefined();
    });

    it("throws a not-found error for a nonexistent unit", () => {
      expect(() => runWithTenant(1, () => repo.deleteUnit(12345))).toThrow(
        /not found/,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findActiveByImei
  // ---------------------------------------------------------------------------

  describe("findActiveByImei", () => {
    it("ignores a SOLD unit and finds only the IN_STOCK one", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );

      const found = runWithTenant(1, () =>
        repo.findActiveByImei("111111111111111"),
      );
      expect(found?.id).toBe(unit.id);

      runWithTenant(1, () => repo.markSold(unit.id, 999));
      const afterSold = runWithTenant(1, () =>
        repo.findActiveByImei("111111111111111"),
      );
      expect(afterSold).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // findBySaleItemIds
  // ---------------------------------------------------------------------------

  describe("findBySaleItemIds", () => {
    it("batches an IN(...) lookup and returns [] for an empty input", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const units = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111", "222222222222222"]),
      );
      runWithTenant(1, () => repo.markSold(units[0].id, 501));
      runWithTenant(1, () => repo.markSold(units[1].id, 502));

      const found = runWithTenant(1, () =>
        repo.findBySaleItemIds([501, 502, 999]),
      );
      expect(found.map((u) => u.id).sort()).toEqual(
        [units[0].id, units[1].id].sort(),
      );

      expect(runWithTenant(1, () => repo.findBySaleItemIds([]))).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getUnitStoryByImei
  // ---------------------------------------------------------------------------

  describe("getUnitStoryByImei", () => {
    it("joins product name and sale/client fields for a sold unit", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const clientId = insertClient(db, 1, "Jane Doe");
      const saleId = insertSale(db, 1, clientId);
      const saleItemId = insertSaleItem(db, {
        tenantId: 1,
        saleId,
        productId,
        soldPriceUsd: 999.99,
        warrantyUntil: "2027-01-01",
      });

      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );
      runWithTenant(1, () => repo.markSold(unit.id, saleItemId));

      const story = runWithTenant(1, () =>
        repo.getUnitStoryByImei("111111111111111"),
      );
      expect(story).toHaveLength(1);
      expect(story[0].product_name).toBe("iPhone 13");
      expect(story[0].sale_id).toBe(saleId);
      expect(story[0].sold_price_usd).toBe(999.99);
      expect(story[0].warranty_until).toBe("2027-01-01");
      expect(story[0].client_id).toBe(clientId);
      expect(story[0].client_name).toBe("Jane Doe");
      expect(story[0].status).toBe("SOLD");
    });

    it("returns null-joined fields for a unit that was never sold", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      runWithTenant(1, () => repo.addUnits(productId, ["111111111111111"]));

      const story = runWithTenant(1, () =>
        repo.getUnitStoryByImei("111111111111111"),
      );
      expect(story).toHaveLength(1);
      expect(story[0].product_name).toBe("iPhone 13");
      expect(story[0].sale_id).toBeNull();
      expect(story[0].client_name).toBeNull();
      expect(story[0].warranty_until).toBeNull();
    });

    /**
     * Owner-reported 2026-08-26: the owning MODEL's warranty term now rides
     * on the same shared join, so the walk-in lookup card can tell an unsold
     * unit apart from a genuinely warranty-less one. Read straight off
     * `products.warranty_months` — never derived from the sale — so a unit
     * that has NEVER been sold still carries the term while `warranty_until`
     * stays null (decision #4: the clock starts at the sale).
     */
    it("carries the model's warranty term as product_warranty_months, null when the model has none", () => {
      const withTerm = insertProduct(db, {
        tenantId: 1,
        name: "iPhone 13",
        warrantyMonths: 6,
      });
      const withoutTerm = insertProduct(db, {
        tenantId: 1,
        name: "Nokia 3310",
      });
      runWithTenant(1, () => repo.addUnits(withTerm, ["111111111111111"]));
      runWithTenant(1, () => repo.addUnits(withoutTerm, ["222222222222222"]));

      const covered = runWithTenant(1, () =>
        repo.getUnitStoryByImei("111111111111111"),
      );
      expect(covered[0].product_warranty_months).toBe(6);
      // Never sold — the term is present, the SALE stamp is not.
      expect(covered[0].status).toBe("IN_STOCK");
      expect(covered[0].warranty_until).toBeNull();

      const bare = runWithTenant(1, () =>
        repo.getUnitStoryByImei("222222222222222"),
      );
      expect(bare[0].product_warranty_months).toBeNull();
    });

    it("orders newest unit first across multiple rows sharing one IMEI", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["111111111111111"]),
      );
      runWithTenant(1, () => repo.markSold(unit.id, 999));

      const productId2 = insertProduct(db, { tenantId: 1, name: "iPhone 13 Refurb" });
      const [unit2] = runWithTenant(1, () =>
        repo.addUnits(productId2, ["111111111111111"]),
      );

      const story = runWithTenant(1, () =>
        repo.getUnitStoryByImei("111111111111111"),
      );
      expect(story.map((s) => s.id)).toEqual([unit2.id, unit.id]);
    });
  });

  // ---------------------------------------------------------------------------
  // listUnits — the Phone Units management view read
  // ---------------------------------------------------------------------------

  describe("listUnits", () => {
    /** Registers `imeis` on a product and returns the units, newest-first
     *  (the order `listUnits` itself uses) for easy id assertions. */
    function seedUnits(productId: number, imeis: string[]) {
      const units = runWithTenant(1, () => repo.addUnits(productId, imeis));
      return [...units].reverse();
    }

    it("orders pu.id DESC and reports the unpaged total alongside the page", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const newestFirst = seedUnits(productId, [
        "100000000000001",
        "100000000000002",
        "100000000000003",
        "100000000000004",
        "100000000000005",
      ]);

      const page1 = runWithTenant(1, () =>
        repo.listUnits({ limit: 2, offset: 0 }),
      );
      expect(page1.total).toBe(5);
      expect(page1.rows.map((r) => r.id)).toEqual([
        newestFirst[0].id,
        newestFirst[1].id,
      ]);

      const page2 = runWithTenant(1, () =>
        repo.listUnits({ limit: 2, offset: 2 }),
      );
      expect(page2.total).toBe(5); // total is UNPAGED — same on every page
      expect(page2.rows.map((r) => r.id)).toEqual([
        newestFirst[2].id,
        newestFirst[3].id,
      ]);

      const page3 = runWithTenant(1, () =>
        repo.listUnits({ limit: 2, offset: 4 }),
      );
      expect(page3.total).toBe(5);
      expect(page3.rows.map((r) => r.id)).toEqual([newestFirst[4].id]);

      // Past the end: empty page, total unchanged.
      const page4 = runWithTenant(1, () =>
        repo.listUnits({ limit: 2, offset: 6 }),
      );
      expect(page4.rows).toHaveLength(0);
      expect(page4.total).toBe(5);
    });

    it("filters by status, and the total follows the SAME filter as the rows", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const units = runWithTenant(1, () =>
        repo.addUnits(productId, [
          "200000000000001",
          "200000000000002",
          "200000000000003",
        ]),
      );
      runWithTenant(1, () => repo.markSold(units[0].id, 601));

      const sold = runWithTenant(1, () =>
        repo.listUnits({ status: "SOLD", limit: 50, offset: 0 }),
      );
      expect(sold.total).toBe(1);
      expect(sold.rows.map((r) => r.id)).toEqual([units[0].id]);

      const inStock = runWithTenant(1, () =>
        repo.listUnits({ status: "IN_STOCK", limit: 50, offset: 0 }),
      );
      expect(inStock.total).toBe(2);
      expect(inStock.rows.map((r) => r.id).sort()).toEqual(
        [units[1].id, units[2].id].sort(),
      );

      // A page window smaller than the match set must NOT shrink the total.
      const firstPage = runWithTenant(1, () =>
        repo.listUnits({ status: "IN_STOCK", limit: 1, offset: 0 }),
      );
      expect(firstPage.rows).toHaveLength(1);
      expect(firstPage.total).toBe(2);
    });

    it("narrows to defective units when defectiveOnly is true, and widens back when false/absent", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const units = runWithTenant(1, () =>
        repo.addUnits(productId, ["300000000000001", "300000000000002"]),
      );
      db.prepare(
        `UPDATE product_units SET is_defective = 1 WHERE id = ?`,
      ).run(units[1].id);

      const defective = runWithTenant(1, () =>
        repo.listUnits({ defectiveOnly: true, limit: 50, offset: 0 }),
      );
      expect(defective.total).toBe(1);
      expect(defective.rows.map((r) => r.id)).toEqual([units[1].id]);
      expect(defective.rows[0].is_defective).toBe(1);

      // false is "no defect filter", NOT "only healthy units".
      const explicitFalse = runWithTenant(1, () =>
        repo.listUnits({ defectiveOnly: false, limit: 50, offset: 0 }),
      );
      expect(explicitFalse.total).toBe(2);

      const absent = runWithTenant(1, () =>
        repo.listUnits({ limit: 50, offset: 0 }),
      );
      expect(absent.total).toBe(2);
    });

    it("search LIKE-matches a partial IMEI", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const units = runWithTenant(1, () =>
        repo.addUnits(productId, ["356938035643809", "356938035643810"]),
      );

      const hit = runWithTenant(1, () =>
        repo.listUnits({ search: "43809", limit: 50, offset: 0 }),
      );
      expect(hit.total).toBe(1);
      expect(hit.rows.map((r) => r.id)).toEqual([units[0].id]);

      const both = runWithTenant(1, () =>
        repo.listUnits({ search: "3569380356438", limit: 50, offset: 0 }),
      );
      expect(both.total).toBe(2);

      const miss = runWithTenant(1, () =>
        repo.listUnits({ search: "999999", limit: 50, offset: 0 }),
      );
      expect(miss.rows).toHaveLength(0);
      expect(miss.total).toBe(0);
    });

    it("search LIKE-matches the product name too — and the COUNT(*) twin keeps the join, so the total agrees", () => {
      const iphoneId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const galaxyId = insertProduct(db, { tenantId: 1, name: "Galaxy S23" });
      const iphoneUnits = runWithTenant(1, () =>
        repo.addUnits(iphoneId, ["400000000000001", "400000000000002"]),
      );
      const galaxyUnits = runWithTenant(1, () =>
        repo.addUnits(galaxyId, ["400000000000003"]),
      );

      const galaxy = runWithTenant(1, () =>
        repo.listUnits({ search: "galaxy", limit: 50, offset: 0 }),
      );
      expect(galaxy.total).toBe(1);
      expect(galaxy.rows.map((r) => r.id)).toEqual([galaxyUnits[0].id]);
      expect(galaxy.rows[0].product_name).toBe("Galaxy S23");

      const iphone = runWithTenant(1, () =>
        repo.listUnits({ search: "iPhone", limit: 50, offset: 0 }),
      );
      expect(iphone.total).toBe(2);
      expect(iphone.rows.map((r) => r.id).sort()).toEqual(
        [iphoneUnits[0].id, iphoneUnits[1].id].sort(),
      );

      // A whitespace-only search must NOT degenerate into LIKE '%%'-matches-
      // everything with a bogus filter applied — it is dropped entirely.
      const blank = runWithTenant(1, () =>
        repo.listUnits({ search: "   ", limit: 50, offset: 0 }),
      );
      expect(blank.total).toBe(3);
    });

    it("combines status + search + defectiveOnly in one WHERE", () => {
      const iphoneId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const galaxyId = insertProduct(db, { tenantId: 1, name: "Galaxy S23" });
      const iphoneUnits = runWithTenant(1, () =>
        repo.addUnits(iphoneId, ["500000000000001", "500000000000002"]),
      );
      runWithTenant(1, () => repo.addUnits(galaxyId, ["500000000000003"]));

      // iPhone unit 0: SOLD + defective. iPhone unit 1: IN_STOCK + defective.
      runWithTenant(1, () => repo.markSold(iphoneUnits[0].id, 701));
      db.prepare(
        `UPDATE product_units SET is_defective = 1 WHERE id IN (?, ?)`,
      ).run(iphoneUnits[0].id, iphoneUnits[1].id);

      const result = runWithTenant(1, () =>
        repo.listUnits({
          status: "SOLD",
          defectiveOnly: true,
          search: "iPhone",
          limit: 50,
          offset: 0,
        }),
      );
      expect(result.total).toBe(1);
      expect(result.rows.map((r) => r.id)).toEqual([iphoneUnits[0].id]);
    });

    it("joins the sale provenance for a sold unit (sold_at/sold_price_usd/client_name/warranty_until) and derives sale_refunded = 0", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const clientId = insertClient(db, 1, "Jane Doe");
      const saleId = insertSale(db, 1, clientId);
      const saleItemId = insertSaleItem(db, {
        tenantId: 1,
        saleId,
        productId,
        soldPriceUsd: 999.99,
        warrantyUntil: "2027-01-01",
      });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["600000000000001"]),
      );
      runWithTenant(1, () => repo.markSold(unit.id, saleItemId));

      const { rows, total } = runWithTenant(1, () =>
        repo.listUnits({ limit: 50, offset: 0 }),
      );
      expect(total).toBe(1);
      const row = rows[0];
      const saleCreatedAt = (
        db.prepare(`SELECT created_at FROM sales WHERE id = ?`).get(saleId) as {
          created_at: string;
        }
      ).created_at;

      expect(row).toMatchObject({
        id: unit.id,
        product_id: productId,
        imei: "600000000000001",
        status: "SOLD",
        is_defective: 0,
        warranty_override_until: null,
        product_name: "iPhone 13",
        sale_item_id: saleItemId,
        sold_at: saleCreatedAt,
        sold_price_usd: 999.99,
        client_name: "Jane Doe",
        warranty_until: "2027-01-01",
        sale_refunded: 0,
      });
      expect(typeof row.created_at).toBe("string");
    });

    it("derives sale_refunded = 1 from the is_refunded flag", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const saleId = insertSale(db, 1, null);
      const saleItemId = insertSaleItem(db, {
        tenantId: 1,
        saleId,
        productId,
        isRefunded: true,
        warrantyUntil: "2027-01-01",
      });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["700000000000001"]),
      );
      runWithTenant(1, () => repo.markSold(unit.id, saleItemId));

      const { rows } = runWithTenant(1, () =>
        repo.listUnits({ limit: 50, offset: 0 }),
      );
      expect(rows[0].sale_refunded).toBe(1);
      expect(rows[0].client_name).toBeNull(); // walk-in sale, no client
    });

    it("derives sale_refunded = 1 from refunded_quantity >= quantity even with is_refunded still 0", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const saleId = insertSale(db, 1, null);
      const fullyRefunded = insertSaleItem(db, {
        tenantId: 1,
        saleId,
        productId,
        quantity: 2,
        refundedQuantity: 2,
        isRefunded: false,
      });
      const partiallyRefunded = insertSaleItem(db, {
        tenantId: 1,
        saleId,
        productId,
        quantity: 2,
        refundedQuantity: 1,
        isRefunded: false,
      });
      const units = runWithTenant(1, () =>
        repo.addUnits(productId, ["800000000000001", "800000000000002"]),
      );
      runWithTenant(1, () => repo.markSold(units[0].id, fullyRefunded));
      runWithTenant(1, () => repo.markSold(units[1].id, partiallyRefunded));

      const { rows } = runWithTenant(1, () =>
        repo.listUnits({ limit: 50, offset: 0 }),
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(units[0].id)!.sale_refunded).toBe(1);
      expect(byId.get(units[1].id)!.sale_refunded).toBe(0);
    });

    it("returns null sale fields — including sale_refunded — for a unit that was never sold", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const [unit] = runWithTenant(1, () =>
        repo.addUnits(productId, ["900000000000001"]),
      );

      const { rows } = runWithTenant(1, () =>
        repo.listUnits({ limit: 50, offset: 0 }),
      );
      expect(rows[0]).toMatchObject({
        id: unit.id,
        product_name: "iPhone 13",
        sale_item_id: null,
        sold_at: null,
        sold_price_usd: null,
        client_name: null,
        warranty_until: null,
        // null, NOT 0 — "no sale to refund" is distinguishable from "sold
        // and not refunded".
        sale_refunded: null,
      });
    });

    /**
     * Owner-reported 2026-08-26 (the display gap): an IN_STOCK unit of a
     * 6-month model used to reach the Phone Units page with nothing but a
     * `NONE` verdict, so fresh stock read "No warranty". The MODEL's term now
     * rides on the same shared provenance join for BOTH the in-stock and the
     * sold row, while the sale stamp stays untouched — the term is display
     * information, never retroactive coverage (decision #4).
     */
    it("carries the model's warranty term as product_warranty_months for in-stock AND sold rows", () => {
      const withTerm = insertProduct(db, {
        tenantId: 1,
        name: "iPhone 13",
        warrantyMonths: 6,
      });
      const withoutTerm = insertProduct(db, {
        tenantId: 1,
        name: "Nokia 3310",
      });

      const [inStock] = runWithTenant(1, () =>
        repo.addUnits(withTerm, ["910000000000001"]),
      );
      const [sold] = runWithTenant(1, () =>
        repo.addUnits(withTerm, ["910000000000002"]),
      );
      const [bare] = runWithTenant(1, () =>
        repo.addUnits(withoutTerm, ["910000000000003"]),
      );

      const saleId = insertSale(db, 1, null);
      const saleItemId = insertSaleItem(db, {
        tenantId: 1,
        saleId,
        productId: withTerm,
        warrantyUntil: "2027-02-01",
      });
      runWithTenant(1, () => repo.markSold(sold.id, saleItemId));

      const { rows } = runWithTenant(1, () =>
        repo.listUnits({ limit: 50, offset: 0 }),
      );
      const byId = new Map(rows.map((r) => [r.id, r]));

      // In stock: the term is there even though there is no sale stamp at all.
      expect(byId.get(inStock.id)!.product_warranty_months).toBe(6);
      expect(byId.get(inStock.id)!.status).toBe("IN_STOCK");
      expect(byId.get(inStock.id)!.warranty_until).toBeNull();

      // Sold: the term and the sale's own stamp are independent columns.
      expect(byId.get(sold.id)!.product_warranty_months).toBe(6);
      expect(byId.get(sold.id)!.warranty_until).toBe("2027-02-01");

      // A model with no term at all stays null — this is what keeps a
      // genuinely warranty-less unit distinguishable from unsold stock.
      expect(byId.get(bare.id)!.product_warranty_months).toBeNull();
    });

    it("never shows tenant B's units to tenant A — rows AND total", () => {
      const productA = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const productB = insertProduct(db, { tenantId: 2, name: "iPhone 13" });
      const unitsA = runWithTenant(1, () =>
        repo.addUnits(productA, ["110000000000001", "110000000000002"]),
      );
      const unitsB = runWithTenant(2, () =>
        repo.addUnits(productB, [
          "120000000000001",
          "120000000000002",
          "120000000000003",
        ]),
      );

      const seenByA = runWithTenant(1, () =>
        repo.listUnits({ limit: 50, offset: 0 }),
      );
      expect(seenByA.total).toBe(2);
      expect(seenByA.rows.map((r) => r.id).sort()).toEqual(
        [unitsA[0].id, unitsA[1].id].sort(),
      );

      const seenByB = runWithTenant(2, () =>
        repo.listUnits({ limit: 50, offset: 0 }),
      );
      expect(seenByB.total).toBe(3);
      expect(seenByB.rows.map((r) => r.id).sort()).toEqual(
        unitsB.map((u) => u.id).sort(),
      );

      // Tenant A searching for tenant B's IMEI finds nothing.
      const crossSearch = runWithTenant(1, () =>
        repo.listUnits({ search: "120000000000001", limit: 50, offset: 0 }),
      );
      expect(crossSearch.rows).toHaveLength(0);
      expect(crossSearch.total).toBe(0);
    });

    it("does not leak another tenant's client/sale names through the join", () => {
      // Tenant A's unit points at a sale line that belongs to tenant B (the
      // corrupted-FK case the per-join tenant guards exist for).
      const productA = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const clientB = insertClient(db, 2, "Tenant B Client");
      const saleB = insertSale(db, 2, clientB);
      const saleItemB = insertSaleItem(db, {
        tenantId: 2,
        saleId: saleB,
        productId: productA,
        soldPriceUsd: 500,
        warrantyUntil: "2027-06-01",
      });
      const [unitA] = runWithTenant(1, () =>
        repo.addUnits(productA, ["130000000000001"]),
      );
      runWithTenant(1, () => repo.markSold(unitA.id, saleItemB));

      const { rows } = runWithTenant(1, () =>
        repo.listUnits({ limit: 50, offset: 0 }),
      );
      expect(rows[0].sale_item_id).toBe(saleItemB); // the raw pointer is kept
      expect(rows[0].client_name).toBeNull();
      expect(rows[0].sold_at).toBeNull();
      expect(rows[0].sold_price_usd).toBeNull();
      expect(rows[0].warranty_until).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // countInStock
  // ---------------------------------------------------------------------------

  describe("countInStock", () => {
    it("counts only IN_STOCK units for the given product", () => {
      const productId = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const units = runWithTenant(1, () =>
        repo.addUnits(productId, [
          "111111111111111",
          "222222222222222",
          "333333333333333",
        ]),
      );
      runWithTenant(1, () => repo.markSold(units[0].id, 999));

      expect(runWithTenant(1, () => repo.countInStock(productId))).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe("tenant isolation", () => {
    it("tenant A's units are invisible to tenant B's reads", () => {
      const productA = insertProduct(db, { tenantId: 1, name: "iPhone 13" });
      const productB = insertProduct(db, { tenantId: 2, name: "iPhone 13" });

      runWithTenant(1, () =>
        repo.addUnits(productA, ["111111111111111", "222222222222222"]),
      );
      runWithTenant(2, () => repo.addUnits(productB, ["333333333333333"]));

      const unitsA = runWithTenant(1, () => repo.getUnitsForProduct(productA));
      expect(unitsA).toHaveLength(2);

      const unitsB = runWithTenant(2, () => repo.getUnitsForProduct(productB));
      expect(unitsB).toHaveLength(1);

      // Tenant B's countInStock for tenant A's product id must be 0 — cross-
      // tenant id collision must not leak tenant A's units.
      expect(runWithTenant(2, () => repo.countInStock(productA))).toBe(0);

      // Tenant B cannot find tenant A's IMEI via findActiveByImei.
      expect(
        runWithTenant(2, () => repo.findActiveByImei("111111111111111")),
      ).toBeNull();

      const summaryB = runWithTenant(2, () =>
        repo.getSummaryForProducts([productA, productB]),
      );
      expect(summaryB[productA]).toBeUndefined();
      expect(summaryB[productB]).toEqual({
        in_stock: 1,
        sold: 0,
        defective: 0,
      });
    });
  });
});
