/**
 * LIRA-296 P3 (T049) — sending a defective item back to its supplier and
 * recording the outcome. Real schema (create_db.sql + migrations); nothing
 * mocked. Money assertions are deltas around the action (rule 15).
 *
 *   SENT      — the item leaves the holding (SENT_TO_SUPPLIER); no money.
 *   CREDITED  — the supplier balance goes DOWN by the credit (a paper
 *               ADJUSTMENT, no drawer) and a +credit WARRANTY_COST row
 *               lowers the shop's warranty cost, per currency.
 *   REPLACED  — one unit back in stock at its cost (a fresh batch from that
 *               supplier) and a +cost WARRANTY_COST row.
 *   REJECTED  — nothing moves; the item is back in the holding (HELD) so the
 *               owner can write it off or mark it not faulty.
 * The supplier defaults from the FIFO batch the sold unit came from.
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
import { getWarrantyService, resetWarrantyService } from "../WarrantyService";
import { snapshotLedgers } from "../../repositories/testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const ADMIN = { userId: 1, role: "admin" };
const STAFF = { userId: 2, role: "staff" };
const DAY = "2026-10-10";
let db: Database.Database;

type Envelope = {
  success: boolean;
  code?: string;
  error?: string;
  data?: Record<string, unknown> & { id?: number; status?: string };
};

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
    INSERT OR IGNORE INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (2, 1, 'cashier', '', 'staff', 1);
    INSERT INTO suppliers (id, tenant_id, name) VALUES (40, 1, 'Gadget Wholesale');
    INSERT INTO suppliers (id, tenant_id, name) VALUES (41, 1, 'Other Supplier');
  `);
});
afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function addProduct(
  name: string,
  stock: number,
  cost: number,
  supplierId: number | null,
): number {
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
    supplier_id: supplierId,
    quantity: stock,
    unit_cost_usd: cost,
    books_debt: false,
    created_by: 1,
  });
  return id;
}

function sell(productId: number): number {
  const result = new SalesRepository().processSale(
    {
      client_id: 7,
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

/** A REFUND claim → its defective item (HELD). */
function heldItem(productId: number): { claimId: number; itemId: number } {
  const saleItemId = sell(productId);
  const claim = getWarrantyService().createClaim(
    { sale_item_id: saleItemId, action: "REFUND", client_day: DAY },
    ADMIN,
  ) as { success: true; data: { claim: { id: number } } };
  expect(claim.success).toBe(true);
  const item = db
    .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
    .get(claim.data.claim.id) as { id: number };
  return { claimId: claim.data.claim.id, itemId: item.id };
}

const itemStatus = (id: number) =>
  (
    db.prepare(`SELECT status FROM defective_items WHERE id = ?`).get(id) as {
      status: string;
    }
  ).status;
const stockOf = (productId: number) =>
  (
    db
      .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
      .get(productId) as { stock_quantity: number }
  ).stock_quantity;
const costRows = (claimId: number) =>
  db
    .prepare(
      `SELECT profit_usd, profit_lbp, metadata_json FROM transactions
        WHERE type = 'WARRANTY_COST' AND source_id = ? ORDER BY id`,
    )
    .all(claimId) as {
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string;
  }[];

describe("createSupplierReturn", () => {
  it("defaults the supplier from the FIFO batch the sold unit came from and marks the item sent", () => {
    const productId = addProduct("Earbuds", 5, 6, 40);
    const { itemId } = heldItem(productId);
    const before = snapshotLedgers(db);

    const res = getWarrantyService().createSupplierReturn(
      { defective_item_id: itemId, notes: "Left bud dead" },
      ADMIN,
    ) as Envelope;
    expect(res).toMatchObject({
      success: true,
      data: { status: "SENT", supplier_id: 40, defective_item_id: itemId },
    });
    expect(itemStatus(itemId)).toBe("SENT_TO_SUPPLIER");
    // Sending moves no money.
    expect(snapshotLedgers(db)).toEqual(before);
  });

  it("takes an explicit supplier over the default", () => {
    const productId = addProduct("Earbuds", 5, 6, 40);
    const { itemId } = heldItem(productId);
    const res = getWarrantyService().createSupplierReturn(
      { defective_item_id: itemId, supplier_id: 41 },
      ADMIN,
    ) as Envelope;
    expect(res).toMatchObject({ success: true, data: { supplier_id: 41 } });
  });

  it("refuses with SUPPLIER_REQUIRED when no batch names a supplier and none is given", () => {
    const productId = addProduct("Earbuds", 5, 6, null);
    const { itemId } = heldItem(productId);
    const res = getWarrantyService().createSupplierReturn(
      { defective_item_id: itemId },
      ADMIN,
    );
    expect(res).toMatchObject({ success: false, code: "SUPPLIER_REQUIRED" });
    expect(itemStatus(itemId)).toBe("HELD");
  });

  it("is admin-only and only for an item still held", () => {
    const productId = addProduct("Earbuds", 5, 6, 40);
    const { itemId } = heldItem(productId);
    expect(
      getWarrantyService().createSupplierReturn(
        { defective_item_id: itemId },
        STAFF,
      ),
    ).toMatchObject({ success: false, code: "FORBIDDEN_ACTION" });
    getWarrantyService().createSupplierReturn(
      { defective_item_id: itemId },
      ADMIN,
    );
    expect(
      getWarrantyService().createSupplierReturn(
        { defective_item_id: itemId },
        ADMIN,
      ),
    ).toMatchObject({ success: false, code: "NOT_HELD" });
  });
});

