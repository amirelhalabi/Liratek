/**
 * LIRA-361 — merge a mistyped duplicate supplier ("reacall") into the real
 * one ("recall"). Everything moves: product labels, stock batches and every
 * supplier_ledger row (debt, payments), so the target's balance becomes
 * the sum of both, per currency. A plain delete of a supplier that still has
 * products or ledger history is refused (it used to orphan the debt).
 *
 * RULE 17 — written before `merge`/`getDeleteImpact` existed.
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
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
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

function balance(supplierId: number): { usd: number; lbp: number } {
  const row = getSupplierRepository()
    .getProductSupplierBalances()
    .find((r) => r.supplier_id === supplierId);
  return { usd: row?.total_usd ?? 0, lbp: row?.total_lbp ?? 0 };
}

describe("ProductSupplierRepository — merge duplicate suppliers (LIRA-361)", () => {
  let db: Database.Database;
  let productRepo: ProductRepository;
  let source: { id: number; supplier_id: number };
  let target: { id: number; supplier_id: number };
  let sourceIntakeTxn: number;

  beforeEach(() => {
    db = installWarrantyTestDb();
    initFixedTenantContext(1);
    resetAll();
    productRepo = new ProductRepository();
    const psRepo = getProductSupplierRepository();
    target = psRepo.create("recall");
    source = psRepo.create("reacall");

    addProduct(db, { id: 101, name: "Cable", stock: 0, cost: 0 });
    addProduct(db, { id: 102, name: "Old charger", stock: 0, cost: 0 });
    addProduct(db, { id: 103, name: "Earbuds", stock: 0, cost: 0 });
    db.exec(
      `UPDATE products SET supplier = 'reacall' WHERE id IN (101, 102);
       UPDATE products SET supplier = 'recall' WHERE id = 103;`,
    );

    // reacall: new stock books $50 debt; old stock books nothing.
    productRepo.receiveStock({
      product_id: 101,
      quantity: 10,
      unit_cost_usd: 5,
      supplier: "reacall",
      is_old_stock: false,
      created_by: 1,
    });
    productRepo.receiveStock({
      product_id: 102,
      quantity: 4,
      unit_cost_usd: 3,
      supplier: "reacall",
      is_old_stock: true,
      created_by: 1,
    });
    // reacall also has an LBP debt recorded without products.
    getSupplierRepository().recordDebt({
      supplier_id: source.supplier_id,
      amount_usd: 0,
      amount_lbp: 900000,
      created_by: 1,
    });
    // recall already owes $20.
    productRepo.receiveStock({
      product_id: 103,
      quantity: 2,
      unit_cost_usd: 10,
      supplier: "recall",
      is_old_stock: false,
      created_by: 1,
    });

    sourceIntakeTxn = (
      db
        .prepare(
          `SELECT transaction_id FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'STOCK_INTAKE'`,
        )
        .get(source.supplier_id) as { transaction_id: number }
    ).transaction_id;
  });

  afterEach(() => {
    uninstallWarrantyTestDb(db);
    resetAll();
    resetTenantContext();
  });

  it("impact names the products and debt that would move", () => {
    const impact = getProductSupplierRepository().getDeleteImpact(source.id);
    expect(impact.product_count).toBe(2);
    expect(impact.ledger_entry_count).toBe(2);
    expect(impact.balance_usd).toBeCloseTo(50, 2);
    expect(impact.balance_lbp).toBeCloseTo(900000, 0);
  });

  it("moves products, batches and all debt; target balance = both balances, per currency", () => {
    const before = {
      src: balance(source.supplier_id),
      tgt: balance(target.supplier_id),
    };
    expect(before.src).toEqual({ usd: 50, lbp: 900000 });
    expect(before.tgt).toEqual({ usd: 20, lbp: 0 });

    getProductSupplierRepository().merge(source.id, target.id);

    expect(balance(target.supplier_id)).toEqual({ usd: 70, lbp: 900000 });

    // Both products (old stock and new) now carry the target's name.
    const labels = db
      .prepare(
        `SELECT id, supplier FROM products WHERE id IN (101, 102) ORDER BY id`,
      )
      .all() as { id: number; supplier: string }[];
    expect(labels.map((l) => l.supplier)).toEqual(["recall", "recall"]);

    // Nothing points at the source any more, and it is gone.
    const leftovers = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM supplier_ledger WHERE supplier_id = ?) +
           (SELECT COUNT(*) FROM product_stock_batches WHERE supplier_id = ?) AS n`,
      )
      .get(source.supplier_id, source.supplier_id) as { n: number };
    expect(leftovers.n).toBe(0);
    expect(
      db
        .prepare(`SELECT COUNT(*) AS n FROM suppliers WHERE id = ?`)
        .get(source.supplier_id),
    ).toEqual({ n: 0 });
    expect(
      db
        .prepare(`SELECT COUNT(*) AS n FROM product_suppliers WHERE id = ?`)
        .get(source.id),
    ).toEqual({ n: 0 });
  });

  it("rule 20 — voiding a pre-merge stock intake reverses it on the target", () => {
    getProductSupplierRepository().merge(source.id, target.id);
    getTransactionRepository().voidTransaction(sourceIntakeTxn, 1);
    expect(balance(target.supplier_id)).toEqual({ usd: 20, lbp: 900000 });
  });

  it("a pre-merge payment shows on the target's ledger and settle queue, and its void reverses on the target", () => {
    const suppliers = getSupplierRepository();
    const paid = suppliers.addLedgerEntry({
      supplier_id: source.supplier_id,
      entry_type: "PAYMENT",
      amount_usd: 30,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });
    const payTxn = (
      db
        .prepare(`SELECT transaction_id FROM supplier_ledger WHERE id = ?`)
        .get(paid.id) as { transaction_id: number }
    ).transaction_id;
    const sourceIntakeRow = (
      db
        .prepare(
          `SELECT id FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'STOCK_INTAKE'`,
        )
        .get(source.supplier_id) as { id: number }
    ).id;
    expect(balance(source.supplier_id)).toEqual({ usd: 20, lbp: 900000 });

    getProductSupplierRepository().merge(source.id, target.id);

    // 20 (recall) + 50 (reacall intake) − 30 (reacall payment), LBP kept.
    expect(balance(target.supplier_id)).toEqual({ usd: 40, lbp: 900000 });
    const ledgerIds = suppliers
      .getSupplierLedger(target.supplier_id)
      .map((r) => r.id);
    expect(ledgerIds).toEqual(
      expect.arrayContaining([paid.id, sourceIntakeRow]),
    );
    // The settle-by-day queue of the target now carries the moved debt row.
    const queue = suppliers.getAccountUnsettled(target.supplier_id);
    expect(
      queue.some((r) => r.kind === "LEDGER" && r.id === sourceIntakeRow),
    ).toBe(true);

    getTransactionRepository().voidTransaction(payTxn, 1);
    expect(balance(target.supplier_id)).toEqual({ usd: 70, lbp: 900000 });
  });

  it("refuses to merge a supplier into itself", () => {
    expect(() =>
      getProductSupplierRepository().merge(source.id, source.id),
    ).toThrow();
  });

  it("plain delete is refused while the supplier has products or debt history", () => {
    expect(() => getProductSupplierRepository().delete(source.id)).toThrow(
      /merge/i,
    );
    expect(balance(source.supplier_id)).toEqual({ usd: 50, lbp: 900000 });
  });

  it("plain delete still works for an empty supplier", () => {
    const empty = getProductSupplierRepository().create("nobody");
    expect(getProductSupplierRepository().delete(empty.id)).toBe(true);
  });
});
