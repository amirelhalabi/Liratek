/**
 * RechargeRepository read model drops is_refunded/refunded_at (LIRA-131).
 *
 * Migration v68 added `is_refunded`/`refunded_at` to `recharges` (among other
 * module source tables), and TransactionRepository._markSourceRefunded sets
 * both on refund/void. But RechargeRepository.getColumns() never listed
 * them, so every read (getHistory, findById, findAll) silently dropped the
 * columns before they reached the frontend — the Recharge history modal's
 * "Refunded" badge (already wired frontend-side,
 * `recharge/components/HistoryModal.tsx`, gated on `tx.is_refunded`) stayed
 * dormant forever.
 *
 * Failing-first (rule 17): run against the pre-fix getColumns() (no
 * is_refunded/refunded_at in the SELECT list) — `row.is_refunded` reads back
 * `undefined`, not `1`, so the assertion fails. Mirrors
 * MaintenanceRepository.refundedRead.test.ts, the module that already got
 * this right.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE recharges (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id               INTEGER,
      carrier                 TEXT NOT NULL,
      recharge_type           TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      amount                  DECIMAL(10, 2) NOT NULL,
      cost                    DECIMAL(10, 2) NOT NULL DEFAULT 0,
      price                   DECIMAL(10, 2) NOT NULL DEFAULT 0,
      default_price_to_client REAL DEFAULT NULL,
      currency_code           TEXT NOT NULL DEFAULT 'USD',
      paid_by                 TEXT DEFAULT 'CASH',
      phone_number            TEXT,
      client_id               INTEGER,
      client_name             TEXT,
      note                    TEXT,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by              INTEGER DEFAULT 1,
      edited_by                TEXT DEFAULT NULL,
      edited_at                TEXT DEFAULT NULL,
      is_refunded              INTEGER DEFAULT 0,
      refunded_at              TEXT DEFAULT NULL
    );
  `);
  return db;
}

describe("RechargeRepository — is_refunded/refunded_at read model (LIRA-131)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new RechargeRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  function insertRecharge(): number {
    const result = db
      .prepare(
        `INSERT INTO recharges (tenant_id, carrier, recharge_type, amount, cost, price, currency_code, created_by)
         VALUES (1, 'MTC', 'CREDIT_TRANSFER', 10, 8, 10, 'USD', 1)`,
      )
      .run();
    return Number(result.lastInsertRowid);
  }

  it("getHistory() returns is_refunded = 1 / refunded_at once the source row is marked refunded", () => {
    const id = insertRecharge();

    // Mirrors exactly what TransactionRepository._markSourceRefunded does.
    db.prepare(
      `UPDATE recharges SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
    ).run(id, 1);

    const history = repo.getHistory("MTC");
    const row = history.find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(1);
    expect(row.refunded_at).not.toBeNull();
  });

  it("a never-refunded recharge reads is_refunded = 0 via getHistory()/findById()", () => {
    const id = insertRecharge();

    const row = repo.getHistory("MTC").find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(0);
    expect(row.refunded_at).toBeNull();

    const byId = repo.findById(id);
    expect(byId?.is_refunded).toBe(0);
    expect(byId?.refunded_at).toBeNull();
  });
});
