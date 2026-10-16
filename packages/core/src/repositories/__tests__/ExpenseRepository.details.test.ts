/**
 * LIRA-329 T031 — an expense keeps what the operator entered on its own
 * transaction: category, the FULL description (the summary is the only
 * other place it lived), the bill exactly as typed (before the change the
 * vendor kept was added to the cost — it was saved nowhere), the expense
 * date, the stock item used, and how it was paid (cash handed, change back,
 * change the vendor kept).
 *
 * Money columns are asserted FIRST at today's values (FR-008). Expected
 * details go through the kind's own schema (rule 24). Rule 17: run before
 * the builder existed and seen failing.
 *
 * Real schema: create_db.sql + migrations.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  ExpenseRepository,
  resetExpenseRepository,
  type CreateExpenseData,
} from "../ExpenseRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { buildDb, fundDrawer, USER_ID } from "../testHelpers/omtAccountDb";
import { createExpenseSchema } from "../../validators/expense";
import {
  expenseDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

const DAY = "2026-10-16T00:00:00.000Z";
const RATE = 89500;
const LONG_DESCRIPTION =
  "Printer ink for the receipt printer and the label printer, bought at the shop across the street";

interface TxnRow {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  summary: string;
  metadata_json: string;
}

function txnFor(db: Database.Database, expenseId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, type, amount_usd, amount_lbp, profit_usd, summary, metadata_json
         FROM transactions WHERE source_table = 'expenses' AND source_id = ?`,
    )
    .get(expenseId) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(expenseDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

function paymentsOf(
  db: Database.Database,
  txnId: number,
): Array<{ method: string; currency_code: string; amount: number }> {
  return db
    .prepare(
      `SELECT method, currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
    )
    .all(txnId) as Array<{
    method: string;
    currency_code: string;
    amount: number;
  }>;
}

/** Built through the shared schema (rule 24). */
function manual(
  bill: { usd?: number; lbp?: number },
  extra: Record<string, unknown> = {},
): CreateExpenseData {
  const parsed = createExpenseSchema.parse({
    category: "Shop_Supply",
    description: LONG_DESCRIPTION,
    amount_usd: bill.usd ?? 0,
    amount_lbp: bill.lbp ?? 0,
    paid_by_method: "CASH",
    expense_date: DAY,
    ...extra,
  });
  return {
    ...parsed,
    description: parsed.description ?? "",
  } as CreateExpenseData;
}

describe("LIRA-329 — ExpenseRepository: expense details", () => {
  let db: Database.Database;
  let repo: ExpenseRepository;

  beforeEach(() => {
    resetExpenseRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    resetStockBatchRepository();
    db = buildDb();
    initFixedTenantContext(1);
    fundDrawer(db, "General", "USD", 10000);
    fundDrawer(db, "General", "LBP", 100_000_000);
    repo = new ExpenseRepository();
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction).
  afterEach(() => {
    expectEverySnapshotMatchesPayments(db);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("bill $18.50, hand $20, $1 back, $0.50 kept: the bill as typed, the full description, and how it was paid", () => {
    const expenseId = repo.createExpense(
      manual(
        { usd: 18.5 },
        {
          payments: [
            { method: "CASH", currencyCode: "USD", amount: 20 },
            {
              method: "CASH",
              currencyCode: "USD",
              amount: 1,
              direction: "OUT",
            },
          ],
          kept_change_usd: 0.5,
          tender_exchange_rate: RATE,
        },
      ),
      USER_ID,
    );
    const row = txnFor(db, expenseId);
    // Money at today's values (FR-008): the cost is $19 (bill + kept).
    expect(row).toMatchObject({
      type: "EXPENSE",
      amount_usd: -19,
      profit_usd: 0,
    });
    expect(meta(row).is_auto).toBeUndefined();
    expectDetails(row, {
      v: 1,
      kind: "expense",
      category: "Shop_Supply",
      description: LONG_DESCRIPTION,
      billAmount: { amount: 18.5, currency: "USD" },
      expenseDate: DAY,
    });
    const snapshot = {
      lines: [
        { method: "CASH", currency: "USD", amount: 20, direction: "IN" },
        { method: "CASH", currency: "USD", amount: 1, direction: "OUT" },
      ],
      change_returned: [{ method: "CASH", currency: "USD", amount: 1 }],
      kept: { usd: 0.5 },
    };
    expect(paymentSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(meta(row).payment_snapshot).toEqual(snapshot);
    // The copy matches the payments rows booked for it.
    expect(
      paymentsOf(db, row.id).map((p) => ({
        method: p.method,
        currency: p.currency_code,
        amount: Math.abs(p.amount),
      })),
    ).toEqual(
      snapshot.lines.map(({ method, currency, amount }) => ({
        method,
        currency,
        amount,
      })),
    );
  });

  it("an LBP bill with no cash lines keeps the bill; no payment lines are invented", () => {
    const expenseId = repo.createExpense(
      manual({ lbp: 500000 }, { description: "Generator subscription" }),
      USER_ID,
    );
    const row = txnFor(db, expenseId);
    expect(row).toMatchObject({ amount_lbp: -500000 });
    expectDetails(row, {
      v: 1,
      kind: "expense",
      category: "Shop_Supply",
      description: "Generator subscription",
      billAmount: { amount: 500000, currency: "LBP" },
      expenseDate: DAY,
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  it("a stock-use expense keeps the item used and no typed bill", () => {
    const productId = Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
           VALUES (1, 'Printer paper', 'Product', 5, 9, 7)`,
        )
        .run().lastInsertRowid,
    );
    const expenseId = repo.createStockExpense(
      {
        source: "INVENTORY",
        item_id: productId,
        quantity: 2,
        category: "Shop_Supply",
        expense_date: "2026-10-16",
      },
      USER_ID,
    );
    const row = txnFor(db, expenseId);
    expect(row).toMatchObject({ type: "EXPENSE_INVENTORY", amount_usd: -10 });
    expectDetails(row, {
      v: 1,
      kind: "expense",
      category: "Shop_Supply",
      description: "2 × Printer paper",
      expenseDate: "2026-10-16",
      stockUse: { source: "INVENTORY", itemId: productId, quantity: 2 },
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  it("an automatic sibling expense keeps is_auto and its details", () => {
    const expenseId = repo.createExpense(
      {
        description: "SMS transfer fee",
        category: "SMS_Transfer_Fee",
        paid_by_method: "CASH",
        amount_usd: 0.25,
        amount_lbp: 0,
        expense_date: "2026-10-16",
        source_ref_table: "recharges",
        source_ref_id: 1,
      },
      USER_ID,
    );
    const row = txnFor(db, expenseId);
    expect(row).toMatchObject({ amount_usd: -0.25 });
    expect(meta(row).is_auto).toBe(true);
    expectDetails(row, {
      v: 1,
      kind: "expense",
      category: "SMS_Transfer_Fee",
      description: "SMS transfer fee",
      billAmount: { amount: 0.25, currency: "USD" },
      expenseDate: "2026-10-16",
    });
  });
});
