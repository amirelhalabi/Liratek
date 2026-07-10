/**
 * DebtRepository.findClientHistory must return session_id.
 *
 * getColumns() is an explicit column list (not SELECT *) — adding a column to
 * the debt_ledger schema without adding it here silently drops it from every
 * read, even though the write path stores it correctly. This exact gap let
 * a "Session Debt" row round-trip through insertBasketDebt with session_id
 * set, only for the Debts page to receive `undefined` and never render the
 * item-detail button (caught via manual e2e verification, not a unit test —
 * the SessionPaymentRepository test suite asserts the write via raw SQL and
 * never exercises this read path).
 *
 * Runs against an in-memory SQLite DB injected via the connection test hook
 * (globalThis.__LIRATEK_TEST_DB__), same pattern as SessionPaymentService.basket.test.ts.
 */

import Database from "better-sqlite3";
import {
  getDebtRepository,
  resetDebtRepository,
} from "../DebtRepository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE clients (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      due_date         TEXT,
      note             TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by       INTEGER,
      edited_by        TEXT,
      edited_at        TEXT,
      session_id       INTEGER,
      tenant_id        INTEGER DEFAULT 1
    );
  `);
  return db;
}

describe("DebtRepository.findClientHistory — session_id column", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    resetDebtRepository();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("includes session_id on a 'Session Debt' row", () => {
    const clientId = Number(
      db
        .prepare("INSERT INTO clients (full_name) VALUES ('E2E Client')")
        .run().lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, session_id)
       VALUES (?, 'Session Debt', 35, 0, 'Session #7 basket', 7)`,
    ).run(clientId);

    const history = getDebtRepository().findClientHistory(clientId);

    expect(history).toHaveLength(1);
    expect(history[0].session_id).toBe(7);
  });
});
