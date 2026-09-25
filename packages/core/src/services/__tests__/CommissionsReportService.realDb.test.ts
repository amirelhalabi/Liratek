/**
 * CommissionsReportService over a REAL in-memory ProfitRepository —
 * OWNER_NOTES_2026-09-21.md §6 lane LC, PA-2.7 and PA-3.4.
 *
 * Why this file exists (rule-17 proof pass, 2026-09-24): the sibling
 * `CommissionsReportService.test.ts` mocks `getFinancialSettledByProvider`,
 * so PA-2.7 ("Realized excludes every settled model-1 commission") and
 * PA-3.4 ("Commissions applies no recognition gates at all") were only
 * "proven by construction" there — no assertion in that file can go red if
 * the Commissions tab's realized figure stops carrying settlement-time
 * commission or stops honouring the Overview's gates. This file drives the
 * service through the real repository query on one fixture, so it does.
 *
 * RED observed (each mutation applied alone to ProfitRepository
 * .getFinancialSettledByProvider, then reverted byte-identically):
 *   - allocation arm neutralised (`AND 1=0` in its WHERE — dropping the arm
 *     text outright only produces a bind-arity RangeError, the wrong reason)
 *     — reproduces PA-2.7: "a model-1 cashless settlement's commission
 *     reaches realized_usd" Expected: 3  Received: 0
 *   - `AND ${notRefunded("fs")}` dropped from the base arm — reproduces
 *     PA-3.4 (refund gate): OMT realized_usd Expected: 4  Received: 9
 *   - `AND t.status = 'ACTIVE'` dropped from the base arm — reproduces PA-3.4
 *     (void gate): OMT realized_usd Expected: 4  Received: 11
 *   - `AND ${notDebtPending("t.id")}` dropped from the base arm — reproduces
 *     PA-3.4 (debt-pending gate): OMT realized_usd Expected: 4  Received: 17
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../../repositories/ProfitRepository";
import type { FinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { CommissionsReportService } from "../CommissionsReportService";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-07-01 10:00:00";
const DAY = "2026-07-01";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      client_id INTEGER,
      client_name TEXT,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      commission_model INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      settlement_id INTEGER DEFAULT NULL,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL,
      covered_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      is_refunded INTEGER DEFAULT 0,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedFs(
  db: Database.Database,
  row: {
    provider: string;
    commissionModel: number;
    isSettled: number;
    isRefunded?: number;
    status?: string;
    profitUsd: number;
  },
): { fsId: number; txnId: number } {
  const fs = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, service_type, amount, currency, commission,
          commission_model, is_settled, is_refunded, created_at)
       VALUES (1, ?, 'SEND', 100, 'USD', ?, ?, ?, ?, ?)`,
    )
    .run(
      row.provider,
      row.profitUsd,
      row.commissionModel,
      row.isSettled,
      row.isRefunded ?? 0,
      D,
    );
  const fsId = Number(fs.lastInsertRowid);
  const txn = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id,
          amount_usd, profit_usd, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', ?, 'financial_services', ?, 1, 100, ?, ?)`,
    )
    .run(row.status ?? "ACTIVE", fsId, row.profitUsd, D);
  return { fsId, txnId: Number(txn.lastInsertRowid) };
}

const emptyFsRepo = {
  getUnsettledSummaryByProvider: () => [],
} as unknown as FinancialServiceRepository;

function withReport(
  seed: (db: Database.Database) => void,
  assert: (report: ReturnType<CommissionsReportService["getReport"]>) => void,
): void {
  const db = new Database(":memory:");
  createSchema(db);
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  try {
    seed(db);
    const service = new CommissionsReportService(
      new ProfitRepository(),
      emptyFsRepo,
    );
    const report = runWithTenant(1, () => service.getReport(DAY, DAY));
    assert(report);
  } finally {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  }
}

describe("CommissionsReportService over the real ProfitRepository (PA-2.7 / PA-3.4)", () => {
  it("PA-2.7: a model-1 cashless settlement's commission reaches realized_usd", () => {
    withReport(
      (db) => {
        // Post-cutover WHISH transfer: born unsettled, commission unknown
        // at creation (stamp 0), real commission entered at settlement.
        const { fsId } = seedFs(db, {
          provider: "WHISH",
          commissionModel: 1,
          isSettled: 1,
          profitUsd: 0,
        });
        db.prepare(
          `UPDATE financial_services SET settlement_id = 1 WHERE id = ?`,
        ).run(fsId);
        db.prepare(
          `INSERT INTO settlement_commission_allocations
             (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
           VALUES (1, 1, ?, 'SEND', 'WHISH', 3, 0, ?)`,
        ).run(fsId, D);
      },
      (report) => {
        const whish = report.byProvider.find((r) => r.provider === "WHISH");
        expect(whish?.realized_usd).toBe(3);
        expect(report.realized_usd).toBe(3);
      },
    );
  });

  it("PA-3.4: refunded, voided and debt-pending rows are excluded; only the clean legacy row counts", () => {
    withReport(
      (db) => {
        // The one row that SHOULD count: settled legacy OMT, $4.
        seedFs(db, {
          provider: "OMT",
          commissionModel: 0,
          isSettled: 1,
          profitUsd: 4,
        });
        // Refunded (fs.is_refunded = 1): $5 — must not count.
        seedFs(db, {
          provider: "OMT",
          commissionModel: 0,
          isSettled: 1,
          isRefunded: 1,
          profitUsd: 5,
        });
        // Voided transaction: $7 — must not count.
        seedFs(db, {
          provider: "OMT",
          commissionModel: 0,
          isSettled: 1,
          status: "VOIDED",
          profitUsd: 7,
        });
        // Charged to the client's account and not yet repaid: $13 — must
        // not count until the client repays.
        const debt = seedFs(db, {
          provider: "OMT",
          commissionModel: 0,
          isSettled: 1,
          profitUsd: 13,
        });
        db.prepare(
          `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, transaction_id, covered_usd, created_at)
           VALUES (1, 1, 'Service Debt', 100, ?, 0, ?)`,
        ).run(debt.txnId, D);
      },
      (report) => {
        const omt = report.byProvider.find((r) => r.provider === "OMT");
        expect(omt?.realized_usd).toBe(4);
        expect(report.realized_usd).toBe(4);
      },
    );
  });
});
