/**
 * LIRA-365 — `bookDiscountGivenExpense`: the one writer for a discount the
 * shop gave (OMT/Whish system send, voucher sale). Books ONE books-only
 * "Discount given" expense in the discount's currency, linked to the parent
 * (so `is_auto` is derived and the void cascade reverses it), with no
 * payments row and no drawer movement.
 *
 * Rule 17: written against a stub that threw
 * "bookDiscountGivenExpense: not implemented".
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import {
  bookDiscountGivenExpense,
  DISCOUNT_GIVEN_EXPENSE_CATEGORY,
} from "../discountGivenExpense.js";
import { resetExpenseRepository } from "../ExpenseRepository.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

const SCHEMA = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "electron-app",
    "create_db.sql",
  ),
  "utf-8",
);

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
  resetExpenseRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  resetExpenseRepository();
  db.close();
});

const t1 = <T>(fn: () => T): T => runWithTenant(1, fn);

type ExpenseRow = {
  id: number;
  category: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
  source_ref_table: string;
  source_ref_id: number;
};

function expenses(): ExpenseRow[] {
  return db
    .prepare(
      `SELECT id, category, amount_usd, amount_lbp, expense_date, source_ref_table, source_ref_id FROM expenses`,
    )
    .all() as ExpenseRow[];
}

function expenseTxn(expenseId: number) {
  return db
    .prepare(
      `SELECT id, status, metadata_json FROM transactions WHERE source_table = 'expenses' AND source_id = ?`,
    )
    .get(expenseId) as {
    id: number;
    status: string;
    metadata_json: string | null;
  };
}

function drawerTotals() {
  return db
    .prepare(
      `SELECT COALESCE(SUM(balance), 0) AS total FROM drawer_balances`,
    )
    .get() as { total: number };
}

describe("bookDiscountGivenExpense", () => {
  it("USD discount → one books-only, auto, linked 'Discount given' expense", () => {
    const before = drawerTotals().total;
    t1(() =>
      bookDiscountGivenExpense({
        parentSourceTable: "financial_services",
        parentSourceId: 7,
        parentLabel: "OMT send #7",
        amount: 2,
        currency: "USD",
        exchangeRate: 89_500,
        userId: 1,
        transactionTime: "2026-10-31 09:15:00",
      }),
    );
    const rows = expenses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: DISCOUNT_GIVEN_EXPENSE_CATEGORY,
      amount_usd: 2,
      amount_lbp: 0,
      source_ref_table: "financial_services",
      source_ref_id: 7,
    });
    // The parent's (backdated) time, not the server clock (rule 27).
    expect(rows[0]!.expense_date.startsWith("2026-10-31")).toBe(true);
    const txn = expenseTxn(rows[0]!.id);
    expect(JSON.parse(txn.metadata_json ?? "{}").is_auto).toBe(true);
    const payments = db
      .prepare(`SELECT COUNT(*) AS n FROM payments WHERE transaction_id = ?`)
      .get(txn.id) as { n: number };
    expect(payments.n).toBe(0);
    expect(drawerTotals().total).toBe(before);
  });

  it("LBP discount books the LBP side only", () => {
    t1(() =>
      bookDiscountGivenExpense({
        parentSourceTable: "vouchers",
        parentSourceId: 3,
        parentLabel: "Voucher #3",
        amount: 450_000,
        currency: "LBP",
        exchangeRate: 89_500,
        userId: 1,
        clientDay: "2026-10-31",
      }),
    );
    expect(expenses()[0]).toMatchObject({
      amount_usd: 0,
      amount_lbp: 450_000,
    });
  });

  it("zero discount books nothing", () => {
    t1(() =>
      bookDiscountGivenExpense({
        parentSourceTable: "financial_services",
        parentSourceId: 1,
        parentLabel: "OMT send #1",
        amount: 0,
        currency: "USD",
        exchangeRate: 89_500,
        userId: 1,
      }),
    );
    expect(expenses()).toHaveLength(0);
  });

  it("voidLinkedExpenses on the parent voids it (voucher reversal path)", () => {
    t1(() =>
      bookDiscountGivenExpense({
        parentSourceTable: "vouchers",
        parentSourceId: 9,
        parentLabel: "Voucher #9",
        amount: 2,
        currency: "USD",
        exchangeRate: 89_500,
        userId: 1,
        clientDay: "2026-10-31",
      }),
    );
    const id = expenses()[0]!.id;
    t1(() => getTransactionRepository().voidLinkedExpenses("vouchers", 9, 1));
    expect(expenseTxn(id).status).toBe("VOIDED");
  });
});
