/**
 * Owner decision 2026-10-30 — Settings → Categories & Suppliers → Delete must
 * leave the two supplier lists agreeing. A supplier with 0 products, settled
 * at $0, but with history (JEQANGJB-382: received $15, paid $15) is ARCHIVED
 * on the Suppliers page, history kept. One with no history at all is deleted
 * in both places. Products or an open balance still mean "merge" (LIRA-361).
 *
 * RULE 17 — written before the change.
 */
import type Database from "better-sqlite3";
import {
  getProductSupplierRepository,
  resetProductSupplierRepository,
} from "../ProductSupplierRepository.js";
import { resetSupplierRepository } from "../SupplierRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
} from "../testHelpers/warrantyDb.js";

function ledger(db: Database.Database, supplierId: number, usd: number) {
  db.prepare(
    `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, created_by, tenant_id)
     VALUES (?, ?, ?, 0, 1, 1)`,
  ).run(supplierId, usd > 0 ? "STOCK_INTAKE" : "PAYMENT", usd);
}

function supplierRow(db: Database.Database, id: number) {
  return db.prepare(`SELECT is_active FROM suppliers WHERE id = ?`).get(id) as
    | { is_active: number }
    | undefined;
}

function pickRow(db: Database.Database, id: number) {
  return db.prepare(`SELECT 1 FROM product_suppliers WHERE id = ?`).get(id);
}

describe("Settings supplier Delete keeps both lists agreeing", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = installWarrantyTestDb();
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetProductSupplierRepository();
  });

  afterEach(() => {
    uninstallWarrantyTestDb(db);
    resetSupplierRepository();
    resetProductSupplierRepository();
    resetTenantContext();
  });

  it("history, 0 products, settled at $0: archived on Suppliers, history kept", () => {
    const repo = getProductSupplierRepository();
    const jeq = repo.create("JEQANGJB-382");
    ledger(db, jeq.supplier_id, 15);
    ledger(db, jeq.supplier_id, -15);

    expect(repo.delete(jeq.id)).toBe(true);

    expect(pickRow(db, jeq.id)).toBeUndefined();
    expect(supplierRow(db, jeq.supplier_id)).toEqual({ is_active: 0 });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM supplier_ledger WHERE supplier_id = ?`,
        )
        .get(jeq.supplier_id),
    ).toEqual({ n: 2 });
  });

  it("typing the archived name again brings the same supplier back", () => {
    const repo = getProductSupplierRepository();
    const jeq = repo.create("JEQANGJB-382");
    ledger(db, jeq.supplier_id, 15);
    ledger(db, jeq.supplier_id, -15);
    repo.delete(jeq.id);

    const again = repo.create("JEQANGJB-382");

    expect(again.supplier_id).toBe(jeq.supplier_id);
    expect(supplierRow(db, jeq.supplier_id)).toEqual({ is_active: 1 });
  });

  it("no history at all: gone from both lists", () => {
    const repo = getProductSupplierRepository();
    const empty = repo.create("nobody");

    expect(repo.delete(empty.id)).toBe(true);

    expect(pickRow(db, empty.id)).toBeUndefined();
    expect(supplierRow(db, empty.supplier_id)).toBeUndefined();
  });

  it("an open balance is still refused (merge or settle first)", () => {
    const repo = getProductSupplierRepository();
    const owed = repo.create("owed");
    ledger(db, owed.supplier_id, 15);

    expect(() => repo.delete(owed.id)).toThrow();
    expect(supplierRow(db, owed.supplier_id)).toEqual({ is_active: 1 });
  });
});
