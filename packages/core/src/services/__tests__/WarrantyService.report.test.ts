/**
 * LIRA-296 P3 (T051) — the warranty report:
 *   - items still COVERED on the shop's day, grouped by category (a dedicated
 *     read — never the capped search);
 *   - claims made in the period, by action (voided claims left out), with
 *     gross cost, supplier recovery and net — net equals minus the Profits
 *     "Warranty cost" line for the same days (same rows, same date bound).
 * Real schema; nothing mocked.
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
import {
  SalesRepository,
  resetSalesRepository,
} from "../../repositories/SalesRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../../repositories/StockBatchRepository";
import { resetProductUnitRepository } from "../../repositories/ProductUnitRepository";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetWarrantyRepository } from "../../repositories/WarrantyRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { ProfitRepository } from "../../repositories/ProfitRepository";
import { localDay } from "../../utils/localDate";
import { getWarrantyService, resetWarrantyService } from "../WarrantyService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const ADMIN = { userId: 1, role: "admin" };
const TODAY = localDay();
let db: Database.Database;

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetWarrantyRepository();
  resetSupplierRepository();
  resetWarrantyService();
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
  db.exec(`
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami Haddad', '71123456');
    INSERT INTO suppliers (id, tenant_id, name) VALUES (40, 1, 'Gadget Wholesale');
  `);
});
afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function addProduct(name: string, category: string, cost: number): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, warranty_months)
         VALUES (1, ?, 'Product', ?, ?, 20, 10, 3)`,
      )
      .run(name, category, cost).lastInsertRowid,
  );
  getStockBatchRepository().createBatch({
    product_id: id,
    supplier_id: 40,
    quantity: 10,
    unit_cost_usd: cost,
    books_debt: false,
    created_by: 1,
  });
  return id;
}

function sell(productId: number, quantity: number, day: string): number {
  const result = new SalesRepository().processSale(
    {
      client_id: 7,
      items: [{ product_id: productId, quantity, price: 20 }],
      total_amount: 20 * quantity,
      discount: 0,
      final_amount: 20 * quantity,
      payment_usd: 20 * quantity,
      payment_lbp: 0,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 20 * quantity },
      ],
      exchange_rate: 89500,
      status: "completed",
      client_day: day,
    },
    1,
  );
  expect(result.success).toBe(true);
  return (
    db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
      .get(result.id) as { id: number }
  ).id;
}

const claim = (saleItemId: number, action: "REFUND" | "REPLACE" | "REPAIR") =>
  getWarrantyService().createClaim(
    { sale_item_id: saleItemId, action, client_day: TODAY },
    ADMIN,
  ) as { success: true; data: { claim: { id: number } } };

describe("WarrantyService.report", () => {
  it("lists items still covered today, grouped by category, with counts", () => {
    const charger = addProduct("Charger", "Chargers", 4);
    const earbuds = addProduct("Earbuds", "Audio", 6);
    sell(charger, 2, TODAY); // covered, qty 2
    sell(earbuds, 1, TODAY); // covered
    sell(earbuds, 1, "2025-01-01"); // ended 2025-04-01 — not covered

    const report = getWarrantyService().report({
      from: TODAY,
      to: TODAY,
      client_day: TODAY,
    });
    const byCat = Object.fromEntries(
      report.underWarranty.map((g) => [g.category, g.count]),
    );
    expect(byCat).toEqual({ Chargers: 2, Audio: 1 });
    const audio = report.underWarranty.find((g) => g.category === "Audio")!;
    expect(audio.items).toHaveLength(1);
    expect(audio.items[0]).toMatchObject({
      source: "SALE",
      productName: "Earbuds",
      customerName: "Rami Haddad",
      coveredQuantity: 1,
    });
  });

  it("a fully refunded line is not under warranty; a partly refunded one counts only what is left", () => {
    const charger = addProduct("Charger", "Chargers", 4);
    const lineA = sell(charger, 2, TODAY);
    // One of the two refunded through a REFUND claim.
    expect(claim(lineA, "REFUND").success).toBe(true);
    const report = getWarrantyService().report({
      from: TODAY,
      to: TODAY,
      client_day: TODAY,
    });
    expect(report.underWarranty).toEqual([
      expect.objectContaining({ category: "Chargers", count: 1 }),
    ]);
  });

  it("claims in the period: count by action, gross cost, supplier recovery and net (USD and LBP); voided claims left out", () => {
    const charger = addProduct("Charger", "Chargers", 4);
    const earbuds = addProduct("Earbuds", "Audio", 6);
    const refund = claim(sell(earbuds, 1, TODAY), "REFUND"); // cost 6
    claim(sell(charger, 1, TODAY), "REPLACE"); // cost 4
    claim(sell(charger, 1, TODAY), "REPAIR"); // no cost until delivered
    const voided = claim(sell(charger, 1, TODAY), "REPLACE"); // voided below
    expect(
      getWarrantyService().voidClaim(
        { claim_id: voided.data.claim.id },
        ADMIN,
      ),
    ).toMatchObject({ success: true });

    // The refunded earbuds go back to the supplier, who credits $4 + 90,000 LBP.
    const item = db
      .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
      .get(refund.data.claim.id) as { id: number };
    const ret = getWarrantyService().createSupplierReturn(
      { defective_item_id: item.id },
      ADMIN,
    ) as { success: true; data: { id: number } };
    getWarrantyService().closeSupplierReturn(
      {
        supplier_return_id: ret.data.id,
        outcome: "CREDITED",
        credit_usd: 4,
        credit_lbp: 90000,
      },
      ADMIN,
    );

    const { claims } = getWarrantyService().report({
      from: TODAY,
      to: TODAY,
      client_day: TODAY,
    });
    expect(claims.byAction).toEqual({ REFUND: 1, REPLACE: 1, REPAIR: 1 });
    expect(claims.total).toBe(3);
    expect(claims.grossCostUsd).toBeCloseTo(10, 6);
    expect(claims.supplierRecoveredUsd).toBeCloseTo(4, 6);
    expect(claims.netCostUsd).toBeCloseTo(6, 6);
    expect(claims.grossCostLbp).toBeCloseTo(0, 6);
    expect(claims.supplierRecoveredLbp).toBeCloseTo(90000, 6);
    expect(claims.netCostLbp).toBeCloseTo(-90000, 6);

    // Same rows, same day bound as the Profits "Warranty cost" line.
    const profits = new ProfitRepository().getWarrantyTotals(
      `${TODAY} 00:00:00`,
      `${TODAY} 23:59:59`,
    );
    expect(claims.netCostUsd).toBeCloseTo(-profits.profit_usd, 6);
    expect(claims.netCostLbp).toBeCloseTo(-profits.profit_lbp, 6);
  });

  it("a period with no claims reports zeros", () => {
    const charger = addProduct("Charger", "Chargers", 4);
    claim(sell(charger, 1, TODAY), "REPLACE");
    const { claims } = getWarrantyService().report({
      from: "2020-01-01",
      to: "2020-01-31",
      client_day: TODAY,
    });
    expect(claims).toMatchObject({
      byAction: { REFUND: 0, REPLACE: 0, REPAIR: 0 },
      total: 0,
      grossCostUsd: 0,
      supplierRecoveredUsd: 0,
      netCostUsd: 0,
    });
  });
});