describe("closeSupplierReturn", () => {
  function sent(cost = 6) {
    const productId = addProduct("Earbuds", 5, cost, 40);
    const held = heldItem(productId);
    const ret = getWarrantyService().createSupplierReturn(
      { defective_item_id: held.itemId },
      ADMIN,
    ) as Envelope;
    return { productId, ...held, returnId: ret.data!.id as number };
  }

  it("CREDITED: the supplier balance goes down by the credit in each currency; a +credit warranty-cost row; no drawer moves", () => {
    const { claimId, itemId, returnId } = sent();
    const before = snapshotLedgers(db);

    const res = getWarrantyService().closeSupplierReturn(
      {
        supplier_return_id: returnId,
        outcome: "CREDITED",
        credit_usd: 4,
        credit_lbp: 90000,
      },
      ADMIN,
    ) as Envelope;
    expect(res).toMatchObject({
      success: true,
      data: { status: "CREDITED", credit_usd: 4, credit_lbp: 90000 },
    });
    const after = snapshotLedgers(db);
    expect(after.drawers).toEqual(before.drawers);
    const bal = (snap: typeof before, ccy: "USD" | "LBP") =>
      snap.supplier[`40|${ccy}`] ?? 0;
    expect(bal(after, "USD") - bal(before, "USD")).toBeCloseTo(-4, 6);
    expect(bal(after, "LBP") - bal(before, "LBP")).toBeCloseTo(-90000, 6);

    const rows = costRows(claimId);
    const credit = rows[rows.length - 1]!;
    expect(credit.profit_usd).toBeCloseTo(4, 6);
    expect(credit.profit_lbp).toBeCloseTo(90000, 6);
    expect(JSON.parse(credit.metadata_json)).toMatchObject({
      kind: "SUPPLIER_CREDIT",
      supplier_return_id: returnId,
      is_auto: true,
    });
    // The supplier keeps the item.
    expect(itemStatus(itemId)).toBe("SENT_TO_SUPPLIER");
  });

  it("CREDITED needs a credit amount", () => {
    const { returnId } = sent();
    expect(
      getWarrantyService().closeSupplierReturn(
        { supplier_return_id: returnId, outcome: "CREDITED" },
        ADMIN,
      ),
    ).toMatchObject({ success: false, code: "INVALID" });
  });

  it("REPLACED: one unit back in stock at its cost and a +cost warranty-cost row", () => {
    const { productId, claimId, itemId, returnId } = sent(6);
    const stockBefore = stockOf(productId);
    const before = snapshotLedgers(db);

    const res = getWarrantyService().closeSupplierReturn(
      { supplier_return_id: returnId, outcome: "REPLACED" },
      ADMIN,
    ) as Envelope;
    expect(res).toMatchObject({ success: true, data: { status: "REPLACED" } });
    expect(stockOf(productId)).toBe(stockBefore + 1);
    expect(snapshotLedgers(db)).toEqual(before);
    const batch = db
      .prepare(
        `SELECT supplier_id, quantity_remaining, unit_cost_usd FROM product_stock_batches
          WHERE id = (SELECT restock_batch_id FROM supplier_returns WHERE id = ?)`,
      )
      .get(returnId);
    expect(batch).toEqual({
      supplier_id: 40,
      quantity_remaining: 1,
      unit_cost_usd: 6,
    });
    const rows = costRows(claimId);
    expect(rows[rows.length - 1]!.profit_usd).toBeCloseTo(6, 6);
    expect(JSON.parse(rows[rows.length - 1]!.metadata_json)).toMatchObject({
      kind: "SUPPLIER_REPLACED",
    });
    expect(itemStatus(itemId)).toBe("RETURNED_TO_STOCK");
  });

  it("REJECTED: needs a note, moves nothing, and puts the item back in the holding", () => {
    const { claimId, itemId, returnId } = sent();
    expect(
      getWarrantyService().closeSupplierReturn(
        { supplier_return_id: returnId, outcome: "REJECTED" },
        ADMIN,
      ),
    ).toMatchObject({ success: false, code: "INVALID" });

    const before = snapshotLedgers(db);
    const rowsBefore = costRows(claimId).length;
    const res = getWarrantyService().closeSupplierReturn(
      {
        supplier_return_id: returnId,
        outcome: "REJECTED",
        notes: "Water damage, not covered",
      },
      ADMIN,
    ) as Envelope;
    expect(res).toMatchObject({ success: true, data: { status: "REJECTED" } });
    expect(snapshotLedgers(db)).toEqual(before);
    expect(costRows(claimId)).toHaveLength(rowsBefore);
    expect(itemStatus(itemId)).toBe("HELD");
  });

  it("a closed return can't be closed again; admin only", () => {
    const { returnId } = sent();
    expect(
      getWarrantyService().closeSupplierReturn(
        { supplier_return_id: returnId, outcome: "REPLACED" },
        STAFF,
      ),
    ).toMatchObject({ success: false, code: "FORBIDDEN_ACTION" });
    getWarrantyService().closeSupplierReturn(
      { supplier_return_id: returnId, outcome: "REPLACED" },
      ADMIN,
    );
    expect(
      getWarrantyService().closeSupplierReturn(
        { supplier_return_id: returnId, outcome: "REPLACED" },
        ADMIN,
      ),
    ).toMatchObject({ success: false, code: "RETURN_NOT_OPEN" });
  });

  it("voiding the claim while its return is still SENT is refused", () => {
    const { claimId } = sent();
    expect(
      getWarrantyService().voidClaim({ claim_id: claimId }, ADMIN),
    ).toMatchObject({ success: false, code: "DEFECTIVE_ALREADY_SENT" });
  });

  it("listSupplierReturns shows the return with its supplier and product", () => {
    const { returnId } = sent();
    const list = getWarrantyService().listSupplierReturns({});
    expect(list.find((r) => r.id === returnId)).toMatchObject({
      supplier_name: "Gadget Wholesale",
      product_name: "Earbuds",
      status: "SENT",
    });
  });
});
