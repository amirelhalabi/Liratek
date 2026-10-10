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
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
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
  resetSupplierRepository();
  resetWarrantyService();
}

function addProduct(
  name: string,
  stock: number,
  cost: number,
  supplierId: number | null = null,
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
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami Haddad', '71123456');
     INSERT INTO suppliers (id, tenant_id, name) VALUES (40, 1, 'Gadget Wholesale');`,
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

/**
 * LIRA-296 P3 (T049) — the same invariant through a supplier return: claim →
 * send to the supplier → close (CREDITED in USD and LBP / REPLACED /
 * REJECTED) → void the claim. The void is the reversal owner of everything
 * the close wrote (rule 20): the opposite supplier ADJUSTMENT, the negated
 * WARRANTY_COST rows (both currencies) and the restock batch.
 */
describe("LIRA-296 P3 — a supplier return, then voiding the claim, nets every ledger to zero", () => {
  function refundClaimSent(name: string) {
    const productId = addProduct(name, 5, 6, 40);
    const saleItemId = sellToClient(productId, 7);
    const created = getWarrantyService().createClaim(
      { sale_item_id: saleItemId, action: "REFUND", client_day: DAY },
      ADMIN,
    ) as { success: true; data: { claim: { id: number } } };
    expect(created.success).toBe(true);
    const claimId = created.data.claim.id;
    const item = db
      .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
      .get(claimId) as { id: number };
    const ret = getWarrantyService().createSupplierReturn(
      { defective_item_id: item.id },
      ADMIN,
    ) as { success: true; data: { id: number } };
    expect(ret.success).toBe(true);
    return { productId, claimId, returnId: ret.data.id };
  }

  it("REFUND and REPLACE claims × each outcome (CREDITED in USD + LBP, REPLACED, REJECTED): claim + return + close + void leaves every ledger exactly as after the sale", () => {
    for (const action of ["REFUND", "REPLACE"] as const)
    for (const outcome of ["CREDITED", "REPLACED", "REJECTED"] as const) {
      const productId = addProduct(`Charger ${action} ${outcome}`, 5, 6, 40);
      const saleItemId = sellToClient(productId, 7);
      const before = snapshot();

      const created = getWarrantyService().createClaim(
        { sale_item_id: saleItemId, action, client_day: DAY },
        ADMIN,
      ) as { success: true; data: { claim: { id: number } } };
      expect(created.success).toBe(true);
      const claimId = created.data.claim.id;
      const item = db
        .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
        .get(claimId) as { id: number };
      const ret = getWarrantyService().createSupplierReturn(
        { defective_item_id: item.id },
        ADMIN,
      ) as { success: true; data: { id: number } };
      const closed = getWarrantyService().closeSupplierReturn(
        {
          supplier_return_id: ret.data.id,
          outcome,
          ...(outcome === "CREDITED"
            ? { credit_usd: 5, credit_lbp: 45000 }
            : {}),
          ...(outcome === "REJECTED" ? { notes: "Not covered" } : {}),
        },
        ADMIN,
      );
      expect(closed).toMatchObject({ success: true });
      expect(snapshot()).not.toEqual(before);

      const voided = getWarrantyService().voidClaim(
        { claim_id: claimId },
        ADMIN,
      );
      expect({ action, outcome, voided }).toMatchObject({
        action,
        outcome,
        voided: { success: true },
      });
      expect({ action, outcome, after: snapshot() }).toEqual({
        action,
        outcome,
        after: before,
      });
    }
  });

  it("REPLACED: the void is refused once the restocked unit was sold again", () => {
    const { productId, claimId, returnId } = refundClaimSent("Speaker");
    getWarrantyService().closeSupplierReturn(
      { supplier_return_id: returnId, outcome: "REPLACED" },
      ADMIN,
    );
    // Sell everything left, so the restock batch is consumed.
    const stock = (
      db
        .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
        .get(productId) as { stock_quantity: number }
    ).stock_quantity;
    for (let i = 0; i < stock; i += 1) sellToClient(productId, 7);
    const beforeVoid = snapshot();
    expect(
      getWarrantyService().voidClaim({ claim_id: claimId }, ADMIN),
    ).toMatchObject({ success: false, code: "RESTOCK_ALREADY_SOLD" });
    // The refusal rolls back everything the void had started.
    expect(snapshot()).toEqual(beforeVoid);
  });
});

/**
 * LIRA-296 P3 — a REJECTED return puts the item back in the holding, where
 * the owner may then resolve it (Write off / Not faulty). Voiding the claim
 * after that must still be refused (DEFECTIVE_RESOLVED) and write nothing:
 * the void must not flip the resolved item back to HELD and then undo the
 * claim while the "Not faulty" restock stays on the shelf.
 */
describe("LIRA-296 P3 — a rejected return later resolved blocks the void", () => {
  for (const action of ["REFUND", "REPLACE"] as const)
    for (const outcome of ["NOT_FAULTY", "WRITE_OFF"] as const)
      it(`${action} claim → send → REJECTED → ${outcome} → void is refused and writes nothing`, () => {
        const productId = addProduct(`Hub ${action} ${outcome}`, 5, 6, 40);
        const saleItemId = sellToClient(productId, 7);
        const created = getWarrantyService().createClaim(
          { sale_item_id: saleItemId, action, client_day: DAY },
          ADMIN,
        ) as { success: true; data: { claim: { id: number } } };
        expect(created.success).toBe(true);
        const claimId = created.data.claim.id;
        const item = db
          .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
          .get(claimId) as { id: number };
        const ret = getWarrantyService().createSupplierReturn(
          { defective_item_id: item.id },
          ADMIN,
        ) as { success: true; data: { id: number } };
        expect(
          getWarrantyService().closeSupplierReturn(
            {
              supplier_return_id: ret.data.id,
              outcome: "REJECTED",
              notes: "Not covered",
            },
            ADMIN,
          ),
        ).toMatchObject({ success: true });
        expect(
          getWarrantyService().resolveDefective(
            { defective_item_id: item.id, outcome },
            ADMIN,
          ),
        ).toMatchObject({ success: true });

        const beforeVoid = snapshot();
        expect(
          getWarrantyService().voidClaim({ claim_id: claimId }, ADMIN),
        ).toMatchObject({ success: false, code: "DEFECTIVE_RESOLVED" });
        expect(snapshot()).toEqual(beforeVoid);
      });
});

describe("LIRA-296 P3 — a tracked unit through a supplier replacement and a void", () => {
  it("REFUND of a serial unit → send → REPLACED (unit back in stock) → void puts it back to sold-and-faulty", () => {
    const productId = addProduct("Tablet", 2, 100, 40);
    db.prepare(
      `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, ?, 'TAB-1', 'IN_STOCK'), (1, ?, 'TAB-2', 'IN_STOCK')`,
    ).run(productId, productId);
    const unitId = (
      db.prepare(`SELECT id FROM product_units WHERE imei = 'TAB-1'`).get() as {
        id: number;
      }
    ).id;
    const sale = new SalesRepository().processSale(
      {
        client_id: 7,
        items: [
          { product_id: productId, quantity: 1, price: 150, product_unit_id: unitId },
        ],
        total_amount: 150,
        discount: 0,
        final_amount: 150,
        payment_usd: 150,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
        exchange_rate: 89500,
        status: "completed",
        client_day: DAY,
      },
      1,
    );
    expect(sale.success).toBe(true);
    const saleItemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(sale.id) as {
        id: number;
      }
    ).id;
    const before = snapshot();

    const created = getWarrantyService().createClaim(
      { sale_item_id: saleItemId, unit_id: unitId, action: "REFUND", client_day: DAY },
      ADMIN,
    ) as { success: true; data: { claim: { id: number } } };
    expect(created).toMatchObject({ success: true });
    const item = db
      .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
      .get(created.data.claim.id) as { id: number };
    const ret = getWarrantyService().createSupplierReturn(
      { defective_item_id: item.id },
      ADMIN,
    ) as { success: true; data: { id: number } };
    expect(
      getWarrantyService().closeSupplierReturn(
        { supplier_return_id: ret.data.id, outcome: "REPLACED" },
        ADMIN,
      ),
    ).toMatchObject({ success: true });
    expect(
      (
        db.prepare(`SELECT status FROM product_units WHERE id = ?`).get(unitId) as {
          status: string;
        }
      ).status,
    ).toBe("IN_STOCK");

    expect(
      getWarrantyService().voidClaim({ claim_id: created.data.claim.id }, ADMIN),
    ).toMatchObject({ success: true });
    expect(snapshot()).toEqual(before);
  });
});
