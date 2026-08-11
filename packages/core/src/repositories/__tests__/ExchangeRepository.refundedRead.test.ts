/**
 * ExchangeRepository read model drops is_refunded/refunded_at (LIRA-131).
 *
 * Migration v68 added `is_refunded`/`refunded_at` to `exchange_transactions`
 * (among other module source tables), and
 * TransactionRepository._markSourceRefunded sets both on refund/void. But
 * ExchangeRepository.getColumns() never listed them, so every read
 * (getHistory, findById, findAll) silently dropped the columns before they
 * reached the frontend — the Exchange history modal's "Refunded" badge
 * (already wired frontend-side,
 * `exchange/pages/Exchange/components/HistoryModal.tsx`, gated on
 * `tx.is_refunded`) stayed dormant forever.
 *
 * Failing-first (rule 17): run against the pre-fix getColumns() (no
 * is_refunded/refunded_at in the SELECT list) — `row.is_refunded` reads back
 * `undefined`, not `1`, so the assertion fails. Mirrors
 * MaintenanceRepository.refundedRead.test.ts.
 */

import Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE exchange_transactions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER,
      type             TEXT NOT NULL,
      from_currency    TEXT NOT NULL,
      to_currency      TEXT NOT NULL,
      amount_in        DECIMAL(15, 2) NOT NULL,
      amount_out       DECIMAL(15, 2) NOT NULL,
      rate             DECIMAL(15, 2) NOT NULL,
      base_rate        DECIMAL(15, 2),
      profit_usd       DECIMAL(15, 2),
      leg1_rate        REAL,
      leg1_market_rate REAL,
      leg1_profit_usd  REAL,
      leg2_rate        REAL,
      leg2_market_rate REAL,
      leg2_profit_usd  REAL,
      via_currency     TEXT,
      client_name      TEXT,
      note             TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by       INTEGER,
      edited_by        TEXT DEFAULT NULL,
      edited_at        TEXT DEFAULT NULL,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL
    );
  `);
  return db;
}

describe("ExchangeRepository — is_refunded/refunded_at read model (LIRA-131)", () => {
  let db: Database.Database;
  let repo: ExchangeRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new ExchangeRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  function insertExchange(): number {
    const result = db
      .prepare(
        `INSERT INTO exchange_transactions (tenant_id, type, from_currency, to_currency, amount_in, amount_out, rate)
         VALUES (1, 'SELL', 'USD', 'LBP', 100, 8950000, 89500)`,
      )
      .run();
    return Number(result.lastInsertRowid);
  }

  it("getHistory() returns is_refunded = 1 / refunded_at once the source row is marked refunded", () => {
    const id = insertExchange();

    // Mirrors exactly what TransactionRepository._markSourceRefunded does.
    db.prepare(
      `UPDATE exchange_transactions SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
    ).run(id, 1);

    const history = repo.getHistory();
    const row = history.find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(1);
    expect(row.refunded_at).not.toBeNull();
  });

  it("a never-refunded exchange reads is_refunded = 0 via getHistory()/findById()", () => {
    const id = insertExchange();

    const row = repo.getHistory().find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(0);
    expect(row.refunded_at).toBeNull();

    const byId = repo.findById(id);
    expect(byId?.is_refunded).toBe(0);
    expect(byId?.refunded_at).toBeNull();
  });
});
