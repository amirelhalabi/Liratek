/**
 * LIRA-296 P3 (T048, FR-022) — a serial-tracked item sold without picking
 * its unit. The trigger is unchanged (the product has registered IN_STOCK
 * units nobody on this sale claimed — the drift rule, owner decision #5);
 * the CATEGORY now decides what happens:
 *   BLOCK (default) — refused, with `code: 'SERIAL_REQUIRED'` (the message
 *                     stays the one cashiers already know);
 *   WARN            — the sale goes through with a `warnings[]` line, and no
 *                     unit is marked sold.
 * Real schema (create_db.sql + migrations).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SalesRepository, resetSalesRepository } from "../SalesRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";

const REPO_ROOT = path.join(__dirname, "../../../../..");
let db: Database.Database;

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(
    fs.readFileSync(
      path.join(REPO_ROOT, "electron-app/create_db.sql"),
      "utf-8",
    ),
  );
  initDatabase(db);
  runMigrations(db);
  initFixedTenantContext(1);
});
afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function laptopWithUnits(serialRequired: "BLOCK" | "WARN"): number {
  const catId = Number(
    db
      .prepare(
        `INSERT INTO product_categories (tenant_id, name, sort_order, tracks_imei_units, serial_label, serial_required)
         VALUES (1, 'Laptops', 9, 1, 'Serial', ?)`,
      )
      .run(serialRequired).lastInsertRowid,
  );
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, category, category_id, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, 'ThinkPad', 'Product', 'Laptops', ?, 400, 600, 2)`,
      )
      .run(catId).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, ?, 'SN-001', 'IN_STOCK'), (1, ?, 'SN-002', 'IN_STOCK')`,
  ).run(productId, productId);
  return productId;
}

const sellWithoutUnit = (productId: number) =>
  new SalesRepository().processSale(
    {
      client_id: null,
      items: [{ product_id: productId, quantity: 1, price: 600 }],
      total_amount: 600,
      discount: 0,
      final_amount: 600,
      payment_usd: 600,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 600 }],
      exchange_rate: 89500,
      status: "completed",
      client_day: "2026-10-10",
    },
    1,
  );

const inStockUnits = () =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM product_units WHERE status = 'IN_STOCK'`,
      )
      .get() as { n: number }
  ).n;

it("BLOCK: refused with code SERIAL_REQUIRED; nothing written", () => {
  const productId = laptopWithUnits("BLOCK");
  const res = sellWithoutUnit(productId);
  expect(res).toMatchObject({ success: false, code: "SERIAL_REQUIRED" });
  expect(res.error).toMatch(/IMEI-registered unit|identify the unit/i);
  expect(
    (db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as { n: number }).n,
  ).toBe(0);
});

it("WARN: the sale goes through with a warning; no unit is marked sold", () => {
  const productId = laptopWithUnits("WARN");
  const res = sellWithoutUnit(productId);
  expect(res.success).toBe(true);
  expect(res.warnings).toEqual([
    expect.stringContaining("ThinkPad"),
  ]);
  expect(inStockUnits()).toBe(2);
});

it("a product with no registered units sells as before, with no warning", () => {
  const productId = laptopWithUnits("WARN");
  db.exec(`DELETE FROM product_units`);
  const res = sellWithoutUnit(productId);
  expect(res.success).toBe(true);
  expect(res.warnings ?? []).toEqual([]);
});

it("getSaleItems carries the category's serial label for receipts and the sale details", () => {
  const productId = laptopWithUnits("WARN");
  const unit = db
    .prepare(`SELECT id FROM product_units WHERE imei = 'SN-001'`)
    .get() as { id: number };
  const res = new SalesRepository().processSale(
    {
      client_id: null,
      items: [
        {
          product_id: productId,
          quantity: 1,
          price: 600,
          product_unit_id: unit.id,
        },
      ],
      total_amount: 600,
      discount: 0,
      final_amount: 600,
      payment_usd: 600,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 600 }],
      exchange_rate: 89500,
      status: "completed",
      client_day: "2026-10-10",
    },
    1,
  );
  expect(res.success).toBe(true);
  const [line] = new SalesRepository().getSaleItems(res.id!);
  expect(line).toMatchObject({ imei: "SN-001", serial_label: "Serial" });
});
