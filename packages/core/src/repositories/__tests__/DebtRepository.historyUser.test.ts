/**
 * LIRA-241 — Debts page client-history "User" column.
 *
 * Owner decision (2026-09-28): the Debts page's client history table (Date /
 * Note / USD / LBP) gains a "User" column, the same way the Transactions
 * page reports `username` (TransactionRepository.getRecent() LEFT JOINs
 * `users` on `t.user_id` — see that repo's `TransactionWithUser`). This is
 * the same join shape applied to `debt_ledger.created_by`, at the one read
 * path that feeds the Debts page: `DebtRepository.findClientHistory()`
 * (consumed by both the IPC `debt:get-client-history` handler and the REST
 * `GET /api/debts/clients/:clientId/history` route via
 * `DebtService.getClientHistory`) — so the fix lands identically on desktop
 * and web (rule 19).
 *
 * A row with no `created_by` (system-authored, e.g. SalesRepository's
 * pre-existing "Sale Debt" charge before this ticket's fix — see
 * moneyPosting.ts's `bookClientDebtCharge` doc) must read back with NO
 * username so the frontend can render "—", never a crash or a stale/garbage
 * value.
 *
 * FAILING-FIRST (rule 17): pre-fix, `findClientHistory()`'s SELECT never
 * joins `users` at all — `row.created_by_username` reads back `undefined`
 * for EVERY row, including the one with a real `created_by`, so the first
 * assertion below fails pre-fix.
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
    CREATE TABLE users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER,
      username    TEXT NOT NULL
    );

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

describe("DebtRepository.findClientHistory — created_by_username (LIRA-241)", () => {
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

  function insertUser(id: number, username: string): void {
    db.prepare(
      `INSERT INTO users (id, tenant_id, username) VALUES (?, 1, ?)`,
    ).run(id, username);
  }

  function insertDebtRow(
    clientId: number,
    transactionType: string,
    createdBy: number | null,
  ): number {
    const result = db
      .prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, created_by)
         VALUES (1, ?, ?, -20, 0, ?)`,
      )
      .run(clientId, transactionType, createdBy);
    return Number(result.lastInsertRowid);
  }

  it("shows the recording staff user's username on a repayment row", () => {
    insertUser(3, "staffnour");
    const id = insertDebtRow(11, "Repayment", 3);

    const row = repo.findClientHistory(11).find((r) => r.id === id)!;
    expect(row.created_by_username).toBe("staffnour");
  });

  it("reads no username for a row with no created_by (system-authored)", () => {
    const id = insertDebtRow(12, "Sale Debt", null);

    const row = repo.findClientHistory(12).find((r) => r.id === id)!;
    expect(row.created_by_username == null).toBe(true);
  });
});
