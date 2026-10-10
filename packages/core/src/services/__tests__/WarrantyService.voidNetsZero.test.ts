/**
 * LIRA-296 (T032, rule 20) — voiding a warranty claim reverses EVERYTHING the
 * claim moved. For each action (REFUND, REPLACE, REPAIR) a create-then-void
 * must leave, per currency:
 *   - every money ledger (drawers, client debt, supplier, partner) —
 *     `snapshotLedgers`;
 *   - stock, FIFO batch cover, unit state, the defective-items holding, the
 *     live-claim count and the Σ profit stamp — `snapshotStockAndProfit`;
 * exactly as they were. The claim itself must move something first (the
 * test also checks the "after create" snapshot differs), so a no-op claim
 * cannot pass vacuously.
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
 * Written failing-first, before any claim code existed (rule 17).
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
import { MaintenanceService } from "../MaintenanceService";
import { getWarrantyService, resetWarrantyService } from "../WarrantyService";
import {
  snapshotLedgers,
  snapshotStockAndProfit,
} from "../../repositories/testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const ADMIN = { userId: 1, role: "admin" };
const DAY = "2026-10-10";

let db: Database.Database;

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetWarrantyRepository();
  resetWarrantyService();
}

function addProduct(name: string, stock: number, cost: number): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, warranty_months)
         VALUES (1, ?, 'Product', 'Accessories', ?, 20, ?, 3)`,
      )
      .run(name, cost, stock).lastInsertRowid,
  );
  getStockBatchRepository().createBatch({
    product_id: id,
    supplier_id: null,
    quantity: stock,
    unit_cost_usd: cost,
    books_debt: false,
    created_by: 1,
  });
  return id;
}

function sellToClient(productId: number, clientId: number): number {
  const result = new SalesRepository().processSale(
    {
      client_id: clientId,
      items: [{ product_id: productId, quantity: 1, price: 20 }],
      total_amount: 20,
      discount: 0,
      final_amount: 20,
      payment_usd: 20,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
      exchange_rate: 89500,
      status: "completed",
      client_day: DAY,
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

const snapshot = () => ({
  ledgers: snapshotLedgers(db),
  stock: snapshotStockAndProfit(db),
});

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
  db.exec(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami Haddad', '71123456')`,
  );
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

describe("LIRA-296 — voiding a claim nets every ledger to zero", () => {
  it("REFUND: create moves money/profit/defective holding; void restores all", () => {
    const productId = addProduct("Earbuds", 5, 6);
    const saleItemId = sellToClient(productId, 7);
    const before = snapshot();

    const created = getWarrantyService().createClaim(
      { sale_item_id: saleItemId, action: "REFUND", client_day: DAY },
      ADMIN,
    );
    expect(created).toMatchObject({ success: true });
    const during = snapshot();
    expect(during).not.toEqual(before);
    // A refund claim never restocks.
    expect(during.stock.stock[String(productId)]).toBe(
      before.stock.stock[String(productId)],
    );

    const voided = getWarrantyService().voidClaim(
      {
        claim_id: (created as { data: { claim: { id: number } } }).data.claim
          .id,
      },
      ADMIN,
    );
    expect(voided).toMatchObject({ success: true });
    expect(snapshot()).toEqual(before);
  });

  it("REPLACE: create takes one unit from stock; void puts it back", () => {
    const productId = addProduct("Charger", 5, 6);
    const saleItemId = sellToClient(productId, 7);
    const before = snapshot();

    const created = getWarrantyService().createClaim(
      { sale_item_id: saleItemId, action: "REPLACE", client_day: DAY },
      ADMIN,
    );
    expect(created).toMatchObject({ success: true });
    const during = snapshot();
    expect(during.stock.stock[String(productId)]).toBe(
      before.stock.stock[String(productId)]! - 1,
    );

    const voided = getWarrantyService().voidClaim(
      {
        claim_id: (created as { data: { claim: { id: number } } }).data.claim
          .id,
      },
      ADMIN,
    );
    expect(voided).toMatchObject({ success: true });
    expect(snapshot()).toEqual(before);
  });

  it("REPAIR: the job's parts cost is booked at delivery; void restores parts and cost", () => {
    const productId = addProduct("Speaker", 5, 6);
    const partId = addProduct("Speaker driver", 4, 3);
    const saleItemId = sellToClient(productId, 7);
    const before = snapshot();

    const created = getWarrantyService().createClaim(
      { sale_item_id: saleItemId, action: "REPAIR", client_day: DAY },
      ADMIN,
    );
    expect(created).toMatchObject({ success: true });
    const jobId = (created as { data: { repairJobId: number } }).data
      .repairJobId;
    expect(jobId).toBeTruthy();

    // Deliver the warranty job with one part (no charge to the customer).
    const delivered = new MaintenanceService().saveJob(
      {
        id: jobId,
        device_name: "Speaker",
        status: "Delivered",
        parts: [{ product_id: partId, quantity: 1 }],
      },
      1,
    );
    expect(delivered.success).toBe(true);
    const during = snapshot();
    expect(during.stock.stock[String(partId)]).toBe(
      before.stock.stock[String(partId)]! - 1,
    );
    expect(during.stock.profit.usd).toBeCloseTo(before.stock.profit.usd - 3, 6);

    const voided = getWarrantyService().voidClaim(
      {
        claim_id: (created as { data: { claim: { id: number } } }).data.claim
          .id,
      },
      ADMIN,
    );
    expect(voided).toMatchObject({ success: true });
    expect(snapshot()).toEqual(before);
  });
});
