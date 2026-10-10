/**
 * LIRA-296 (T033) — `refundSaleItem({ restock: false })`: a warranty REFUND
 * claim refunds the line's money exactly like today, but the faulty unit goes
 * to the defective holding, never back on the shelf:
 *   - stock_quantity and FIFO batch cover do NOT move;
 *   - a tracked unit stays out of IN_STOCK (SOLD), flagged is_defective;
 *   - the REFUND row records restock:false and its claim.
 * The default (no option) is unchanged. A claim's refund can only be undone
 * by voiding the claim (the generic "Undo refund" refuses it), and the
 * claim's own undo does not take stock that was never given back.
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
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import {
  snapshotLedgers,
  snapshotStockAndProfit,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
let db: Database.Database;
let repo: SalesRepository;

function resetAll() {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
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
  repo = new SalesRepository();
});
afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function product(
  stock: number,
  withUnit = false,
): { productId: number; unitId?: number } {
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, 'Item', 'Product', 6, 20, ?)`,
      )
      .run(stock).lastInsertRowid,
  );
  getStockBatchRepository().createBatch({
    product_id: productId,
    supplier_id: null,
    quantity: stock,
    unit_cost_usd: 6,
    books_debt: false,
    created_by: 1,
  });
  if (!withUnit) return { productId };
  const unitId = Number(
    db
      .prepare(
        `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, ?, 'SN-1', 'IN_STOCK')`,
      )
      .run(productId).lastInsertRowid,
  );
  return { productId, unitId };
}

function sell(
  productId: number,
  unitId?: number,
): { saleId: number; saleItemId: number } {
  const r = repo.processSale(
    {
      client_id: null,
      items: [
        {
          product_id: productId,
          quantity: 1,
          price: 20,
          ...(unitId ? { product_unit_id: unitId } : {}),
        },
      ],
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
  expect(r.success).toBe(true);
  const saleItemId = (
    db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(r.id) as {
      id: number;
    }
  ).id;
  return { saleId: r.id!, saleItemId };
}

const unitRow = (id: number) =>
  db
    .prepare(`SELECT status, is_defective FROM product_units WHERE id = ?`)
    .get(id);

describe("refundSaleItem({ restock: false })", () => {
  it("refunds the money but never restocks; the unit stays out, flagged defective", () => {
    const { productId, unitId } = product(3, true);
    const { saleId, saleItemId } = sell(productId, unitId);
    const stockBefore = snapshotStockAndProfit(db);
    const drawersBefore = snapshotLedgers(db).drawers["General|USD"] ?? 0;

    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId,
      refundQuantity: 1,
      userId: 1,
      restock: false,
      warrantyClaimId: 42,
    });

    const after = snapshotStockAndProfit(db);
    expect(after.stock).toEqual(stockBefore.stock);
    expect(after.batches).toEqual(stockBefore.batches);
    expect(unitRow(unitId!)).toEqual({ status: "SOLD", is_defective: 1 });
    expect(
      (snapshotLedgers(db).drawers["General|USD"] ?? 0) - drawersBefore,
    ).toBeCloseTo(-20, 6);
    expect(
      (
        db
          .prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`)
          .get(saleItemId) as { refunded_quantity: number }
      ).refunded_quantity,
    ).toBe(1);
    const meta = JSON.parse(
      (
        db
          .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
          .get(refundId) as { metadata_json: string }
      ).metadata_json,
    );
    expect(meta).toMatchObject({ restock: false, warrantyClaimId: 42 });
  });

  it("the default still restocks (unchanged)", () => {
    const { productId } = product(3);
    const { saleId, saleItemId } = sell(productId);
    repo.refundSaleItem({ saleId, saleItemId, refundQuantity: 1, userId: 1 });
    expect(
      (
        db
          .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
          .get(productId) as { stock_quantity: number }
      ).stock_quantity,
    ).toBe(3);
  });

  it("the generic Undo refund refuses a warranty claim's refund", () => {
    const { productId } = product(3);
    const { saleId, saleItemId } = sell(productId);
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId,
      refundQuantity: 1,
      userId: 1,
      restock: false,
      warrantyClaimId: 42,
    });
    expect(() =>
      repo.undoSaleItemRefund({ refundTransactionId: refundId, userId: 1 }),
    ).toThrow(/warranty claim/i);
  });

  it("the claim's own undo nets everything back without touching stock", () => {
    const { productId, unitId } = product(3, true);
    const { saleId, saleItemId } = sell(productId, unitId);
    const before = {
      ledgers: snapshotLedgers(db),
      stock: snapshotStockAndProfit(db),
    };
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId,
      refundQuantity: 1,
      userId: 1,
      restock: false,
      warrantyClaimId: 42,
    });
    repo.undoSaleItemRefund({
      refundTransactionId: refundId,
      userId: 1,
      fromWarrantyClaim: true,
    });
    expect({
      ledgers: snapshotLedgers(db),
      stock: snapshotStockAndProfit(db),
    }).toEqual(before);
  });
});
