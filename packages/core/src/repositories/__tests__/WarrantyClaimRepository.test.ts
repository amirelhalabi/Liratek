/**
 * LIRA-296 (T034) — the claims and defective-items repositories (SQL only,
 * tenant-scoped): create, read by line/job/unit, status updates, the
 * open-claim lookup behind "one open claim per unit", and FIFO consumption
 * owned by a claim (a replacement unit) with its exact restore.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { WarrantyClaimRepository } from "../WarrantyClaimRepository";
import { DefectiveItemRepository } from "../DefectiveItemRepository";
import { StockBatchRepository } from "../StockBatchRepository";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
  addProduct,
  addSale,
  addLine,
  addUnit,
} from "../testHelpers/warrantyDb";

let db: Database.Database;
const claims = new WarrantyClaimRepository();
const defective = new DefectiveItemRepository();

beforeEach(() => {
  db = installWarrantyTestDb();
  addProduct(db, { id: 10, name: "Earbuds", stock: 4 });
  addSale(db, { id: 100 });
  addLine(db, { id: 1000, saleId: 100, productId: 10, quantity: 2 });
  addUnit(db, { id: 5, productId: 10, imei: "SN-5", saleItemId: 1000 });
});
afterEach(() => uninstallWarrantyTestDb(db));

describe("WarrantyClaimRepository", () => {
  it("creates a claim and reads it back by line and by unit", () => {
    const id = claims.insertClaim({
      saleItemId: 1000,
      maintenanceId: null,
      unitId: 5,
      action: "REPAIR",
      status: "OPEN",
      overrideReason: null,
      notes: "crackling",
      userId: 1,
    });
    const claim = claims.findById(id)!;
    expect(claim).toMatchObject({
      sale_item_id: 1000,
      unit_id: 5,
      action: "REPAIR",
      status: "OPEN",
      notes: "crackling",
      user_id: 1,
      quantity: 1,
    });
    expect(claims.listFor({ saleItemId: 1000 }).map((c) => c.id)).toEqual([id]);
    expect(claims.listFor({ unitId: 5 }).map((c) => c.id)).toEqual([id]);
    expect(claims.findOpenForUnit(5)?.id).toBe(id);
  });

  it("counts live claims on a line (OPEN and DONE, never VOIDED), excluding REFUND claims", () => {
    const a = claims.insertClaim({
      saleItemId: 1000,
      maintenanceId: null,
      unitId: null,
      action: "REPLACE",
      status: "DONE",
      overrideReason: null,
      notes: null,
      userId: 1,
    });
    claims.insertClaim({
      saleItemId: 1000,
      maintenanceId: null,
      unitId: null,
      action: "REFUND",
      status: "DONE",
      overrideReason: null,
      notes: null,
      userId: 1,
    });
    expect(claims.countLiveNonRefundForLine(1000)).toBe(1);
    claims.markVoided(a);
    expect(claims.countLiveNonRefundForLine(1000)).toBe(0);
    expect(claims.findById(a)?.status).toBe("VOIDED");
    expect(claims.findById(a)?.voided_at).toBeTruthy();
  });

  it("sets the job / replacement / refund links and the status", () => {
    const id = claims.insertClaim({
      saleItemId: 1000,
      maintenanceId: null,
      unitId: null,
      action: "REPAIR",
      status: "OPEN",
      overrideReason: null,
      notes: null,
      userId: 1,
    });
    claims.setLinks(id, {
      repairJobId: null,
      replacementUnitId: null,
      refundTransactionId: null,
    });
    claims.setStatus(id, "DONE");
    expect(claims.findById(id)?.status).toBe("DONE");
  });

  it("is tenant-scoped", () => {
    const id = claims.insertClaim({
      saleItemId: 1000,
      maintenanceId: null,
      unitId: 5,
      action: "REPAIR",
      status: "OPEN",
      overrideReason: null,
      notes: null,
      userId: 1,
    });
    expect(runWithTenant(2, () => claims.findById(id))).toBeNull();
    expect(runWithTenant(2, () => claims.findOpenForUnit(5))).toBeNull();
  });
});

describe("DefectiveItemRepository", () => {
  it("creates a HELD row, lists by status, updates status and deletes", () => {
    const claimId = claims.insertClaim({
      saleItemId: 1000,
      maintenanceId: null,
      unitId: 5,
      action: "REFUND",
      status: "DONE",
      overrideReason: null,
      notes: null,
      userId: 1,
    });
    const id = defective.insertItem({
      productId: 10,
      unitId: 5,
      quantity: 1,
      unitCostUsd: 6.5,
      warrantyClaimId: claimId,
    });
    expect(defective.findById(id)).toMatchObject({
      status: "HELD",
      unit_cost_usd: 6.5,
      warranty_claim_id: claimId,
    });
    expect(defective.findByClaim(claimId)?.id).toBe(id);
    expect(defective.list("HELD").map((d) => d.id)).toEqual([id]);
    defective.setStatus(id, "WRITTEN_OFF", null);
    expect(defective.findById(id)?.status).toBe("WRITTEN_OFF");
    expect(defective.findById(id)?.resolved_at).toBeTruthy();
    expect(defective.list("HELD")).toEqual([]);
    defective.delete(id);
    expect(defective.findById(id)).toBeNull();
  });
});

describe("StockBatchRepository — a warranty claim owns a consumption", () => {
  it("consumes FIFO under the claim and restores exactly that", () => {
    const batches = new StockBatchRepository();
    const batchId = batches.createBatch({
      product_id: 10,
      supplier_id: null,
      quantity: 4,
      unit_cost_usd: 6,
      books_debt: false,
      created_by: 1,
    });
    const claimId = claims.insertClaim({
      saleItemId: 1000,
      maintenanceId: null,
      unitId: null,
      action: "REPLACE",
      status: "DONE",
      overrideReason: null,
      notes: null,
      userId: 1,
    });
    const res = batches.consume(10, 1, {
      warrantyClaimId: claimId,
      reason: "ADJUSTMENT",
      fallbackUnitCostUsd: 9,
    });
    expect(res.totalCostUsd).toBe(6);
    const owned = db
      .prepare(
        `SELECT COUNT(*) AS n FROM stock_batch_consumptions WHERE warranty_claim_id = ?`,
      )
      .get(claimId) as { n: number };
    expect(owned.n).toBe(1);
    batches.restoreForWarrantyClaim(claimId);
    expect(
      (
        db
          .prepare(
            `SELECT quantity_remaining AS q FROM product_stock_batches WHERE id = ?`,
          )
          .get(batchId) as { q: number }
      ).q,
    ).toBe(4);
  });
});
