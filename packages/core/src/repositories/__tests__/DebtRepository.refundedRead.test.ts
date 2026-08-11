/**
 * DebtRepository read model drops is_refunded/refunded_at (LIRA-131).
 *
 * Migration v68 added `is_refunded`/`refunded_at` to `debt_ledger` (among
 * other module source tables), and
 * TransactionRepository._markSourceRefunded sets both on refund/void. But
 * DebtRepository.getColumns() never listed them, so every read
 * (findClientHistory, findById, findAll) silently dropped the columns
 * before they reached the frontend — the Debts page's "Refunded" badge
 * (already wired frontend-side, `debts/pages/Debts/index.tsx`, gated on
 * `item.is_refunded`) stayed dormant forever.
 *
 * Failing-first (rule 17): run against the pre-fix getColumns() (no
 * is_refunded/refunded_at in the SELECT list) — `row.is_refunded` reads back
 * `undefined`, not `1`, so the assertion fails. Mirrors
 * MaintenanceRepository.refundedRead.test.ts.
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE debt_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER,
      client_id         INTEGER NOT NULL,
      transaction_type  TEXT NOT NULL,
      amount_usd        DECIMAL(10, 2),
      amount_lbp        DECIMAL(15, 2),
      transaction_id    INTEGER,
      due_date          TEXT,
      note              TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by        INTEGER,
      edited_by         TEXT DEFAULT NULL,
      edited_at         TEXT DEFAULT NULL,
      is_refunded       INTEGER DEFAULT 0,
      refunded_at       TEXT DEFAULT NULL,
      session_id        INTEGER,
      covered_usd       REAL NOT NULL DEFAULT 0,
      covered_lbp       REAL NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe("DebtRepository — is_refunded/refunded_at read model (LIRA-131)", () => {
  let db: Database.Database;
  let repo: DebtRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new DebtRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  function insertDebtRow(clientId: number): number {
    const result = db
      .prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp)
         VALUES (1, ?, 'Sale Debt', 20, 0)`,
      )
      .run(clientId);
    return Number(result.lastInsertRowid);
  }

  it("findClientHistory() returns is_refunded = 1 / refunded_at once the source row is marked refunded", () => {
    const id = insertDebtRow(7);

    // Mirrors exactly what TransactionRepository._markSourceRefunded does.
    db.prepare(
      `UPDATE debt_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
    ).run(id, 1);

    const history = repo.findClientHistory(7);
    const row = history.find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(1);
    expect(row.refunded_at).not.toBeNull();
  });

  it("a never-refunded debt entry reads is_refunded = 0 via findClientHistory()/findById()", () => {
    const id = insertDebtRow(8);

    const row = repo.findClientHistory(8).find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(0);
    expect(row.refunded_at).toBeNull();

    const byId = repo.findById(id);
    expect(byId?.is_refunded).toBe(0);
    expect(byId?.refunded_at).toBeNull();
  });
});
