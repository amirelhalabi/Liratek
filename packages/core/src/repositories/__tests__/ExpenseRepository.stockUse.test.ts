/**
 * LIRA-262 — "the shop uses its own stock" expenses.
 *
 * Picking an inventory product or a Katsh / iPick / Whish App catalog item on
 * the Expenses page records an expense AT COST, with NO cash leaving any cash
 * drawer:
 *   - INVENTORY: products.stock_quantity −qty, FIFO batch consumption like a
 *     sale, expense amount_usd = the FIFO cost. No payments row at all.
 *   - KATSH / IPICK / WHISH_APP: the provider's prepaid drawer is debited by
 *     cost_lbp × qty (the same cost leg a catalog sale posts), expense
 *     amount_lbp = that cost.
 * One transaction type per source (EXPENSE_INVENTORY, EXPENSE_KATSH,
 * EXPENSE_IPICK, EXPENSE_WHISH_APP).
 *
 * Rule 20: the generic void AND refund must give the stock (batches too) or
 * the provider drawer back and soft-void the expense, so create + reverse
 * nets every ledger to 0 per currency.
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
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
  ExpenseRepository,
  resetExpenseRepository,
} from "../ExpenseRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetServiceProviderRepository } from "../ServiceProviderRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const DAY = "2026-10-06T09:00:00.000Z";

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetExpenseRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetPaymentMethodRepository();
  resetServiceProviderRepository();
  resetDebtRepository();
  resetPartnerRepository();
}

/** Product with stock 7 = batch A (2 @ $3, oldest) + batch B (5 @ $5). */
function addProductWithBatches(db: Database.Database): {
  productId: number;
  batchA: number;
  batchB: number;
} {
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, 'Printer paper', 'Product', 5, 9, 7)`,
      )
      .run().lastInsertRowid,
  );
  const batches = getStockBatchRepository();
  const batchA = batches.createBatch({
    product_id: productId,
    supplier_id: null,
    quantity: 2,
    unit_cost_usd: 3,
    books_debt: false,
    created_by: USER_ID,
  });
  const batchB = batches.createBatch({
    product_id: productId,
    supplier_id: null,
    quantity: 5,
    unit_cost_usd: 5,
    books_debt: false,
    created_by: USER_ID,
  });
  return { productId, batchA, batchB };
}

function addCatalogItem(
  db: Database.Database,
  provider: string,
  costLbp: number,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp)
         VALUES (1, ?, 'Gaming', 'PUBG', '60 UC', ?, ?)`,
      )
      .run(provider, costLbp, costLbp + 50000).lastInsertRowid,
  );
}

function stockOf(db: Database.Database, productId: number): number {
  return (
    db
      .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
      .get(productId) as { stock_quantity: number }
  ).stock_quantity;
}

function remainingOf(db: Database.Database, batchId: number): number {
  return (
    db
      .prepare(
        `SELECT quantity_remaining FROM product_stock_batches WHERE id = ?`,
      )
      .get(batchId) as { quantity_remaining: number }
  ).quantity_remaining;
}

