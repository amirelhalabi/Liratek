/**
 * LIRA-158 D17 (owner decision, 2026-08-31) applied to Closing's
 * settlement-day cash-basis source (`ClosingRepository.getDailyStatsSnapshot`'s
 * `finProfitSettlement`) — mirrors
 * `ProfitRepository.cashlessSettlementDefersOnDebt.test.ts` exactly (same
 * gates, same partition), applied to the SAME-shaped query in this file
 * instead. See that file's header for the full D17 rationale; this file only
 * proves the Closing surface specifically, since it is a genuinely separate
 * `.prepare()` call from `ProfitRepository`'s (rule 13 — Closing owns its
 * OWN SQL, it never delegates to ProfitRepository at runtime).
 *
 * Fixture note (§5): union of `LIRA158.closingCashBasis.test.ts`'s proven
 * `createFullSchema` (every table `getDailyStatsSnapshot` unconditionally
 * prepares) plus `settlement_commission_allocations`, `partner_ledger`, and
 * `debt_ledger` with the exact columns `allocationNotDebtPending` /
 * `notPartnerPending` read.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: ClosingRepository;

function createFullSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000, status TEXT, created_at TEXT
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER,
      sold_price_usd REAL, cost_price_snapshot_usd REAL, is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL DEFAULT 1, transaction_type TEXT NOT NULL DEFAULT 'Repayment',
      amount_usd REAL, amount_lbp REAL, transaction_id INTEGER, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL
    , covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0);
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      amount_usd REAL, amount_lbp REAL, expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL
    , status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      currency TEXT, commission REAL, commission_model INTEGER NOT NULL DEFAULT 0,
      cost REAL DEFAULT 0, is_settled INTEGER DEFAULT 0, settlement_id INTEGER, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      currency_code TEXT, price REAL, cost REAL, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      profit_usd REAL, status TEXT, created_at TEXT
    );
    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      reverses_id INTEGER,
      created_at TEXT
    );
    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, partner_id INTEGER NOT NULL,
      transaction_type TEXT, reference_table TEXT, reference_id INTEGER, amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD', direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** Pre-v150 shape — no settlement_commission_allocations table at all. */
function createLegacySchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, final_amount_usd REAL, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0, exchange_rate_snapshot REAL DEFAULT 90000, status TEXT, created_at TEXT);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER, sold_price_usd REAL, cost_price_snapshot_usd REAL, is_refunded INTEGER DEFAULT 0);
    CREATE TABLE debt_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_usd REAL, amount_lbp REAL, transaction_type TEXT, created_at TEXT, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_usd REAL, amount_lbp REAL, expense_date TEXT, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE financial_services (supplier_debt_booked INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, currency TEXT, commission REAL, created_at TEXT, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE recharges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, currency_code TEXT, price REAL, cost REAL, created_at TEXT, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE custom_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, profit_usd REAL, status TEXT, created_at TEXT);
    CREATE TABLE maintenance (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT);
  `);
}

function todayAtUtc(hour: string): string {
  const hh = hour.padStart(2, "0");
  return (
    db
      .prepare(
        `SELECT datetime(date('now','localtime') || ' ${hh}:00:00', 'utc') AS ts`,
      )
      .get() as { ts: string }
  ).ts;
}

function seedFs(row: {
  commissionModel?: number;
  settlementId: number;
  createdAt: string;
}): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, currency, commission, commission_model, is_settled, settlement_id, is_refunded, cost, created_at)
       VALUES (1, 'USD', 0, ?, 1, ?, 0, 0, ?)`,
    )
    .run(row.commissionModel ?? 1, row.settlementId, row.createdAt);
  return Number(res.lastInsertRowid);
}

function seedFsTransaction(fsId: number, createdAt: string): number {
  const res = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 0, ?)`,
    )
    .run(fsId, createdAt);
  return Number(res.lastInsertRowid);
}

function seedSettlementTxn(row: {
  settlementLedgerId: number;
  profitUsd: number;
  createdAt: string;
}): number {
  const res = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, created_at)
       VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', ?, ?, ?)`,
    )
    .run(row.settlementLedgerId, row.profitUsd, row.createdAt);
  return Number(res.lastInsertRowid);
}

