/**
 * Settings › Reset Data keeps the shop's SETUP and wipes only operational
 * data (owner decision 2026-10-07).
 *
 * The reset used to wipe things the panel said it keeps: the shop's own
 * product categories (re-seeded to the 6 defaults), its Mobile Services
 * items, its service presets (re-seeded to the 4 defaults), its partners and
 * hand-added suppliers, the product catalog, the product-supplier names, and
 * the per-item cost / voucher-image overrides.
 *
 * Owner intent: every one of those ROWS survives. Only their money/stock
 * state resets — supplier and partner balances read 0 (their ledgers are
 * operational and are wiped), product stock is 0 (stock batches, IMEI units
 * and stock history are wiped).
 *
 * Balances are asserted through the REAL repository balance readers the
 * Suppliers / Partners pages use, not by counting ledger rows, so the test
 * fails for the reason a user would see.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import {
  DatabaseResetRepository,
  resetDatabaseResetRepository,
} from "../DatabaseResetRepository.js";
import { SupplierRepository } from "../SupplierRepository.js";
import { PartnerRepository } from "../PartnerRepository.js";
import { runWithTenant, resetTenantContext } from "../../db/tenantContext.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  db.pragma("foreign_keys = ON");
  return db;
}

function count(db: Database.Database, table: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE tenant_id = 1`)
      .get() as { n: number }
  ).n;
}

function snapshot(
  db: Database.Database,
  table: string,
  columns = "*",
): unknown[] {
  return db
    .prepare(
      `SELECT ${columns} FROM "${table}" WHERE tenant_id = 1 ORDER BY id`,
    )
    .all();
}

describe("Reset Data keeps the shop's setup", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetDatabaseResetRepository();
    db.close();
  });

  const reset = () =>
    runWithTenant(1, () => new DatabaseResetRepository().resetTenantData());

  it("keeps every product category and service preset the shop has, with no defaults re-added", () => {
    db.prepare(
      `INSERT INTO product_categories (tenant_id, name, sort_order) VALUES (1, 'Custom Category', 99)`,
    ).run();
    // A default the shop renamed must stay renamed (not come back as 'Audio').
    db.prepare(
      `UPDATE product_categories SET name = 'Speakers' WHERE tenant_id = 1 AND name = 'Audio'`,
    ).run();
    db.prepare(
      `INSERT INTO service_presets (tenant_id, name, category, cost_usd, price_usd, sort_order)
       VALUES (1, 'Custom Preset', 'digital_account', 1, 2, 99)`,
    ).run();
    db.prepare(
      `DELETE FROM service_presets WHERE tenant_id = 1 AND name = 'Shahid VIP 1 Month'`,
    ).run();

    const categoriesBefore = snapshot(db, "product_categories");
    const presetsBefore = snapshot(db, "service_presets");

    reset();

    expect(snapshot(db, "product_categories")).toEqual(categoriesBefore);
    expect(snapshot(db, "service_presets")).toEqual(presetsBefore);
  });

  it("keeps every Mobile Services item, including ones the shop added, and the per-item cost / voucher-image settings", () => {
    db.prepare(
      `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp)
       VALUES (1, 'mtc', 'recharge', 'credit', 'Shop-added bundle', 100, 150)`,
    ).run();
    db.prepare(
      `INSERT INTO item_costs (tenant_id, provider, category, item_key, cost)
       VALUES (1, 'mtc', 'recharge', 'bundle-key', 4.5)`,
    ).run();
    db.prepare(
      `INSERT INTO voucher_images (tenant_id, provider, category, item_key, image_path)
       VALUES (1, 'mtc', 'recharge', 'bundle-key', 'bundle.png')`,
    ).run();

    const items = snapshot(db, "mobile_service_items");
    const costs = snapshot(db, "item_costs");
    const images = snapshot(db, "voucher_images");
    expect(items.length).toBeGreaterThan(0);

    reset();

    expect(snapshot(db, "mobile_service_items")).toEqual(items);
    expect(snapshot(db, "item_costs")).toEqual(costs);
    expect(snapshot(db, "voucher_images")).toEqual(images);
  });

  it("keeps hand-added suppliers and partners, and their balances read 0 afterwards", () => {
    const adHocId = db
      .prepare(
        `INSERT INTO suppliers (tenant_id, name, phone) VALUES (1, 'AdHoc Co', '70-000000')`,
      )
      .run().lastInsertRowid as number;
    const partnerId = db
      .prepare(
        `INSERT INTO partners (tenant_id, name, phone) VALUES (1, 'Partner Co', '71-000000')`,
      )
      .run().lastInsertRowid as number;
    db.prepare(
      `INSERT INTO product_suppliers (tenant_id, name, supplier_id) VALUES (1, 'AdHoc Co', ?)`,
    ).run(adHocId);

    db.prepare(
      `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp)
       VALUES (1, ?, 'TOP_UP', 120, 50000)`,
    ).run(adHocId);
    db.prepare(
      `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, amount, currency, direction)
       VALUES (1, ?, 'TEST', 75, 'USD', 'DEBIT')`,
    ).run(partnerId);

    const supplierBalance = () =>
      runWithTenant(1, () =>
        new SupplierRepository()
          .getSupplierBalances(true)
          .find((b) => b.supplier_id === adHocId),
      );
    const partnerBalance = () =>
      runWithTenant(1, () => new PartnerRepository().getBalance(partnerId));

    // Sanity: the balances really are non-zero before the reset.
    expect(supplierBalance()?.total_usd).toBe(120);
    expect(supplierBalance()?.total_lbp).toBe(50000);
    expect(partnerBalance().usd).toBe(75);

    const suppliersBefore = snapshot(db, "suppliers");
    const partnersBefore = snapshot(db, "partners");
    const productSuppliersBefore = snapshot(db, "product_suppliers");

    reset();

    // Every supplier (system, module-owned AND hand-added) and partner row
    // survives untouched.
    expect(snapshot(db, "suppliers")).toEqual(suppliersBefore);
    expect(snapshot(db, "partners")).toEqual(partnersBefore);
    expect(snapshot(db, "product_suppliers")).toEqual(productSuppliersBefore);

    // …and owes / is owed nothing.
    expect(supplierBalance()).toEqual(
      expect.objectContaining({ total_usd: 0, total_lbp: 0 }),
    );
    expect(partnerBalance()).toEqual({ usd: 0, lbp: 0, usdt: 0 });
    expect(count(db, "supplier_ledger")).toBe(0);
    expect(count(db, "partner_ledger")).toBe(0);
  });

  it("keeps products with their catalog details, zeroes stock, and wipes stock batches / IMEI units / stock history", () => {
    const categoryId = (
      db
        .prepare(
          `SELECT id FROM product_categories WHERE tenant_id = 1 AND name = 'Phones'`,
        )
        .get() as { id: number }
    ).id;
    const supplierId = db
      .prepare(`INSERT INTO suppliers (tenant_id, name) VALUES (1, 'Phone Co')`)
      .run().lastInsertRowid as number;
    const productId = db
      .prepare(
        `INSERT INTO products
           (tenant_id, barcode, name, item_type, category_id, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity)
         VALUES (1, 'BC-1', 'Phone X', 'Product', ?, 300, 400, 2, 5)`,
      )
      .run(categoryId).lastInsertRowid as number;
    const batchId = db
      .prepare(
        `INSERT INTO product_stock_batches (tenant_id, product_id, supplier_id, quantity, quantity_remaining)
         VALUES (1, ?, ?, 5, 5)`,
      )
      .run(productId, supplierId).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO stock_batch_consumptions (tenant_id, batch_id, product_id, quantity, unit_cost_usd)
       VALUES (1, ?, ?, 1, 300)`,
    ).run(batchId, productId);
    db.prepare(
      `INSERT INTO product_units (tenant_id, product_id, imei) VALUES (1, ?, 'IMEI-1')`,
    ).run(productId);
    db.prepare(
      `INSERT INTO stock_adjustments (tenant_id, product_id, delta, old_quantity, new_quantity, reason)
       VALUES (1, ?, 5, 0, 5, 'test')`,
    ).run(productId);

    reset();

    const product = db
      .prepare(`SELECT * FROM products WHERE id = ?`)
      .get(productId) as Record<string, unknown> | undefined;
    expect(product).toBeTruthy();
    expect(product?.stock_quantity).toBe(0);
    expect(product?.name).toBe("Phone X");
    expect(product?.barcode).toBe("BC-1");
    expect(product?.category_id).toBe(categoryId);
    expect(product?.cost_price_usd).toBe(300);
    expect(product?.selling_price_usd).toBe(400);
    expect(product?.min_stock_level).toBe(2);

    for (const table of [
      "product_stock_batches",
      "stock_batch_consumptions",
      "product_units",
      "stock_adjustments",
    ]) {
      expect(count(db, table)).toBe(0);
    }
  });

  it("the preview never lists a kept setup table as something to remove", () => {
    db.prepare(
      `INSERT INTO suppliers (tenant_id, name) VALUES (1, 'AdHoc Co')`,
    ).run();
    db.prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'P')`).run();
    db.prepare(
      `INSERT INTO products (tenant_id, name, item_type) VALUES (1, 'Thing', 'Product')`,
    ).run();

    const preview = runWithTenant(1, () =>
      new DatabaseResetRepository().previewCounts(),
    );

    for (const kept of [
      "product_categories",
      "service_presets",
      "mobile_service_items",
      "suppliers",
      "partners",
      "products",
      "product_suppliers",
      "item_costs",
      "voucher_images",
    ]) {
      expect(preview.counts).not.toHaveProperty(kept);
    }
    // Operational tables are still counted (0 is a real count, not absent).
    expect(preview.counts.transactions).toBe(0);
  });
});
