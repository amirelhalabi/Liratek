/**
 * Owner ticket #26 (2026-09-23, verbatim): "track how expences affects the
 * profits page [record expence in the expences page, and check how the
 * profits page is affected- it is not affected]".
 *
 * This drives the REAL write path (`ExpenseRepository.createExpense`, the
 * same repository the Expenses page's IPC handler / REST route calls) with
 * the EXACT shape the frontend form submits, then reads it back through
 * `ProfitRepository.getExpenseTotals` — the query
 * `ProfitService.getSummary` uses to fill the Profits page's "Total
 * Expenses" tile and `net_profit_usd`/`net_profit_lbp`.
 *
 * The frontend form (`frontend/src/features/expenses/pages/Expenses/index.tsx`
 * lines 78/123) defaults `expense_date` to `localDay()` (a plain
 * "YYYY-MM-DD" string, machine-local calendar day) and submits
 * `new Date(formData.expense_date).toISOString()` — which, because
 * `new Date("YYYY-MM-DD")` (a date-ONLY string) is parsed as UTC midnight
 * per the ECMAScript spec, always produces "<that date>T00:00:00.000Z"
 * regardless of what LOCAL time of day the expense was actually entered.
 * That is reproduced verbatim below (not a hand-picked convenient value).
 *
 * `ProfitRepository.dateRange` converts the stored `expense_date` with
 * SQLite's `datetime(col, 'localtime')` — 'localtime' follows the DB
 * PROCESS's own timezone. On desktop that's the shop's machine (Beirut). On
 * web (rule 27, CLAUDE.md) that's the Fly container — Frankfurt, no `TZ` set,
 * i.e. UTC. Both are exercised below via the `TZ` env var, matching how this
 * repo's own jest script pins `TZ=Asia/Beirut` for "desktop" and how the web
 * deploy runs with none set (`TZ` unset == UTC on the container).
 *
 * RESULT (see the two `it` blocks below, run and read — not assumed):
 * `getExpenseTotals` correctly picks up a same-day expense under BOTH
 * timezones — the write and read boundary happen to coincide at midnight
 * regardless of offset sign for Beirut's positive UTC+3 offset, so this is
 * NOT where owner ticket #26 breaks. Kept as a permanent regression guard
 * (rule 27 — this shape has broken before and could again) plus documented
 * evidence for the report: #26 is NOT a `packages/core` date-range defect.
 */

import Database from "better-sqlite3";
import {
  ExpenseRepository,
  resetExpenseRepository,
} from "../ExpenseRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  ProfitRepository,
  resetProfitRepository,
} from "../ProfitRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const USER_ID = 9;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER DEFAULT 1,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL,
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER,
      partner_id         INTEGER NOT NULL,
      transaction_type   TEXT NOT NULL,
      reference_table    TEXT,
      reference_id       INTEGER,
      amount             REAL NOT NULL,
      currency           TEXT NOT NULL DEFAULT 'USD',
      direction          TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes              TEXT,
      user_id            INTEGER,
      settlement_method  TEXT CHECK(settlement_method IN ('CASH', 'OMT', 'WHISH', 'BINANCE', 'CLIENT_ACCOUNT')),
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount     REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE expenses (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER,
      description    TEXT,
      category       TEXT,
      expense_type   TEXT,
      amount_usd     REAL,
      amount_lbp     REAL,
      paid_by_method TEXT DEFAULT 'CASH',
      status         TEXT NOT NULL DEFAULT 'active',
      expense_date   TEXT DEFAULT CURRENT_TIMESTAMP,
      note           TEXT DEFAULT NULL,
      edited_by      TEXT DEFAULT NULL,
      edited_at      TEXT DEFAULT NULL,
      is_refunded    INTEGER DEFAULT 0,
      refunded_at    TEXT DEFAULT NULL,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("ProfitRepository.getExpenseTotals — a real Expenses-page entry reaches the Profits page (owner #26)", () => {
  let db: Database.Database;
  let expenseRepo: ExpenseRepository;
  let profitRepo: ProfitRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetExpenseRepository();
    resetTransactionRepository();
    resetProfitRepository();
    expenseRepo = new ExpenseRepository();
    new TransactionRepository(); // registers the singleton createExpense() calls into
    profitRepo = new ProfitRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetExpenseRepository();
    resetTransactionRepository();
    resetProfitRepository();
    resetTenantContext();
  });

  /** The EXACT frontend shape: localDay() default, then
   *  new Date(dateOnlyString).toISOString() at submit. */
  function frontendExpenseDate(): string {
    const now = new Date();
    const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return new Date(localDay).toISOString();
  }

  it(`records a $25 expense today (process TZ=${process.env.TZ ?? "unset"}) and confirms getExpenseTotals' "today" window picks it up`, () => {
    const expenseDate = frontendExpenseDate();

    expenseRepo.createExpense(
      {
        description: "Office supplies",
        category: "Misc",
        paid_by_method: "CASH",
        amount_usd: 25,
        amount_lbp: 0,
        expense_date: expenseDate,
      },
      USER_ID,
    );

    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const totals = profitRepo.getExpenseTotals(
      `${todayLocal} 00:00:00`,
      `${todayLocal} 23:59:59`,
    );

    expect(totals.total_usd).toBeCloseTo(25, 2);
    expect(totals.count).toBe(1);
  });

  it("the default Profits page range (last 30 days to today) also picks it up", () => {
    const expenseDate = frontendExpenseDate();
    expenseRepo.createExpense(
      {
        description: "Office supplies",
        category: "Misc",
        paid_by_method: "CASH",
        amount_usd: 25,
        amount_lbp: 0,
        expense_date: expenseDate,
      },
      USER_ID,
    );

    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);
    const d30Local = `${d30.getFullYear()}-${String(d30.getMonth() + 1).padStart(2, "0")}-${String(d30.getDate()).padStart(2, "0")}`;

    const totals = profitRepo.getExpenseTotals(
      `${d30Local} 00:00:00`,
      `${todayLocal} 23:59:59`,
    );
    expect(totals.total_usd).toBeCloseTo(25, 2);
  });
});
