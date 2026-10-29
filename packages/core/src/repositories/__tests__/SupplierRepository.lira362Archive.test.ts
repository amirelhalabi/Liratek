/**
 * LIRA-362 — archive a settled supplier from the Suppliers page.
 *
 * Owner decisions (2026-10-30): only a supplier settled at $0 USD and 0 LBP
 * can be archived (debt can never be hidden); archived suppliers leave the
 * list but keep their history; typing an archived supplier's name again
 * (receiving stock, Settings → Suppliers) brings the SAME supplier back
 * instead of booking onto a hidden one or creating a duplicate.
 *
 * RULE 17 — written before `archiveSupplier`/`unarchiveSupplier` existed.
 */
import type Database from "better-sqlite3";
import { ProductRepository } from "../ProductRepository.js";
import {
  getProductSupplierRepository,
  resetProductSupplierRepository,
} from "../ProductSupplierRepository.js";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository.js";
import { resetStockBatchRepository } from "../StockBatchRepository.js";
import { resetStockAdjustmentRepository } from "../StockAdjustmentRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import {
  addProduct,
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
} from "../testHelpers/warrantyDb.js";

function resetAll(): void {
  resetSupplierRepository();
  resetStockBatchRepository();
  resetProductSupplierRepository();
  resetStockAdjustmentRepository();
  resetTransactionRepository();
}

function isActive(db: Database.Database, supplierId: number): number {
  return (
    db
      .prepare(`SELECT is_active FROM suppliers WHERE id = ?`)
      .get(supplierId) as { is_active: number }
  ).is_active;
}

/** The mistyped keyboard case: $15 owed, then $15 paid → Settled. */
function settleWithPayment(db: Database.Database, supplierId: number): void {
  getSupplierRepository().recordDebt({
    supplier_id: supplierId,
    amount_usd: 15,
    amount_lbp: 0,
    created_by: 1,
  });
  db.prepare(
    `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, created_by, tenant_id)
     VALUES (?, 'PAYMENT', -15, 0, 1, 1)`,
  ).run(supplierId);
}

describe("SupplierRepository — archive a settled supplier (LIRA-362)", () => {
  let db: Database.Database;
  let typo: { id: number; supplier_id: number };

  beforeEach(() => {
    db = installWarrantyTestDb();
    initFixedTenantContext(1);
    resetAll();
    typo = getProductSupplierRepository().create("JEQANGJB-382");
  });

  afterEach(() => {
    uninstallWarrantyTestDb(db);
    resetAll();
    resetTenantContext();
  });

  it("archives a settled supplier: gone from the lists, history kept", () => {
    settleWithPayment(db, typo.supplier_id);
    const repo = getSupplierRepository();

    repo.archiveSupplier(typo.supplier_id);

    expect(isActive(db, typo.supplier_id)).toBe(0);
    expect(repo.listSuppliers().map((s) => s.id)).not.toContain(
      typo.supplier_id,
    );
    expect(
      repo.getProductSupplierBalances().map((b) => b.supplier_id),
    ).not.toContain(typo.supplier_id);
    // Still reachable for "Show archived", with its whole history.
    expect(
      repo.listSuppliers(undefined, true).map((s) => s.id),
    ).toContain(typo.supplier_id);
    expect(repo.getSupplierLedger(typo.supplier_id)).toHaveLength(2);
  });

  it("refuses while anything is owed in USD", () => {
    getSupplierRepository().recordDebt({
      supplier_id: typo.supplier_id,
      amount_usd: 15,
      amount_lbp: 0,
      created_by: 1,
    });
    expect(() =>
      getSupplierRepository().archiveSupplier(typo.supplier_id),
    ).toThrow(/settle/i);
    expect(isActive(db, typo.supplier_id)).toBe(1);
  });

  it("refuses while anything is owed in LBP", () => {
    getSupplierRepository().recordDebt({
      supplier_id: typo.supplier_id,
      amount_usd: 0,
      amount_lbp: 450000,
      created_by: 1,
    });
    expect(() =>
      getSupplierRepository().archiveSupplier(typo.supplier_id),
    ).toThrow(/settle/i);
    expect(isActive(db, typo.supplier_id)).toBe(1);
  });

  it("refuses a system supplier", () => {
    const omt = db
      .prepare(
        `SELECT id FROM suppliers WHERE is_system = 1 AND tenant_id = 1 LIMIT 1`,
      )
      .get() as { id: number } | undefined;
    if (!omt) {
      db.prepare(
        `INSERT INTO suppliers (name, is_active, is_system, provider, tenant_id) VALUES ('OMT', 1, 1, 'OMT', 1)`,
      ).run();
    }
    const id = (
      db
        .prepare(
          `SELECT id FROM suppliers WHERE is_system = 1 AND tenant_id = 1 LIMIT 1`,
        )
        .get() as { id: number }
    ).id;
    expect(() => getSupplierRepository().archiveSupplier(id)).toThrow(
      /system/i,
    );
    expect(isActive(db, id)).toBe(1);
  });

  it("refuses a supplier that is part of an account", () => {
    const parent = getProductSupplierRepository().create("Parent Co");
    db.prepare(
      `UPDATE suppliers SET account_supplier_id = ? WHERE id = ?`,
    ).run(parent.supplier_id, typo.supplier_id);
    expect(() =>
      getSupplierRepository().archiveSupplier(typo.supplier_id),
    ).toThrow(/account/i);
    expect(() =>
      getSupplierRepository().archiveSupplier(parent.supplier_id),
    ).toThrow(/account/i);
  });

  it("unarchive brings it back to the list", () => {
    settleWithPayment(db, typo.supplier_id);
    const repo = getSupplierRepository();
    repo.archiveSupplier(typo.supplier_id);

    repo.unarchiveSupplier(typo.supplier_id);

    expect(isActive(db, typo.supplier_id)).toBe(1);
    expect(repo.listSuppliers().map((s) => s.id)).toContain(typo.supplier_id);
  });

  it("receiving stock under an archived name revives the same supplier — the debt never lands on a hidden one", () => {
    settleWithPayment(db, typo.supplier_id);
    getSupplierRepository().archiveSupplier(typo.supplier_id);
    addProduct(db, { id: 201, name: "Keyboard", stock: 0, cost: 0 });

    new ProductRepository().receiveStock({
      product_id: 201,
      quantity: 1,
      unit_cost_usd: 15,
      supplier: "jeqangjb-382",
      is_old_stock: false,
      created_by: 1,
    });

    expect(isActive(db, typo.supplier_id)).toBe(1);
    const named = db
      .prepare(
        `SELECT COUNT(*) AS n FROM suppliers WHERE name = 'JEQANGJB-382' COLLATE NOCASE AND tenant_id = 1`,
      )
      .get() as { n: number };
    expect(named.n).toBe(1);
  });

  it("re-adding the name in Settings after its label was deleted revives the same supplier", () => {
    settleWithPayment(db, typo.supplier_id);
    getSupplierRepository().archiveSupplier(typo.supplier_id);
    // Corner Tech's case: the Settings label is already gone.
    db.prepare(`DELETE FROM product_suppliers WHERE id = ?`).run(typo.id);

    const again = getProductSupplierRepository().create("JEQANGJB-382");

    expect(again.supplier_id).toBe(typo.supplier_id);
    expect(isActive(db, typo.supplier_id)).toBe(1);
  });
});