/** What Profits / closing count: active, non-refunded expenses. */
function activeExpenseTotals(db: Database.Database): {
  usd: number;
  lbp: number;
} {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM expenses WHERE status = 'active' AND COALESCE(is_refunded, 0) = 0`,
    )
    .get() as { usd: number; lbp: number };
}

function expenseTxn(
  db: Database.Database,
  expenseId: number,
): {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  metadata_json: string;
} {
  return db
    .prepare(
      `SELECT id, type, amount_usd, amount_lbp, profit_usd, profit_lbp, metadata_json
       FROM transactions
       WHERE source_table = 'expenses' AND source_id = ? AND reverses_id IS NULL`,
    )
    .get(expenseId) as ReturnType<typeof expenseTxn>;
}

function paymentsOf(
  db: Database.Database,
  txnId: number,
): { drawer_name: string; currency_code: string; amount: number }[] {
  return db
    .prepare(
      `SELECT drawer_name, currency_code, amount FROM payments WHERE transaction_id = ?`,
    )
    .all(txnId) as {
    drawer_name: string;
    currency_code: string;
    amount: number;
  }[];
}

describe("LIRA-262 — expense from the shop's own stock", () => {
  let db: Database.Database;
  let repo: ExpenseRepository;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new ExpenseRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  describe("INVENTORY", () => {
    it("reduces stock by qty, FIFO-consumes batches, books the FIFO cost, and moves no drawer", () => {
      const { productId, batchA, batchB } = addProductWithBatches(db);
      const before = snapshotLedgers(db);

      const expenseId = repo.createStockExpense(
        {
          source: "INVENTORY",
          item_id: productId,
          quantity: 3,
          category: "Shop_Supply",
          expense_date: DAY,
        },
        USER_ID,
      );

      expect(stockOf(db, productId)).toBe(4);
      // FIFO: both units of batch A ($3), then one unit of batch B ($5).
      expect(remainingOf(db, batchA)).toBe(0);
      expect(remainingOf(db, batchB)).toBe(4);
      expect(activeExpenseTotals(db)).toEqual({ usd: 11, lbp: 0 });

      const txn = expenseTxn(db, expenseId);
      expect(txn.type).toBe("EXPENSE_INVENTORY");
      expect(txn.amount_usd).toBe(-11);
      expect(txn.amount_lbp).toBe(0);
      // The expense row itself is what reduces net profit — the transaction
      // carries no profit stamp of its own.
      expect(txn.profit_usd ?? 0).toBe(0);
      expect(txn.profit_lbp ?? 0).toBe(0);
      expect(paymentsOf(db, txn.id)).toEqual([]);
      // No cash drawer — or any other ledger — moved.
      expectPostings(before, snapshotLedgers(db), {});
      // Not a system side-effect (rule 26): visible in the Transactions table.
      expect(JSON.parse(txn.metadata_json).is_auto).toBeUndefined();
    });

    it("refuses more than the stock on hand and writes nothing", () => {
      const { productId } = addProductWithBatches(db);
      const before = snapshotLedgers(db);

      expect(() =>
        repo.createStockExpense(
          {
            source: "INVENTORY",
            item_id: productId,
            quantity: 8,
            category: "Shop_Supply",
            expense_date: DAY,
          },
          USER_ID,
        ),
      ).toThrow(/Not enough stock/);

      expect(stockOf(db, productId)).toBe(7);
      expect(activeExpenseTotals(db)).toEqual({ usd: 0, lbp: 0 });
      expectPostings(before, snapshotLedgers(db), {});
    });

    it.each(["void", "refund"] as const)(
      "%s restores stock and batches and nets every ledger to 0",
      (mode) => {
        const { productId, batchA, batchB } = addProductWithBatches(db);
        const before = snapshotLedgers(db);
        const expenseId = repo.createStockExpense(
          {
            source: "INVENTORY",
            item_id: productId,
            quantity: 3,
            category: "Shop_Supply",
            expense_date: DAY,
          },
          USER_ID,
        );
        const txnId = expenseTxn(db, expenseId).id;

        if (mode === "void") {
          getTransactionRepository().voidTransaction(txnId, USER_ID);
        } else {
          getTransactionRepository().refundTransaction(txnId, USER_ID);
        }

        expect(stockOf(db, productId)).toBe(7);
        expect(remainingOf(db, batchA)).toBe(2);
        expect(remainingOf(db, batchB)).toBe(5);
        expect(activeExpenseTotals(db)).toEqual({ usd: 0, lbp: 0 });
        expectPostings(before, snapshotLedgers(db), {});
      },
    );

    it("deleting it from the Expenses page restores stock exactly once", () => {
      const { productId } = addProductWithBatches(db);
      const expenseId = repo.createStockExpense(
        {
          source: "INVENTORY",
          item_id: productId,
          quantity: 2,
          category: "Shop_Supply",
          expense_date: DAY,
        },
        USER_ID,
      );

      repo.deleteExpense(expenseId, USER_ID);

      expect(stockOf(db, productId)).toBe(7);
      expect(activeExpenseTotals(db)).toEqual({ usd: 0, lbp: 0 });
    });
  });

  describe.each([
    ["KATSH", "Katsh", "Katsh", "EXPENSE_KATSH"],
    ["IPICK", "iPick", "iPick", "EXPENSE_IPICK"],
    ["WHISH_APP", "WHISH_APP", "Whish_App", "EXPENSE_WHISH_APP"],
  ] as const)("%s catalog item", (source, provider, drawer, type) => {
    it("debits the provider drawer by cost × qty and no cash drawer", () => {
      const itemId = addCatalogItem(db, provider, 150000);
      const before = snapshotLedgers(db);

      const expenseId = repo.createStockExpense(
        {
          source,
          item_id: itemId,
          quantity: 2,
          category: "Shop_Supply",
          expense_date: DAY,
        },
        USER_ID,
      );

      expectPostings(before, snapshotLedgers(db), {
        drawers: { [`${drawer}|LBP`]: -300000 },
      });
      expect(activeExpenseTotals(db)).toEqual({ usd: 0, lbp: 300000 });
      const txn = expenseTxn(db, expenseId);
      expect(txn.type).toBe(type);
      expect(txn.amount_lbp).toBe(-300000);
      expect(txn.amount_usd).toBe(0);
    });

    it.each(["void", "refund"] as const)(
      "%s gives the provider drawer back and nets every ledger to 0",
      (mode) => {
        const itemId = addCatalogItem(db, provider, 150000);
        const before = snapshotLedgers(db);
        const expenseId = repo.createStockExpense(
          {
            source,
            item_id: itemId,
            quantity: 2,
            category: "Shop_Supply",
            expense_date: DAY,
          },
          USER_ID,
        );
        const txnId = expenseTxn(db, expenseId).id;

        if (mode === "void") {
          getTransactionRepository().voidTransaction(txnId, USER_ID);
        } else {
          getTransactionRepository().refundTransaction(txnId, USER_ID);
        }

        expect(activeExpenseTotals(db)).toEqual({ usd: 0, lbp: 0 });
        expectPostings(before, snapshotLedgers(db), {});
      },
    );
  });

  it("a supplier stock-intake void is refused once a shop-use expense drew from its batch", () => {
    // deleteBatchForVoid (the intake void's batch owner) refuses any batch
    // with quantity_remaining < quantity — so an expense's consumption can
    // never be orphaned by deleting the batch under it.
    const { productId, batchA } = addProductWithBatches(db);
    repo.createStockExpense(
      {
        source: "INVENTORY",
        item_id: productId,
        quantity: 1,
        category: "Shop_Supply",
        expense_date: DAY,
      },
      USER_ID,
    );

    expect(getStockBatchRepository().deleteBatchForVoid(batchA)).toBe(false);
    expect(remainingOf(db, batchA)).toBe(1);
  });

  describe("catalog guards", () => {
    it("refuses a refund that would pay cash out — no customer cash was taken", () => {
      const itemId = addCatalogItem(db, "Katsh", 150000);
      const expenseId = repo.createStockExpense(
        {
          source: "KATSH",
          item_id: itemId,
          quantity: 1,
          category: "Shop_Supply",
          expense_date: DAY,
        },
        USER_ID,
      );
      const txnId = expenseTxn(db, expenseId).id;
      const before = snapshotLedgers(db);

      // The provider leg is internal ("Cost: Katsh"), so there is no customer
      // cash to redirect: the override validation itself refuses it.
      expect(() =>
        getTransactionRepository().refundTransaction(txnId, USER_ID, {
          refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 150000 }],
        }),
      ).toThrow(/LBP totals do not match the original payment — original 0/);
      expectPostings(before, snapshotLedgers(db), {});
    });

    it("refuses an item from another provider than the chosen source", () => {
      const omtAppItem = addCatalogItem(db, "OMT_APP", 150000);
      expect(() =>
        repo.createStockExpense(
          {
            source: "KATSH",
            item_id: omtAppItem,
            quantity: 1,
            category: "Shop_Supply",
            expense_date: DAY,
          },
          USER_ID,
        ),
      ).toThrow(/not found/i);
    });

    it("refuses an item with no cost", () => {
      const free = addCatalogItem(db, "iPick", 0);
      expect(() =>
        repo.createStockExpense(
          {
            source: "IPICK",
            item_id: free,
            quantity: 1,
            category: "Shop_Supply",
            expense_date: DAY,
          },
          USER_ID,
        ),
      ).toThrow(/no cost/i);
      expect(activeExpenseTotals(db)).toEqual({ usd: 0, lbp: 0 });
    });
  });
});
