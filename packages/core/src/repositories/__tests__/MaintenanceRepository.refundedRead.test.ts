/**
 * MaintenanceRepository read model drops is_refunded/refunded_at.
 *
 * Migration v68 added `is_refunded`/`refunded_at` to `maintenance` (among
 * other module source tables), and TransactionRepository._markSourceRefunded
 * sets both on refund/void. But MaintenanceRepository.getColumns() never
 * listed them, so every read (getJobs, findById) silently dropped the
 * columns before they reached the frontend — the jobs-list and HistoryModal
 * "Refunded" badges (already wired frontend-side) stayed dormant forever.
 *
 * Failing-first (rule 17): run against the pre-fix getColumns() (no
 * is_refunded/refunded_at in the SELECT list) — `row.is_refunded` reads back
 * `undefined`, not `1`, so the assertion fails.
 */

import Database from "better-sqlite3";
import { MaintenanceRepository } from "../MaintenanceRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE maintenance (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER,
      client_id         INTEGER,
      client_name       TEXT,
      device_name       TEXT NOT NULL,
      issue_description TEXT,
      cost_usd          DECIMAL(10, 2) DEFAULT 0,
      price_usd         DECIMAL(10, 2) DEFAULT 0,
      cost_lbp          DECIMAL(15, 2) DEFAULT 0,
      price_lbp         DECIMAL(15, 2) DEFAULT 0,
      discount_usd      DECIMAL(10, 2) DEFAULT 0,
      final_amount_usd  DECIMAL(10, 2) DEFAULT 0,
      final_amount_lbp  DECIMAL(15, 2) DEFAULT 0,
      currency          TEXT NOT NULL DEFAULT 'USD',
      paid_usd          DECIMAL(10, 2) DEFAULT 0,
      paid_lbp          DECIMAL(15, 2) DEFAULT 0,
      exchange_rate     DECIMAL(15, 2),
      status            TEXT DEFAULT 'Received',
      paid_by           TEXT DEFAULT 'CASH',
      note              TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by         TEXT DEFAULT NULL,
      edited_at         TEXT DEFAULT NULL,
      is_refunded       INTEGER DEFAULT 0,
      refunded_at       TEXT DEFAULT NULL
    );
  `);
  return db;
}

describe("MaintenanceRepository — is_refunded/refunded_at read model", () => {
  let db: Database.Database;
  let repo: MaintenanceRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new MaintenanceRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  it("getJobs() returns is_refunded = 1 / refunded_at once the source row is marked refunded", () => {
    const jobId = repo.createJob({
      device_name: "iPhone 12",
      price_usd: 20,
      final_amount_usd: 20,
    });

    // Mirrors exactly what TransactionRepository._markSourceRefunded does.
    db.prepare(
      `UPDATE maintenance SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
    ).run(jobId, 1);

    const jobs = repo.getJobs();
    const row = jobs.find((j) => j.id === jobId)!;
    expect(row.is_refunded).toBe(1);
    expect(row.refunded_at).not.toBeNull();
  });

  it("a never-refunded job reads is_refunded = 0", () => {
    const jobId = repo.createJob({ device_name: "Samsung S21" });
    const row = repo.getJobs().find((j) => j.id === jobId)!;
    expect(row.is_refunded).toBe(0);
    expect(row.refunded_at).toBeNull();
  });
});
