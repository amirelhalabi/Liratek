/**
 * LIRA-185 — Profits accuracy audit, module: EXPENSES.
 *
 * Each describe block re-runs one lead from the September audit
 * (profitaudit/expenses.json) through the REAL writers
 * (`ExpenseRepository.createExpense`, `ExpenseRepository.deleteExpense`,
 * `TransactionRepository.voidTransaction`) against the full fresh schema
 * (`electron-app/create_db.sql`), then reads every core surface the lead
 * names (`ExpenseRepository.getTodayExpenses`, `ProfitRepository
 * .getExpenseTotals` / `.getByDate`, `ClosingRepository
 * .getDailyActivityStats`) and compares the numbers.
 *
 * Every call runs inside `runWithTenant(1, …, { clientTzOffsetMinutes: 180 })`
 * (a Beirut client) so the day bucketing uses the explicit `'180 minutes'`
 * modifier, not SQLite's `'localtime'` — the latter mis-resolves under the
 * test script's `TZ=Asia/Beirut` on Windows (see ExpenseActiveGate.test.ts),
 * which would make day-boundary assertions machine-dependent.
 *
 * Several leads live wholly or partly in the FRONTEND (the Expenses page
 * header reduce, the History modal's date filter, the payment widget's
 * "Total Amount" row). Those halves cannot be executed from core jest; where
 * a lead's frontend arithmetic is a plain expression over the repository's
 * output, the test applies that exact expression to the real repository
 * output and labels it as a mirror of the named frontend line.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  ExpenseRepository,
  resetExpenseRepository,
} from "../ExpenseRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  ClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository.js";
import {
  ProfitRepository,
  resetProfitRepository,
} from "../ProfitRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import {
  dayBoundaryInstant,
  localDay as offsetLocalDay,
} from "../testHelpers/boundaryInstant.js";

const USER_ID = 1;
const BEIRUT = 180;
const D = "2026-09-05"; // a fixed past business day for range-based surfaces
const D_FROM = `${D} 00:00:00`;
const D_TO = `${D} 23:59:59`;

let db: Database.Database;

function loadSchema(d: Database.Database): void {
  const sqlPath = path.resolve(
    __dirname,
    "../../../../../electron-app/create_db.sql",
  );
  d.pragma("foreign_keys = OFF");
  d.exec(fs.readFileSync(sqlPath, "utf8"));
}

function asBeirut<T>(fn: () => T): T {
  return runWithTenant(1, fn, { clientTzOffsetMinutes: BEIRUT });
}

let expenseRepo: ExpenseRepository;
let txnRepo: TransactionRepository;
let closingRepo: ClosingRepository;
let profitRepo: ProfitRepository;

beforeEach(() => {
  db = new Database(":memory:");
  loadSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetExpenseRepository();
  resetTransactionRepository();
  resetClosingRepository();
  resetProfitRepository();
  expenseRepo = new ExpenseRepository();
  txnRepo = new TransactionRepository();
  closingRepo = new ClosingRepository();
  profitRepo = new ProfitRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
  resetExpenseRepository();
  resetTransactionRepository();
  resetClosingRepository();
  resetProfitRepository();
});

function create(
  usd: number,
  lbp: number,
  expense_date: string,
  label: string,
  paid_by_method = "CASH",
): number {
  return asBeirut(() =>
    expenseRepo.createExpense(
      {
        description: label,
        category: "Shop_Supply",
        paid_by_method,
        amount_usd: usd,
        amount_lbp: lbp,
        expense_date,
      },
      USER_ID,
    ),
  );
}

function voidFromTransactionsViewer(expenseId: number): void {
  asBeirut(() => {
    const t = txnRepo.getBySourceId("expenses", expenseId);
    if (!t) throw new Error("expense not linked to a transaction");
    txnRepo.voidTransaction(t.id, USER_ID);
  });
}

describe("Lead 1 — page header total counts a Transactions-viewer-voided expense", () => {
  it("records the three surfaces' numbers for one active + one viewer-voided + one page-deleted expense", () => {
    const today = offsetLocalDay(Date.now(), BEIRUT);
    const noon = `${today}T12:00:00.000Z`; // 15:00 Beirut, same day
    create(10, 1_200_000, noon, "active");
    const deleted = create(20, 0, noon, "deleted-from-page");
    asBeirut(() => expenseRepo.deleteExpense(deleted, USER_ID));
    const viewerVoided = create(50, 0, noon, "voided-from-viewer");
    voidFromTransactionsViewer(viewerVoided);

    const rows = asBeirut(() => expenseRepo.getTodayExpenses());
    // Mirror of frontend/src/features/expenses/pages/Expenses/index.tsx:188-189
    const pageHeaderUsd = rows.reduce((s, e) => s + (e.amount_usd || 0), 0);
    const pageHeaderLbp = rows.reduce((s, e) => s + (e.amount_lbp || 0), 0);
    const profits = asBeirut(() =>
      profitRepo.getExpenseTotals(`${today} 00:00:00`, `${today} 23:59:59`),
    );
    const closing = asBeirut(() => closingRepo.getDailyActivityStats(today));

    process.stdout.write(
      `LEAD1 ${JSON.stringify({
        rows: rows.map((r) => ({
          d: r.description,
          usd: r.amount_usd,
          status: r.status,
          is_refunded: r.is_refunded,
        })),
        pageHeaderUsd,
        pageHeaderLbp,
        profits,
        closingUsd: closing.totalExpensesUSD,
        closingLbp: closing.totalExpensesLBP,
      })}\n`,
    );

    // The repository contract (LIRA-131) deliberately returns the refunded
    // row, flagged, so the History modal can badge it.
    const v = rows.find((r) => r.description === "voided-from-viewer");
    expect(v?.is_refunded).toBe(1);
    expect(v?.status).toBe("active");
    // Reporting surfaces agree with each other.
    expect(profits.total_usd).toBe(10);
    expect(closing.totalExpensesUSD).toBe(10);
    expect(profits.total_lbp).toBe(1_200_000);
    expect(closing.totalExpensesLBP).toBe(1_200_000);
  });

  // Was red (Expected 10, Received 60) against the old unfiltered reduce.
  // The page now skips is_refunded rows (LIRA-185 lead 1); the durable guard
  // is frontend Expenses.headerTotalExcludesVoided.test.tsx (red first).
  it("the rows the page header sums (getTodayExpenses minus is_refunded rows, as index.tsx now does) equal the Profits/Closing expense total", () => {
    const today = offsetLocalDay(Date.now(), BEIRUT);
    const noon = `${today}T12:00:00.000Z`;
    create(10, 0, noon, "active");
    const viewerVoided = create(50, 0, noon, "voided-from-viewer");
    voidFromTransactionsViewer(viewerVoided);

    const rows = asBeirut(() => expenseRepo.getTodayExpenses());
    const profits = asBeirut(() =>
      profitRepo.getExpenseTotals(`${today} 00:00:00`, `${today} 23:59:59`),
    );
    // Mirror of the Expenses page header (index.tsx activeExpenses): a
    // voided expense's drawer leg is already returned, so it must not count
    // (the activeExpense() rule).
    const pageHeaderUsd = rows
      .filter((e) => !e.is_refunded)
      .reduce((s, e) => s + (e.amount_usd || 0), 0);
    expect(pageHeaderUsd).toBe(profits.total_usd); // 10
  });
});

describe("Lead 2 — getTodayExpenses UTC day vs reporting local day", () => {
  it("an expense booked 00:00-03:00 Beirut is 'today' on the Expenses page AND counted by Profits/Closing for the same local day", () => {
    const now = Date.now();
    const boundary = dayBoundaryInstant(now, BEIRUT); // Beirut-today, UTC-yesterday
    const today = offsetLocalDay(now, BEIRUT);
    create(0, 500_000, boundary, "boundary bill");

    const rows = asBeirut(() => expenseRepo.getTodayExpenses());
    const profits = asBeirut(() =>
      profitRepo.getExpenseTotals(`${today} 00:00:00`, `${today} 23:59:59`),
    );
    const closing = asBeirut(() => closingRepo.getDailyActivityStats(today));
    process.stdout.write(
      `LEAD2 ${JSON.stringify({ boundary, today, rows: rows.length, profitsLbp: profits.total_lbp, closingLbp: closing.totalExpensesLBP })}\n`,
    );
    expect(rows.map((r) => r.amount_lbp)).toEqual([500_000]);
    expect(profits.total_lbp).toBe(500_000);
    expect(closing.totalExpensesLBP).toBe(500_000);
  });
});

describe("Lead 3 — two expense_date encodings (manual local-midnight-as-UTC vs Line_Usage true instant)", () => {
  it("both encodings land on the same business day on every core surface", () => {
    // (a) manual: index.tsx:124 new Date("2026-09-05").toISOString()
    const manual = new Date(D).toISOString();
    // (b) Line_Usage: CarrierLineRepository new Date().toISOString() at
    //     01:30 Beirut on D == 22:30Z on D-1
    const lineUsage = "2026-09-04T22:30:00.000Z";
    create(20, 0, manual, "manual");
    create(8, 0, lineUsage, "line usage");

    const profits = asBeirut(() => profitRepo.getExpenseTotals(D_FROM, D_TO));
    const closing = asBeirut(() => closingRepo.getDailyActivityStats(D));
    const byDate = asBeirut(() => profitRepo.getByDate(D, D, D_FROM, D_TO));
    // Mirror of useDateRangeFilter.ts:17 (History modal's from/to filter)
    const sliced = [manual, lineUsage].map((s) => String(s).slice(0, 10));
    process.stdout.write(
      `LEAD3 ${JSON.stringify({ manual, lineUsage, profitsUsd: profits.total_usd, closingUsd: closing.totalExpensesUSD, byDateUsd: byDate[0]?.expenses_usd, historyModalSlice: sliced })}\n`,
    );
    expect(profits.total_usd).toBe(28);
    expect(closing.totalExpensesUSD).toBe(28);
    expect(byDate[0]?.expenses_usd).toBe(28);
  });

  // Was red (Expected "2026-09-05", Received "2026-09-04") against the raw
  // UTC slice. The History window now filters on the local day of the
  // instant (LIRA-185 lead 3); the durable guard is frontend
  // HistoryModal.businessDayFilter.test.tsx (red first).
  it("the History modal's date filter key for a Line_Usage row booked 01:30 Beirut is the business day it belongs to", () => {
    const lineUsage = "2026-09-04T22:30:00.000Z"; // 01:30 Beirut, 2026-09-05
    // Mirror of HistoryModal.tsx expenseBusinessDay(): the instant's day on
    // the operator's clock — the day every core surface buckets it on.
    const historyFilterKey = offsetLocalDay(Date.parse(lineUsage), BEIRUT);
    expect(historyFilterKey).toBe(D);
  });
});

describe("Lead 4 — Profits Daily tab drops LBP expenses", () => {
  it("getByDate returns expenses_lbp and an LBP net that deducts it (the data the Daily tab now renders)", () => {
    create(0, 3_000_000, `${D}T12:00:00.000Z`, "rent");
    const summary = asBeirut(() => profitRepo.getExpenseTotals(D_FROM, D_TO));
    const byDate = asBeirut(() => profitRepo.getByDate(D, D, D_FROM, D_TO));
    process.stdout.write(
      `LEAD4 ${JSON.stringify({ summaryLbp: summary.total_lbp, byDate: byDate[0] })}\n`,
    );
    expect(summary.total_lbp).toBe(3_000_000);
    expect(byDate[0].expenses_usd).toBe(0);
    expect(byDate[0].expenses_lbp).toBe(3_000_000);
    expect(byDate[0].net_profit_lbp).toBe(-3_000_000);
  });
});

describe("Lead 6 — split-mode expense: what the books take", () => {
  it("a $40 + 900,000 LBP submission (index.tsx:112-125 payload) posts both legs, both to the FIRST line's method drawer", () => {
    // Payload as index.tsx builds it from two lines: line1 $40 CASH,
    // line2 900,000 LBP — paid_by_method is ALWAYS firstLine.method.
    const id = create(40, 900_000, `${D}T12:00:00.000Z`, "split run", "CASH");
    const legs = db
      .prepare(
        `SELECT p.drawer_name, p.currency_code, p.amount FROM payments p
         JOIN transactions t ON t.id = p.transaction_id
         WHERE t.source_table = 'expenses' AND t.source_id = ? ORDER BY p.id`,
      )
      .all(id);
    const closing = asBeirut(() => closingRepo.getDailyActivityStats(D));
    process.stdout.write(
      `LEAD6 ${JSON.stringify({ legs, closingUsd: closing.totalExpensesUSD, closingLbp: closing.totalExpensesLBP })}\n`,
    );
    expect(legs).toHaveLength(2);
    expect(closing.totalExpensesUSD).toBe(40);
    expect(closing.totalExpensesLBP).toBe(900_000);
  });
});

describe("Lead 7 — status != 'voided' vs activeExpense() status = 'active'", () => {
  it("for every status value any writer produces today, the non-refunded rows of getTodayExpenses equal the activeExpense() set", () => {
    const today = offsetLocalDay(Date.now(), BEIRUT);
    const noon = `${today}T12:00:00.000Z`;
    create(10, 0, noon, "active");
    const del = create(20, 0, noon, "deleted");
    asBeirut(() => expenseRepo.deleteExpense(del, USER_ID));
    const statuses = db
      .prepare(`SELECT DISTINCT status FROM expenses ORDER BY status`)
      .all();
    const rows = asBeirut(() => expenseRepo.getTodayExpenses());
    const pageUsd = rows
      .filter((r) => !r.is_refunded)
      .reduce((s, e) => s + (e.amount_usd || 0), 0);
    const profits = asBeirut(() =>
      profitRepo.getExpenseTotals(`${today} 00:00:00`, `${today} 23:59:59`),
    );
    process.stdout.write(
      `LEAD7 ${JSON.stringify({ statuses, pageUsd, profitsUsd: profits.total_usd })}\n`,
    );
    expect(pageUsd).toBe(profits.total_usd);
  });
});
