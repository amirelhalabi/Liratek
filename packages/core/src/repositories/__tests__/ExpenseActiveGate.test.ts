/**
 * Rule 14 regression — the shared "active expense" predicate
 * (`ProfitRepository.activeExpense`, added alongside LIRA-145's adversarial
 * review) must gate EVERY reporting read of the `expenses` table, not just
 * `ProfitRepository.getExpenseTotals` (which already had it).
 *
 * VERIFIED BUG (pre-fix): both `ClosingRepository.getDailyStatsSnapshot()`
 * and `FinancialRepository.getMonthlyPL()` summed the `expenses` table with
 * NO active/refunded gate at all — every voided or refunded expense stayed
 * in the closing snapshot and the monthly P&L forever, even after its drawer
 * leg had already been given back by the generic void path (rule 20).
 *
 * An expense can be undone through TWO different doors, each flipping a
 * DIFFERENT column, so both must be exercised:
 *   (i)  `ExpenseRepository.deleteExpense` (the Expenses page) — sets
 *        `expenses.status = 'voided'` AND voids the unified transaction.
 *   (ii) A void driven from the Transactions viewer — calling
 *        `TransactionRepository.voidTransaction` directly on the expense's
 *        unified transaction — reverses the drawer leg and sets
 *        `expenses.is_refunded = 1` via `_markSourceRefunded`, but never
 *        touches `status`.
 *
 * Both tests below drive the reversal through the REAL repositories
 * (`ExpenseRepository.createExpense` + either `ExpenseRepository
 * .deleteExpense` or a direct `TransactionRepository.voidTransaction` call)
 * rather than hand-writing UPDATEs, so the fixture proves the actual
 * production column combination each door leaves behind.
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
  ClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository.js";
import { FinancialRepository } from "../FinancialRepository.js";
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
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
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

    -- Minimal empty fixtures for the OTHER modules
    -- ClosingRepository.getDailyStatsSnapshot / FinancialRepository.getMonthlyPL
    -- aggregate — every test in this file leaves them empty, so each module's
    -- own contribution is always 0 and only the expenses figure is exercised.
    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER DEFAULT 1,
      status                 TEXT NOT NULL DEFAULT 'completed',
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER DEFAULT 1,
      sale_id                  INTEGER NOT NULL,
      sold_price_usd           REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd  REAL NOT NULL DEFAULT 0,
      is_refunded              INTEGER NOT NULL DEFAULT 0,
      created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER DEFAULT 1,
      currency     TEXT NOT NULL DEFAULT 'USD',
      commission   REAL NOT NULL DEFAULT 0,
      is_refunded  INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      price         REAL NOT NULL DEFAULT 0,
      cost          REAL NOT NULL DEFAULT 0,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE custom_services (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER DEFAULT 1,
      status      TEXT NOT NULL DEFAULT 'completed',
      profit_usd  REAL NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER DEFAULT 1,
      status            TEXT NOT NULL DEFAULT 'completed',
      final_amount_usd  REAL NOT NULL DEFAULT 0,
      cost_usd          REAL NOT NULL DEFAULT 0,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("Expense active-gate (rule 14 / rule 20) — Closing + Financial reporting", () => {
  let db: Database.Database;
  let expenseRepo: ExpenseRepository;
  let txnRepo: TransactionRepository;
  let closingRepo: ClosingRepository;
  let financialRepo: FinancialRepository;

  /** A real "now" so every date-bucketed query (`todayLocal`, the
   *  `strftime('%Y-%m', ...)` month bucket) sees the same calendar day/month
   *  — TZ is pinned to Asia/Beirut by the jest script, and Node's own Date
   *  getters respect that, matching SQLite's own `'localtime'` modifier. */
  const NOW = new Date();
  const TODAY_ISO = NOW.toISOString();
  const THIS_MONTH = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetExpenseRepository();
    resetTransactionRepository();
    resetClosingRepository();
    expenseRepo = new ExpenseRepository();
    txnRepo = new TransactionRepository();
    closingRepo = new ClosingRepository();
    financialRepo = new FinancialRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetExpenseRepository();
    resetTransactionRepository();
    resetClosingRepository();
    resetTenantContext();
  });

  /**
   * Seeds the three-row shape both tests need:
   *   - `active`           — a plain, never-touched expense (must count)
   *   - `voidedViaDelete`  — created, then `ExpenseRepository.deleteExpense`
   *                          (Expenses page door): `status = 'voided'`
   *   - `refundedViaTxnVoid` — created, then `TransactionRepository
   *                          .voidTransaction` called DIRECTLY on its unified
   *                          transaction (Transactions-viewer door, bypassing
   *                          `deleteExpense`): `is_refunded = 1`,
   *                          `status` stays `'active'`
   */
  function seedThreeExpenses(amounts: {
    activeUsd: number;
    voidedUsd: number;
    refundedUsd: number;
    activeLbp?: number;
    voidedLbp?: number;
    refundedLbp?: number;
  }): {
    activeId: number;
    voidedId: number;
    refundedId: number;
  } {
    const create = (amountUsd: number, amountLbp: number, label: string) =>
      expenseRepo.createExpense(
        {
          description: label,
          category: "Misc",
          paid_by_method: "CASH",
          amount_usd: amountUsd,
          amount_lbp: amountLbp,
          expense_date: TODAY_ISO,
        },
        USER_ID,
      );

    const activeId = create(
      amounts.activeUsd,
      amounts.activeLbp ?? 0,
      "active",
    );

    const voidedId = create(
      amounts.voidedUsd,
      amounts.voidedLbp ?? 0,
      "voided-via-delete",
    );
    expenseRepo.deleteExpense(voidedId, USER_ID);

    const refundedId = create(
      amounts.refundedUsd,
      amounts.refundedLbp ?? 0,
      "refunded-via-txn-void",
    );
    const refundedTxn = txnRepo.getBySourceId("expenses", refundedId);
    if (!refundedTxn) {
      throw new Error("test setup: expense was not linked to a transaction");
    }
    txnRepo.voidTransaction(refundedTxn.id, USER_ID);

    return { activeId, voidedId, refundedId };
  }

  it("ClosingRepository.getDailyStatsSnapshot excludes a status='voided' expense AND an is_refunded=1 expense, while still counting a plain active one", () => {
    seedThreeExpenses({ activeUsd: 10, voidedUsd: 20, refundedUsd: 30 });

    const snapshot = closingRepo.getDailyStatsSnapshot();

    expect(snapshot.totalExpensesUSD).toBe(10);
    expect(snapshot.totalExpensesLBP).toBe(0);
  });

  it("verifies the two reversal doors leave the documented column combination (fixture sanity)", () => {
    const { voidedId, refundedId } = seedThreeExpenses({
      activeUsd: 10,
      voidedUsd: 20,
      refundedUsd: 30,
    });

    const voidedRow = expenseRepo.getExpenseById(voidedId)!;
    expect(voidedRow.status).toBe("voided");

    const refundedRow = expenseRepo.getExpenseById(refundedId)!;
    expect(refundedRow.status).toBe("active");
    expect(refundedRow.is_refunded).toBe(1);
  });

  it("FinancialRepository.getMonthlyPL excludes a status='voided' expense AND an is_refunded=1 expense from expensesUSD/expensesLBP and netProfitUSD", () => {
    seedThreeExpenses({
      activeUsd: 15,
      voidedUsd: 25,
      refundedUsd: 35,
      activeLbp: 150_000,
      voidedLbp: 250_000,
      refundedLbp: 350_000,
    });

    const pl = financialRepo.getMonthlyPL(THIS_MONTH);

    expect(pl.expensesUSD).toBe(15);
    expect(pl.expensesLBP).toBe(150_000);
    // netProfitUSD = salesProfit(0) + commissionUSD(0) - expensesUSD(15)
    expect(pl.netProfitUSD).toBe(-15);
    // netProfitLBP = commissionLBP(0) - expensesLBP(150000)
    expect(pl.netProfitLBP).toBe(-150_000);
  });
});
