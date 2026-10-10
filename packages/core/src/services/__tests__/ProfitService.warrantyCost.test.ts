/**
 * LIRA-296 (T038, owner decision D1) — the cost of honouring warranties is
 * ONE "Warranty cost" line in Profits, summed from WARRANTY_COST rows:
 *   - By Module has a WARRANTY row equal to Σ WARRANTY_COST profit;
 *   - the Overview's gross profit includes it (and By Date / By Cashier
 *     agree, so the views reconcile);
 *   - its drill-down lists the claim's rows;
 *   - voiding the claim nets it back to nothing.
 * A warranty repair job is never Maintenance profit (`WARRANTY_JOB`).
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
import { ProfitRepository } from "../../repositories/ProfitRepository";
import { getWarrantyService, resetWarrantyService } from "../WarrantyService";
import { ProfitService } from "../ProfitService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const ADMIN = { userId: 1, role: "admin" };
const FROM = "2020-01-01";
const TO = "2099-12-31";
let db: Database.Database;
let profits: ProfitService;

function resetAll() {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetWarrantyRepository();
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
  profits = new ProfitService(new ProfitRepository());
});
afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function replaceClaim(): number {
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity, warranty_months)
       VALUES (1, 'Charger', 'Product', 6, 20, 5, 3)`,
      )
      .run().lastInsertRowid,
  );
  getStockBatchRepository().createBatch({
    product_id: productId,
    supplier_id: null,
    quantity: 5,
    unit_cost_usd: 6,
    books_debt: false,
    created_by: 1,
  });
  const sale = new SalesRepository().processSale(
    {
      client_id: null,
      items: [{ product_id: productId, quantity: 1, price: 20 }],
      total_amount: 20,
      discount: 0,
      final_amount: 20,
      payment_usd: 20,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
      exchange_rate: 89500,
      status: "completed",
    },
    1,
  );
  const saleItemId = (
    db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(sale.id) as {
      id: number;
    }
  ).id;
  const r = getWarrantyService().createClaim(
    {
      sale_item_id: saleItemId,
      action: "REPLACE",
      client_day: new Date().toISOString().slice(0, 10),
    },
    ADMIN,
  );
  expect(r.success).toBe(true);
  return (r as { data: { claim: { id: number } } }).data.claim.id;
}

const warrantyRow = () =>
  profits.getByModule(FROM, TO).find((m) => m.module === "WARRANTY");

describe("Warranty cost in Profits", () => {
  it("By Module shows ONE Warranty cost row equal to Σ WARRANTY_COST", () => {
    replaceClaim();
    expect(warrantyRow()).toMatchObject({
      module: "WARRANTY",
      label: "Warranty cost",
      revenue_usd: 0,
      cost_usd: 0,
      profit_usd: -6,
      profit_lbp: 0,
      count: 1,
    });
  });

  it("the Overview's gross profit includes it, and By Date / By Cashier agree", () => {
    const grossBefore = profits.getSummary(FROM, TO).totals.gross_profit_usd;
    // The sale itself adds 14 (20 − 6); the claim then costs 6.
    replaceClaim();
    const summary = profits.getSummary(FROM, TO);
    expect(summary.totals.gross_profit_usd - grossBefore).toBeCloseTo(
      14 - 6,
      6,
    );
    expect(summary.warranty).toMatchObject({ profit_usd: -6, count: 1 });
    const byDate = profits
      .getByDate(FROM, TO)
      .reduce((s, d) => s + d.profit_usd, 0);
    expect(byDate).toBeCloseTo(summary.totals.gross_profit_usd, 6);
    const byUser = profits
      .getByUser(FROM, TO)
      .reduce((s, u) => s + u.profit_usd, 0);
    expect(byUser).toBeCloseTo(summary.totals.gross_profit_usd, 6);
  });

  it("the drill-down lists the claim's rows", () => {
    replaceClaim();
    const detail = profits.getModuleDetail("WARRANTY", FROM, TO);
    expect(detail.module).toBe("WARRANTY");
    expect(detail.counted.map((r) => r.profit_usd)).toEqual([-6]);
    expect(detail.counted_total_profit_usd).toBeCloseTo(-6, 6);
  });

  it("voiding the claim nets the line to zero", () => {
    const claimId = replaceClaim();
    getWarrantyService().voidClaim({ claim_id: claimId }, ADMIN);
    const row = warrantyRow();
    expect(row?.profit_usd ?? 0).toBeCloseTo(0, 6);
    expect(row?.count ?? 0).toBe(0);
  });

  it("a warranty repair job is never counted as Maintenance (WARRANTY_JOB)", () => {
    const repairedJob = Number(
      db
        .prepare(
          `INSERT INTO maintenance (tenant_id, device_name, status) VALUES (1, 'Phone', 'Delivered_Paid')`,
        )
        .run().lastInsertRowid,
    );
    const claimId = Number(
      db
        .prepare(
          `INSERT INTO warranty_claims (tenant_id, maintenance_id, action, status, user_id) VALUES (1, ?, 'REPAIR', 'OPEN', 1)`,
        )
        .run(repairedJob).lastInsertRowid,
    );
    // Simulate a delivered job that somehow carries a MAINTENANCE charge.
    const jobId = Number(
      db
        .prepare(
          `INSERT INTO maintenance (tenant_id, device_name, final_amount_usd, cost_usd, status, warranty_claim_id) VALUES (1, 'X', 0, 5, 'Delivered', ?)`,
        )
        .run(claimId).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, profit_usd, summary) VALUES (1, 'MAINTENANCE', 'maintenance', ?, 1, 0, -5, 'x')`,
    ).run(jobId);
    expect(
      profits.getByModule(FROM, TO).find((m) => m.module === "MAINTENANCE"),
    ).toBeUndefined();
  });
});