function seedAllocation(row: {
  settlementLedgerId: number;
  financialServiceId: number;
  serviceType: string;
  commissionUsd: number;
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO settlement_commission_allocations
       (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, created_at)
     VALUES (1, ?, ?, ?, 'OMT', ?, ?)`,
  ).run(
    row.settlementLedgerId,
    row.financialServiceId,
    row.serviceType,
    row.commissionUsd,
    row.createdAt,
  );
}

function seedDebt(row: { fsTxnId: number; coveredUsd: number; createdAt: string }): void {
  db.prepare(
    `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, transaction_id, covered_usd, created_at)
     VALUES (1, 1, 'Service Debt', 100, ?, ?, ?)`,
  ).run(row.fsTxnId, row.coveredUsd, row.createdAt);
}

describe("ClosingRepository.getDailyStatsSnapshot — LIRA-158 D17 cashless commission defers on client debt", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createFullSchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("1. a CASHLESS settlement's commission does not contribute to today's total while the client's debt is uncovered", () => {
    const settlementLedgerId = 801;
    const fsId = seedFs({ settlementId: settlementLedgerId, createdAt: todayAtUtc("08") });
    const fsTxnId = seedFsTransaction(fsId, todayAtUtc("08"));
    seedDebt({ fsTxnId, coveredUsd: 0, createdAt: todayAtUtc("08") });
    seedSettlementTxn({
      settlementLedgerId,
      profitUsd: 2.0,
      createdAt: todayAtUtc("11"),
    });
    seedAllocation({
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "SEND",
      commissionUsd: 2.0,
      createdAt: todayAtUtc("11"),
    });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(0);
  });

  it("2. once the client's debt is covered, the SAME cashless settlement's commission contributes on the SETTLEMENT day", () => {
    const settlementLedgerId = 802;
    const fsId = seedFs({ settlementId: settlementLedgerId, createdAt: todayAtUtc("08") });
    const fsTxnId = seedFsTransaction(fsId, todayAtUtc("08"));
    seedSettlementTxn({
      settlementLedgerId,
      profitUsd: 2.0,
      createdAt: todayAtUtc("11"),
    });
    seedAllocation({
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "SEND",
      commissionUsd: 2.0,
      createdAt: todayAtUtc("11"),
    });
    // Covered debt (not uncovered) — recognized immediately.
    seedDebt({ fsTxnId, coveredUsd: 100, createdAt: todayAtUtc("08") });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(2.0);
  });

  it("3. a BILLS-ONLY settlement's commission is unaffected by an uncovered client debt on the underlying bill — recognises immediately", () => {
    const settlementLedgerId = 803;
    const fsId = seedFs({ settlementId: settlementLedgerId, createdAt: todayAtUtc("08") });
    const fsTxnId = seedFsTransaction(fsId, todayAtUtc("08"));
    seedDebt({ fsTxnId, coveredUsd: 0, createdAt: todayAtUtc("08") });
    seedSettlementTxn({
      settlementLedgerId,
      profitUsd: 3.0,
      createdAt: todayAtUtc("11"),
    });
    seedAllocation({
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "BILL",
      commissionUsd: 3.0,
      createdAt: todayAtUtc("11"),
    });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(3.0);
  });
});

describe("ClosingRepository.getDailyStatsSnapshot — D17 schema-drift fallback (no allocations table)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createLegacySchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("4. degrades to the legacy numbers and throws nothing when neither `transactions` nor `settlement_commission_allocations` exist", () => {
    db.prepare(
      `INSERT INTO financial_services (tenant_id, currency, commission, created_at) VALUES (1, 'USD', 4.0, ?)`,
    ).run(todayAtUtc("10"));

    expect(() =>
      runWithTenant(1, () => repo.getDailyStatsSnapshot()),
    ).not.toThrow();
    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(4.0);
  });
});
