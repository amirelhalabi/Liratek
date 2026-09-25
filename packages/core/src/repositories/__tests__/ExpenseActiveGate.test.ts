/**
 * Rule 14 regression — the shared "active expense" predicate
 * (`ProfitRepository.activeExpense`, added alongside LIRA-145's adversarial
 * review) must gate EVERY reporting read of the `expenses` table, not just
 * `ProfitRepository.getExpenseTotals` (which already had it).
 *
 * VERIFIED BUG (pre-fix): `ClosingRepository.getDailyStatsSnapshot()`
 * (renamed `getDailyActivityStats(day)` under LIRA-219, which moved all
 * profit SQL out of this repository — see `ClosingService
 * .profitParity.test.ts` — but kept its own expense query, still gated the
 * same way) summed the `expenses` table with NO active/refunded gate at
 * all — every voided or refunded expense stayed in the closing snapshot
 * forever, even after its drawer leg had already been given back by the
 * generic void path (rule 20). `FinancialRepository.getMonthlyPL()` had the
 * identical bug and was ALSO covered here; it was deleted as dead code
 * (DAY-2, OWNER_NOTES_2026-09-21.md:1051 — no product/UI caller ever read
 * it), taking its half of this file with it.
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
import { resetProfitRepository } from "../ProfitRepository.js";
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
      -- LIRA-159: required by ProfitRepository's notDebtPending (DBT-1),
      -- read unconditionally by getRealizedCommissionTotals AND
      -- allocationNotDebtPending (getSupplierCommissionTotals's cashless
      -- bucket) — left over from when this fixture also exercised
      -- FinancialRepository.getMonthlyPL (deleted, DAY-2). Left at their
      -- DEFAULT 0 everywhere in this file (no row is ever inserted here),
      -- so the NOT EXISTS gate passes every row unchanged.
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- LIRA-159: required (even empty) by ProfitRepository's notPartnerPending
    -- (PFT-6), read unconditionally by getRealizedCommissionTotals AND
    -- getSupplierCommissionTotals's cashless bucket — left over from when
    -- this fixture also exercised FinancialRepository.getMonthlyPL (deleted,
    -- DAY-2). This table did not exist at all in this fixture before; every
    -- test in this file leaves it empty, so the NOT EXISTS gate passes every
    -- row.
    --
    -- NOT actually empty at runtime, though: this file's own
    -- seedThreeExpenses() drives TransactionRepository.voidTransaction
    -- directly (the refundedViaTxnVoid door), and its generic reversal path
    -- (_reversePartnerLedger / _unwindPartnerSettlementCoverage,
    -- TransactionRepository.ts) unconditionally INSERTs INTO partner_ledger
    -- with the FULL production column list — so this fixture must carry every
    -- column those INSERTs write, not just what notPartnerPending reads.
    -- Column set matches the newest partner_ledger migration (v127's rebuild
    -- + v128's covered_amount, packages/core/src/db/migrations/index.ts:6284)
    -- and electron-app/create_db.sql's own definition verbatim.
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

    -- Minimal empty fixtures for the OTHER modules
    -- ClosingRepository.getDailyStatsSnapshot aggregates — every test in
    -- this file leaves them empty, so each module's own contribution is
    -- always 0 and only the expenses figure is exercised.
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
      -- LIRA-159: required by getRealizedCommissionTotals's unconditional
      -- WHERE fs.is_settled = 1 (unlike commission_model, this column has
      -- no schema-drift PRAGMA guard) — left over from when this fixture
      -- also exercised FinancialRepository.getMonthlyPL (deleted, DAY-2). No
      -- row is ever inserted into this table in this file, so the DEFAULT
      -- is never exercised either way.
      is_settled   INTEGER NOT NULL DEFAULT 1,
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
      is_refunded   INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE custom_services (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER DEFAULT 1,
      status      TEXT NOT NULL DEFAULT 'completed',
      profit_usd  REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER DEFAULT 1,
      status            TEXT NOT NULL DEFAULT 'completed',
      final_amount_usd  REAL NOT NULL DEFAULT 0,
      cost_usd          REAL NOT NULL DEFAULT 0,
      is_refunded       INTEGER DEFAULT 0,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
    ,
  parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
);

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

  `);
  return db;
}

describe("Expense active-gate (rule 14 / rule 20) — Closing reporting", () => {
  let db: Database.Database;
  let expenseRepo: ExpenseRepository;
  let txnRepo: TransactionRepository;
  let closingRepo: ClosingRepository;

  /** A real "now" so every date-bucketed query (`todayLocal`) sees the same
   *  calendar day — TZ is pinned to Asia/Beirut by the jest script, and
   *  Node's own Date getters respect that, matching SQLite's own
   *  `'localtime'` modifier. */
  const NOW = new Date();
  const TODAY_ISO = NOW.toISOString();
  // LIRA-219: `ClosingRepository.getDailyActivityStats` now takes `day`
  // explicitly instead of asking SQLite for `DATE('now','localtime')`
  // itself — this is the same local calendar day, built from the same
  // TZ-pinned `NOW` the rest of this file already uses.
  const TODAY_DAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}-${String(NOW.getDate()).padStart(2, "0")}`;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetExpenseRepository();
    resetTransactionRepository();
    resetClosingRepository();
    // ProfitRepository is a SINGLETON (getProfitRepository()) whose schema
    // probes are memoized PER INSTANCE — reset it alongside the other
    // singletons above so it is always (re)constructed against THIS test's
    // fresh db, never a stale instance left over from another test/file.
    resetProfitRepository();
    expenseRepo = new ExpenseRepository();
    txnRepo = new TransactionRepository();
    closingRepo = new ClosingRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetExpenseRepository();
    resetTransactionRepository();
    resetClosingRepository();
    resetProfitRepository();
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

  it("ClosingRepository.getDailyActivityStats excludes a status='voided' expense AND an is_refunded=1 expense, while still counting a plain active one", () => {
    seedThreeExpenses({ activeUsd: 10, voidedUsd: 20, refundedUsd: 30 });

    const snapshot = closingRepo.getDailyActivityStats(TODAY_DAY);

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
});
