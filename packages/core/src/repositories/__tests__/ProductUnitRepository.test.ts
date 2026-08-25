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
  opts: { tenantId: number; name: string; stockQuantity?: number },
): number {
  const result = db
    .prepare(
      `INSERT INTO products (tenant_id, name, stock_quantity) VALUES (?, ?, ?)`,
    )
    .run(opts.tenantId, opts.name, opts.stockQuantity ?? 0);
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
