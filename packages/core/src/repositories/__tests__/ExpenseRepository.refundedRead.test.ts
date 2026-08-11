/**
 * ExpenseRepository read model drops is_refunded/refunded_at (LIRA-131).
 *
 * Migration v68 added `is_refunded`/`refunded_at` to `expenses` (among other
 * module source tables), and TransactionRepository._markSourceRefunded sets
 * both on refund/void. But ExpenseRepository.getColumns() never listed
 * them, so every read (getTodayExpenses, findById, findAll) silently
 * dropped the columns before they reached the frontend — the Expenses
 * history modal's "Refunded" badge (already wired frontend-side,
 * `expenses/pages/Expenses/components/HistoryModal.tsx`, gated on
 * `expense.is_refunded`) stayed dormant forever.
 *
 * Failing-first (rule 17): run against the pre-fix getColumns() (no
 * is_refunded/refunded_at in the SELECT list) — `row.is_refunded` reads back
 * `undefined`, not `1`, so the assertion fails. Mirrors
 * MaintenanceRepository.refundedRead.test.ts.
 */

import Database from "better-sqlite3";
import { ExpenseRepository } from "../ExpenseRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE expenses (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER,
      description      TEXT,
      category         TEXT,
      expense_type     TEXT,
      amount_usd       DECIMAL(10, 2),
      amount_lbp       DECIMAL(15, 2),
      paid_by_method   TEXT DEFAULT 'CASH',
      status           TEXT NOT NULL DEFAULT 'active',
      expense_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
      note             TEXT DEFAULT NULL,
      edited_by        TEXT DEFAULT NULL,
      edited_at        TEXT DEFAULT NULL,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("ExpenseRepository — is_refunded/refunded_at read model (LIRA-131)", () => {
  let db: Database.Database;
  let repo: ExpenseRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new ExpenseRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  function insertExpense(): number {
    const result = db
      .prepare(
        `INSERT INTO expenses (tenant_id, description, category, amount_usd, amount_lbp, expense_date)
         VALUES (1, 'Shop supplies', 'Shop_Supply', 25, 0, DATE('now'))`,
      )
      .run();
    return Number(result.lastInsertRowid);
  }

  it("getTodayExpenses() returns is_refunded = 1 / refunded_at once the source row is marked refunded", () => {
    const id = insertExpense();

    // Mirrors exactly what TransactionRepository._markSourceRefunded does.
    db.prepare(
      `UPDATE expenses SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
    ).run(id, 1);

    const today = repo.getTodayExpenses();
    const row = today.find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(1);
    expect(row.refunded_at).not.toBeNull();
  });

  it("a never-refunded expense reads is_refunded = 0 via getTodayExpenses()/getExpenseById()", () => {
    const id = insertExpense();

    const row = repo.getTodayExpenses().find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(0);
    expect(row.refunded_at).toBeNull();

    const byId = repo.getExpenseById(id);
    expect(byId?.is_refunded).toBe(0);
    expect(byId?.refunded_at).toBeNull();
  });
});
