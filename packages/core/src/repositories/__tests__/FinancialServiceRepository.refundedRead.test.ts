/**
 * FinancialServiceRepository read model drops is_refunded/refunded_at
 * (LIRA-131).
 *
 * Migration v68 added `is_refunded`/`refunded_at` to `financial_services`
 * (among other module source tables), and
 * TransactionRepository._markSourceRefunded sets both on refund/void.
 * `NOT_REFUNDED_SQL` already consumed `is_refunded` internally for the
 * pending-settlement gates, but `getColumns()`/`getSaleCostSettleColumns()`
 * — the plain read-path projections behind `getHistory()`/
 * `getAllByProvider()` — never listed either column, so every plain read
 * silently dropped them before they reached the frontend. That starves TWO
 * surfaces: the OMT/Whish Services page's inline history table
 * (`services/pages/Services/index.tsx`) and the shared
 * `recharge/components/HistoryModal.tsx` (iPick/Katsh/Whish App/Crypto),
 * whose "Refunded" badge is already wired frontend-side, gated on
 * `tx.is_refunded`.
 *
 * Failing-first (rule 17): run against the pre-fix getColumns() (no
 * is_refunded/refunded_at in the SELECT list) — `row.is_refunded` reads
 * back `undefined`, not `1`, so the assertion fails. Mirrors
 * MaintenanceRepository.refundedRead.test.ts.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE financial_services (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER,
      provider                 TEXT NOT NULL,
      service_type             TEXT NOT NULL,
      amount                   DECIMAL(10, 2) NOT NULL,
      currency                 TEXT DEFAULT 'USD' NOT NULL,
      commission               DECIMAL(10, 2) DEFAULT 0,
      cost                     DECIMAL(10, 2) DEFAULT 0,
      price                    DECIMAL(10, 2) DEFAULT 0,
      paid_by                  TEXT DEFAULT 'CASH',
      paid_amount              REAL DEFAULT NULL,
      paid_currency            TEXT DEFAULT NULL,
      client_id                INTEGER,
      client_name              TEXT,
      reference_number         TEXT,
      phone_number             TEXT,
      sender_name              TEXT,
      sender_phone             TEXT,
      receiver_name            TEXT,
      receiver_phone           TEXT,
      sender_client_id         INTEGER,
      receiver_client_id       INTEGER,
      omt_service_type         TEXT,
      omt_fee                  DECIMAL(10, 2) DEFAULT 0,
      whish_fee                DECIMAL(10, 2) DEFAULT 0,
      profit_rate              DECIMAL(6, 5) DEFAULT NULL,
      pay_fee                  INTEGER DEFAULT 0,
      payment_method_fee       DECIMAL(10, 2) DEFAULT 0,
      payment_method_fee_rate  DECIMAL(6, 5) DEFAULT NULL,
      item_key                 TEXT,
      note                     TEXT,
      is_settled               INTEGER NOT NULL DEFAULT 1,
      settled_at               TEXT,
      settlement_id            INTEGER,
      created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by               INTEGER,
      edited_by                TEXT DEFAULT NULL,
      edited_at                TEXT DEFAULT NULL,
      is_refunded              INTEGER DEFAULT 0,
      refunded_at              TEXT DEFAULT NULL,
      partner_id               INTEGER,
      partner_mode             TEXT,
      supplier_debt_booked     INTEGER NOT NULL DEFAULT 0,
      commission_model         INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe("FinancialServiceRepository — is_refunded/refunded_at read model (LIRA-131)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  function insertRow(provider: string, serviceType: string): number {
    const result = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, commission)
         VALUES (1, ?, ?, 100, 'USD', 5)`,
      )
      .run(provider, serviceType);
    return Number(result.lastInsertRowid);
  }

  it("getHistory() returns is_refunded = 1 / refunded_at once the source row is marked refunded — feeds the Services page's inline OMT/Whish table (omt:get-history)", () => {
    const id = insertRow("OMT", "SEND");

    // Mirrors exactly what TransactionRepository._markSourceRefunded does.
    db.prepare(
      `UPDATE financial_services SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
    ).run(id, 1);

    const history = repo.getHistory("OMT");
    const row = history.find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(1);
    expect(row.refunded_at).not.toBeNull();
  });

  it("a never-refunded OMT row reads is_refunded = 0 via getHistory()/findById()", () => {
    const id = insertRow("OMT", "RECEIVE");

    const row = repo.getHistory("OMT").find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(0);
    expect(row.refunded_at).toBeNull();

    const byId = repo.findById(id);
    expect(byId?.is_refunded).toBe(0);
    expect(byId?.refunded_at).toBeNull();
  });

  it("getAllByProvider() surfaces is_refunded/refunded_at for a cost-flow row (iPick/Katsh/Whish App SEND with cost>0) — the getSaleCostSettleColumns() projection feeds the shared recharge/HistoryModal.tsx", () => {
    const id = insertRow("Katsh", "SEND");
    db.prepare(`UPDATE financial_services SET cost = 10 WHERE id = ?`).run(id);
    db.prepare(
      `UPDATE financial_services SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
    ).run(id, 1);

    const rows = repo.getAllByProvider("Katsh");
    const row = rows.find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(1);
    expect(row.refunded_at).not.toBeNull();
  });

  it("getAllByProvider() surfaces is_refunded = 0 for a never-refunded cost-flow row", () => {
    const id = insertRow("iPick", "SEND");
    db.prepare(`UPDATE financial_services SET cost = 10 WHERE id = ?`).run(id);

    const rows = repo.getAllByProvider("iPick");
    const row = rows.find((r) => r.id === id)!;
    expect(row.is_refunded).toBe(0);
    expect(row.refunded_at).toBeNull();
  });
});
