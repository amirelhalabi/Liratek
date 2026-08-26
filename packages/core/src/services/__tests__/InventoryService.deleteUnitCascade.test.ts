/**
 * InventoryService.deleteProduct / batchDeleteProducts — the IN_STOCK
 * `product_units` cascade (owner decision 2026-08-26, "zero-burden delete",
 * LIRA-143 item 7).
 *
 * ## The bug
 *
 * `products` is soft-deleted (`is_deleted = 1`) and disappears from every
 * product read. `product_units` has NO soft-delete column at all
 * (`super("product_units", { softDelete: false })`), so the deleted model's
 * unsold units survived as invisible rows — and kept HOLDING their IMEIs
 * under the partial unique index `idx_product_units_active_imei`
 * (`tenant_id, imei` WHERE `status = 'IN_STOCK'`). Re-registering one of
 * those IMEIs on a live product then failed with
 *
 *   IMEI <x> is already registered in stock on product "<the deleted one>"
 *
 * naming a product the operator can no longer see, open, or fix. Nothing in
 * the UI could clear it.
 *
 * ## Rule 17 — failing-first, recorded
 *
 * Run against the pre-cascade `deleteProduct`, the two "frees the IMEI" cases
 * failed on exactly that named error:
 *
 *   Error: IMEI 111000000000001 is already registered in stock on product
 *          "iPhone 13 (to delete)"
 *
 * i.e. the assertions below that now expect a SUCCESSFUL re-registration were
 * observed RED, with the orphan-holder error as the cause. The `.toThrow`
 * assertion that PROVED the lock is kept in `describe("the bug, pinned")`
 * below, aimed at the pre-delete state where the lock is legitimate — so the
 * mechanism itself stays covered rather than just disappearing with the fix.
 *
 * SOLD units surviving is asserted positively (row + status + full
 * `getUnitStoryByImei` provenance), so a cascade that over-reached from
 * `IN_STOCK` to "all units of this product" fails here.
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../../repositories/ProductRepository.js";
import { ProductUnitRepository } from "../../repositories/ProductUnitRepository.js";
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
      is_refunded        BOOLEAN DEFAULT 0,
      refunded_quantity  INTEGER DEFAULT 0,
      warranty_until     TEXT
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
  `);
  return db;
}

// Distinctive, self-provisioned IMEIs — nothing else in the suite uses this
// 1110/1120 prefix pair.
const IMEI_STOCK_A = "111000000000001";
const IMEI_STOCK_B = "111000000000002";
const IMEI_SOLD = "112000000000009";

describe("InventoryService — product delete cascades IN_STOCK units", () => {
  let db: Database.Database;
  let service: InventoryService;
  let unitRepo: ProductUnitRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    const productRepo = new ProductRepository();
    unitRepo = new ProductUnitRepository();
    service = new InventoryService(productRepo, undefined, unitRepo);
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  function insertProduct(name: string, tenantId = 1): number {
    return Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, name, stock_quantity, warranty_months) VALUES (?, ?, 3, 12)`,
        )
        .run(tenantId, name).lastInsertRowid,
    );
  }

  /** A product with 2 IN_STOCK units and 1 SOLD unit carrying real sale
   *  provenance (client + sale line + warranty stamp). */
  function seedPhoneModel(name: string): {
    productId: number;
    soldUnitId: number;
    saleItemId: number;
  } {
    const productId = insertProduct(name);
    const clientId = Number(
      db
        .prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, ?)`)
        .run("Walk-in Nadia").lastInsertRowid,
    );
    const saleId = Number(
      db
        .prepare(`INSERT INTO sales (tenant_id, client_id) VALUES (1, ?)`)
        .run(clientId).lastInsertRowid,
    );
    const saleItemId = Number(
      db
        .prepare(
          `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, sold_price_usd, warranty_until)
           VALUES (1, ?, ?, 1, 640, '2027-08-26')`,
        )
        .run(saleId, productId).lastInsertRowid,
    );

    runWithTenant(1, () => {
      unitRepo.addUnits(productId, [IMEI_STOCK_A, IMEI_STOCK_B, IMEI_SOLD]);
    });
    const soldUnitId = (
      db
        .prepare(`SELECT id FROM product_units WHERE imei = ?`)
        .get(IMEI_SOLD) as { id: number }
    ).id;
    runWithTenant(1, () => unitRepo.markSold(soldUnitId, saleItemId));

    return { productId, soldUnitId, saleItemId };
  }

  function unitRows(productId: number): { imei: string; status: string }[] {
    return db
      .prepare(
        `SELECT imei, status FROM product_units WHERE product_id = ? ORDER BY id ASC`,
      )
      .all(productId) as { imei: string; status: string }[];
  }

  function isDeleted(productId: number): number {
    return (
      db
        .prepare(`SELECT is_deleted FROM products WHERE id = ?`)
        .get(productId) as { is_deleted: number }
    ).is_deleted;
  }

  describe("the bug, pinned — the lock this cascade lifts", () => {
    it("an IN_STOCK unit legitimately blocks re-registering its IMEI while its product is alive", () => {
      const { productId } = seedPhoneModel("iPhone 13 (alive)");
      const other = insertProduct("Galaxy S23");
      expect(isDeleted(productId)).toBe(0);

      expect(() =>
        runWithTenant(1, () => unitRepo.addUnits(other, [IMEI_STOCK_A])),
      ).toThrow(
        `IMEI ${IMEI_STOCK_A} is already registered in stock on product "iPhone 13 (alive)"`,
      );
    });
  });

  describe("deleteProduct", () => {
    it("removes the IN_STOCK units, keeps the SOLD one, and reports honest numbers", () => {
      const { productId, soldUnitId } = seedPhoneModel("iPhone 13 (to delete)");

      const result = runWithTenant(1, () => service.deleteProduct(productId));

      expect(result.success).toBe(true);
      expect(result.removed_unit_count).toBe(2);
      expect(result.removed_unit_imeis).toEqual([IMEI_STOCK_A, IMEI_STOCK_B]);
      expect(isDeleted(productId)).toBe(1);

      // Only the SOLD row is left, untouched.
      expect(unitRows(productId)).toEqual([
        { imei: IMEI_SOLD, status: "SOLD" },
      ]);
      const sold = db
        .prepare(`SELECT id, status, sale_item_id FROM product_units WHERE id = ?`)
        .get(soldUnitId) as {
        id: number;
        status: string;
        sale_item_id: number | null;
      };
      expect(sold.status).toBe("SOLD");
      expect(sold.sale_item_id).not.toBeNull();
    });

    it("frees the IMEIs so they can be re-registered on a live product", () => {
      const { productId } = seedPhoneModel("iPhone 13 (to delete)");
      const other = insertProduct("Galaxy S23");

      runWithTenant(1, () => service.deleteProduct(productId));

      // RED pre-fix: `IMEI 111000000000001 is already registered in stock on
      // product "iPhone 13 (to delete)"` — a product the operator can no
      // longer open.
      const reregistered = runWithTenant(1, () =>
        unitRepo.addUnits(other, [IMEI_STOCK_A, IMEI_STOCK_B]),
      );
      expect(reregistered.map((u) => u.imei)).toEqual([
        IMEI_STOCK_A,
        IMEI_STOCK_B,
      ]);
      expect(reregistered.every((u) => u.status === "IN_STOCK")).toBe(true);
      expect(reregistered.every((u) => u.product_id === other)).toBe(true);
    });

    it("the SOLD unit's whole story survives the delete (walk-in warranty lookup)", () => {
      const { productId } = seedPhoneModel("iPhone 13 (to delete)");

      runWithTenant(1, () => service.deleteProduct(productId));

      const stories = runWithTenant(1, () =>
        unitRepo.getUnitStoryByImei(IMEI_SOLD),
      );
      expect(stories).toHaveLength(1);
      expect(stories[0]).toMatchObject({
        imei: IMEI_SOLD,
        status: "SOLD",
        product_id: productId,
        product_name: "iPhone 13 (to delete)",
        warranty_until: "2027-08-26",
        sold_price_usd: 640,
        client_name: "Walk-in Nadia",
      });
    });

    it("reports nothing when the product had no units at all", () => {
      const bare = insertProduct("USB Cable");
      const result = runWithTenant(1, () => service.deleteProduct(bare));
      expect(result.success).toBe(true);
      expect(result.removed_unit_count).toBeUndefined();
      expect(result.removed_unit_imeis).toBeUndefined();
      expect(isDeleted(bare)).toBe(1);
    });

    it("never reaches another product's units, or another tenant's", () => {
      const { productId } = seedPhoneModel("iPhone 13 (to delete)");
      const keeper = insertProduct("Galaxy S23");
      runWithTenant(1, () => unitRepo.addUnits(keeper, ["113000000000001"]));

      // Same IMEI text, tenant 2 — the partial index is per-tenant, so this
      // is a legal coexisting row that the cascade must not see.
      const otherTenantProduct = insertProduct("iPhone 13 (tenant 2)", 2);
      runWithTenant(2, () =>
        unitRepo.addUnits(otherTenantProduct, [IMEI_STOCK_A]),
      );

      runWithTenant(1, () => service.deleteProduct(productId));

      expect(unitRows(keeper)).toEqual([
        { imei: "113000000000001", status: "IN_STOCK" },
      ]);
      expect(unitRows(otherTenantProduct)).toEqual([
        { imei: IMEI_STOCK_A, status: "IN_STOCK" },
      ]);
    });
  });

  describe("batchDeleteProducts", () => {
    it("cascades for EVERY id in the batch and keeps every SOLD unit", () => {
      const first = seedPhoneModel("iPhone 13 (batch A)");
      // Second model, its own distinctive IMEIs.
      const secondId = insertProduct("Galaxy S23 (batch B)");
      runWithTenant(1, () =>
        unitRepo.addUnits(secondId, ["114000000000001", "114000000000002"]),
      );
      const soldB = (
        db
          .prepare(`SELECT id FROM product_units WHERE imei = ?`)
          .get("114000000000002") as { id: number }
      ).id;
      runWithTenant(1, () => unitRepo.markSold(soldB, first.saleItemId));

      const untouched = insertProduct("Screen Protector");
      runWithTenant(1, () => unitRepo.addUnits(untouched, ["115000000000001"]));

      const result = runWithTenant(1, () =>
        service.batchDeleteProducts([first.productId, secondId]),
      );

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(2);
      // 2 from model A + 1 from model B (its other unit is SOLD).
      expect(result.removed_unit_count).toBe(3);
      expect(result.removed_unit_imeis).toEqual([
        IMEI_STOCK_A,
        IMEI_STOCK_B,
        "114000000000001",
      ]);

      expect(unitRows(first.productId)).toEqual([
        { imei: IMEI_SOLD, status: "SOLD" },
      ]);
      expect(unitRows(secondId)).toEqual([
        { imei: "114000000000002", status: "SOLD" },
      ]);
      // A product outside the batch keeps everything.
      expect(unitRows(untouched)).toEqual([
        { imei: "115000000000001", status: "IN_STOCK" },
      ]);
    });

    it("frees the batch's IMEIs for re-registration", () => {
      const { productId } = seedPhoneModel("iPhone 13 (batch free)");
      const other = insertProduct("Galaxy S23");

      runWithTenant(1, () => service.batchDeleteProducts([productId]));

      const reregistered = runWithTenant(1, () =>
        unitRepo.addUnits(other, [IMEI_STOCK_A]),
      );
      expect(reregistered[0].imei).toBe(IMEI_STOCK_A);
      expect(reregistered[0].product_id).toBe(other);
    });

    it("rejects an empty id list without touching anything", () => {
      const { productId } = seedPhoneModel("iPhone 13 (untouched)");
      const result = runWithTenant(1, () => service.batchDeleteProducts([]));
      expect(result.success).toBe(false);
      expect(result.error).toBe("No product IDs provided");
      expect(unitRows(productId)).toHaveLength(3);
      expect(isDeleted(productId)).toBe(0);
    });
  });
});
