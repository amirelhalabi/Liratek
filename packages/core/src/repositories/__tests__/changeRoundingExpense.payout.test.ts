/**
 * LIRA-334 — `bookPayoutRoundingExpense`: the one writer for a payout
 * round-up. Books ONE books-only "Change rounding" expense in the payout's
 * currency, linked to the parent (so `is_auto` is derived and the void
 * cascade reverses it), with no payments row.
 *
 * Rule 17: written against a stub that threw
 * "bookPayoutRoundingExpense: not implemented"; every case failed on it.
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import {
  bookPayoutRoundingExpense,
  CHANGE_ROUNDING_EXPENSE_CATEGORY,
} from "../changeRoundingExpense.js";
import { resetExpenseRepository } from "../ExpenseRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
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
      `SELECT id, metadata_json FROM transactions WHERE source_table = 'expenses' AND source_id = ?`,
    )
    .get(expenseId) as { id: number; metadata_json: string | null };
}

function paymentsFor(txnId: number) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM payments WHERE transaction_id = ?`)
    .get(txnId) as { n: number };
}

describe("bookPayoutRoundingExpense", () => {
  it("USD round-up → one books-only, auto, linked 'Change rounding' expense", () => {
    t1(() =>
      bookPayoutRoundingExpense({
        parentSourceTable: "financial_services",
        parentSourceId: 7,
        parentLabel: "OMT receive #7",
        amount: { usd: 0.1, lbp: 0 },
        exchangeRate: 89_500,
        userId: 1,
        clientDay: "2026-10-18",
      }),
    );
    const rows = expenses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: CHANGE_ROUNDING_EXPENSE_CATEGORY,
      amount_usd: 0.1,
      amount_lbp: 0,
      source_ref_table: "financial_services",
      source_ref_id: 7,
    });
    expect(rows[0]!.expense_date.startsWith("2026-10-18")).toBe(true);
    const txn = expenseTxn(rows[0]!.id);
    expect(JSON.parse(txn.metadata_json ?? "{}").is_auto).toBe(true);
    expect(paymentsFor(txn.id).n).toBe(0);
  });

  it("LBP round-up books the LBP side only", () => {
    t1(() =>
      bookPayoutRoundingExpense({
        parentSourceTable: "exchange_transactions",
        parentSourceId: 3,
        parentLabel: "Exchange #3",
        amount: { usd: 0, lbp: 5_000 },
        exchangeRate: 89_500,
        userId: 1,
        clientDay: "2026-10-18",
      }),
    );
    expect(expenses()[0]).toMatchObject({ amount_usd: 0, amount_lbp: 5_000 });
  });

  it("zero round-up books nothing", () => {
    t1(() =>
      bookPayoutRoundingExpense({
        parentSourceTable: "recharges",
        parentSourceId: 1,
        parentLabel: "Buy-back #1",
        amount: { usd: 0, lbp: 0 },
        exchangeRate: 89_500,
        userId: 1,
      }),
    );
    expect(expenses()).toHaveLength(0);
  });
});
