/**
 * LIRA-160 follow-up (2026-09-04) — completes the gap the original LIRA-160
 * pass left open: `notDebtPending` (DBT-1) was verified missing from
 * `finProfitLegacy`/`rechargeProfit`/`customProfit`/`maintProfit` and their
 * `ProfitRepository` counterparts, but could not be wired in because
 * `ProfitRepository.notDebtPending` was a private, unexported function and a
 * concurrent agent was mid-edit on that exact file for LIRA-162/163. That
 * fence is now lifted (Task 1 of this follow-up exports `notDebtPending`),
 * and this file proves the gate now works on all FOUR sources plus `loto`
 * (LIRA-161's own addition, which already documented the identical gap).
 *
 * `exchange` deliberately has NO test here: `ExchangeRepository` structurally
 * rejects a CUSTOMER_ACCOUNT payout leg (`exchange_transactions` carries no
 * `client_id` column at all — independently re-verified against
 * `electron-app/create_db.sql`'s `exchange_transactions` DDL before filing
 * this note, not merely assumed from the prior agent's claim), so an
 * exchange row can never have a matching `debt_ledger` row in the first
 * place — `notDebtPending` would always no-op there, and `getExchangeTotals`
 * itself never gates on it either (only `notRefunded` + `notPartnerPending`).
 * A test that can only prove "nothing happens" would prove nothing; see
 * `ClosingRepository.lira161ExchangeAndLoto.test.ts`'s own header for the
 * full investigation.
 *
 * Each module's four sub-queries in `ClosingRepository.ts` resolve the row's
 * own unified `transactions` id via `_sourceTxnIdSubquery` (a scalar
 * correlated subquery, mirroring `ProfitRepository.allocationNotDebtPending`'s
 * resolve-then-gate shape) and gate on `notDebtPending` verbatim — EXCEPT
 * `loto`, which already JOINs `transactions` directly and uses the real
 * `t.id`. `debt_ledger` rows use the real production module-debt
 * `transaction_type` values `notDebtPending` itself matches on ('Service
 * Debt', 'Recharge Debt', 'Custom Service Debt', 'Maintenance Debt', 'Loto
 * Debt' — verified against `ProfitRepository.ts`'s `notDebtPending`
 * definition, not re-typed from memory).
 *
 * Rule 17 — every gate proven here was reverted in `ClosingRepository.ts`
 * (the specific `AND ${notDebtPending(...)}` clause removed from the
 * relevant branch), this file re-run, the failure captured VERBATIM, then
 * restored. See the PR description / task report for the captured
 * before/after output — not duplicated into this file, so the fixture stays
 * the single source of truth for the CURRENT, fixed behaviour.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: ClosingRepository;

/**
 * Full production-shaped schema: every table `getDailyStatsSnapshot`
 * unconditionally touches, PLUS `transactions`, `partner_ledger` (present
 * but never populated in this file — proves the debt gate in isolation,
 * without any partner-pending interaction), and `loto_tickets`.
 * `debt_ledger` carries the real `transaction_id`/`covered_usd`/
 * `covered_lbp` columns `notDebtPending` reads (verified against
 * `electron-app/create_db.sql`'s real DDL).
 */
function createSchema(d: Database.Database): void {
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
      client_id INTEGER NOT NULL DEFAULT 1, transaction_type TEXT NOT NULL,
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
      created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      currency_code TEXT, price REAL, cost REAL, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      profit_usd REAL, status TEXT, created_at TEXT
    , is_refunded INTEGER DEFAULT 0);
    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT,
      is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL, transaction_type TEXT, reference_table TEXT,
      reference_id INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL,
      amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0, profit_lbp REAL DEFAULT 0,
      reverses_id INTEGER, created_at TEXT
    );
    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      sale_amount REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT
    );
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

function insertTxn(row: {
  type: string;
  sourceTable: string;
  sourceId: number;
  createdAt: string;
  profitLbp?: number;
}): number {
  const res = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_lbp, created_at)
       VALUES (1, ?, 'ACTIVE', ?, ?, ?, ?)`,
    )
    .run(row.type, row.sourceTable, row.sourceId, row.profitLbp ?? 0, row.createdAt);
  return Number(res.lastInsertRowid);
}

/** An UNCOVERED module-debt charge keyed to `txnId` — makes
 *  `notDebtPending("t.id"/subquery)` evaluate to FALSE for that row (DBT-1:
 *  `covered_usd < amount_usd` OR `covered_lbp < amount_lbp`). `amountLbp`
 *  defaults to 0 (every module here is USD except loto, which passes it
 *  explicitly — an all-zero amount_usd/amount_lbp row would leave NOTHING
 *  owed and the gate would trivially PASS instead of deferring). */
function insertUncoveredDebt(row: {
  txnId: number;
  transactionType: string;
  amountUsd: number;
  amountLbp?: number;
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, covered_usd, covered_lbp, is_refunded, created_at)
     VALUES (1, 1, ?, ?, ?, ?, 0, 0, 0, ?)`,
  ).run(
    row.transactionType,
    row.amountUsd,
    row.amountLbp ?? 0,
    row.txnId,
    row.createdAt,
  );
}

/** A FULLY COVERED module-debt charge — `notDebtPending` must pass (the
 *  client has repaid), proving the gate isn't a blanket "any debt row
 *  exists" check but the real FIFO-coverage comparison. */
function insertCoveredDebt(row: {
  txnId: number;
  transactionType: string;
  amountUsd: number;
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, covered_usd, covered_lbp, is_refunded, created_at)
     VALUES (1, 1, ?, ?, 0, ?, ?, 0, 0, ?)`,
  ).run(row.transactionType, row.amountUsd, row.txnId, row.amountUsd, row.createdAt);
}

function insertFs(commission: number, createdAt: string): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services (tenant_id, currency, commission, commission_model, is_refunded, created_at)
       VALUES (1, 'USD', ?, 0, 0, ?)`,
    )
    .run(commission, createdAt);
  return Number(res.lastInsertRowid);
}

function insertRecharge(price: number, cost: number, createdAt: string): number {
  const res = db
    .prepare(
      `INSERT INTO recharges (tenant_id, currency_code, price, cost, is_refunded, created_at)
       VALUES (1, 'USD', ?, ?, 0, ?)`,
    )
    .run(price, cost, createdAt);
  return Number(res.lastInsertRowid);
}

function insertCustomService(profitUsd: number, createdAt: string): number {
  const res = db
    .prepare(
      `INSERT INTO custom_services (tenant_id, profit_usd, status, is_refunded, created_at)
       VALUES (1, ?, 'completed', 0, ?)`,
    )
    .run(profitUsd, createdAt);
  return Number(res.lastInsertRowid);
}

function insertMaintenance(
  finalAmountUsd: number,
  costUsd: number,
  createdAt: string,
): number {
  const res = db
    .prepare(
      `INSERT INTO maintenance (tenant_id, final_amount_usd, cost_usd, status, is_refunded, created_at)
       VALUES (1, ?, ?, 'Delivered', 0, ?)`,
    )
    .run(finalAmountUsd, costUsd, createdAt);
  return Number(res.lastInsertRowid);
}

function insertLotoTicket(createdAt: string): number {
  const res = db
    .prepare(
      `INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at)
       VALUES (1, 100, 0, ?)`,
    )
    .run(createdAt);
  return Number(res.lastInsertRowid);
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ClosingRepository.getDailyStatsSnapshot — LIRA-160 follow-up notDebtPending gates", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  describe("finProfitLegacy", () => {
    it("excludes a CUSTOMER_ACCOUNT-charged ('Service Debt') legacy commission while uncovered", () => {
      const fsId = insertFs(5, todayAtUtc("10"));
      const txnId = insertTxn({
        type: "FINANCIAL_SERVICE",
        sourceTable: "financial_services",
        sourceId: fsId,
        createdAt: todayAtUtc("10"),
      });
      insertUncoveredDebt({
        txnId,
        transactionType: "Service Debt",
        amountUsd: 5,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });

    it("counts it once the client's debt is fully covered", () => {
      const fsId = insertFs(5, todayAtUtc("10"));
      const txnId = insertTxn({
        type: "FINANCIAL_SERVICE",
        sourceTable: "financial_services",
        sourceId: fsId,
        createdAt: todayAtUtc("10"),
      });
      insertCoveredDebt({
        txnId,
        transactionType: "Service Debt",
        amountUsd: 5,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(5);
    });

    it("still counts a legacy commission with no debt row at all (cash sale)", () => {
      insertFs(5, todayAtUtc("10"));

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(5);
    });
  });

  describe("rechargeProfit", () => {
    it("excludes a CUSTOMER_ACCOUNT-charged ('Recharge Debt') margin while uncovered", () => {
      const rId = insertRecharge(10, 4, todayAtUtc("10"));
      const txnId = insertTxn({
        type: "RECHARGE",
        sourceTable: "recharges",
        sourceId: rId,
        createdAt: todayAtUtc("10"),
      });
      insertUncoveredDebt({
        txnId,
        transactionType: "Recharge Debt",
        amountUsd: 10,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });

    it("still counts a recharge margin with no debt row at all", () => {
      insertRecharge(10, 4, todayAtUtc("10"));

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(6);
    });
  });

  describe("customProfit", () => {
    it("excludes a CUSTOMER_ACCOUNT-charged ('Custom Service Debt') margin while uncovered", () => {
      const csId = insertCustomService(15, todayAtUtc("10"));
      const txnId = insertTxn({
        type: "CUSTOM_SERVICE",
        sourceTable: "custom_services",
        sourceId: csId,
        createdAt: todayAtUtc("10"),
      });
      insertUncoveredDebt({
        txnId,
        transactionType: "Custom Service Debt",
        amountUsd: 15,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });

    it("still counts a custom-service margin with no debt row at all", () => {
      insertCustomService(15, todayAtUtc("10"));

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(15);
    });
  });

  describe("maintProfit", () => {
    it("excludes a CUSTOMER_ACCOUNT-charged ('Maintenance Debt') job while uncovered", () => {
      const mId = insertMaintenance(50, 20, todayAtUtc("10"));
      const txnId = insertTxn({
        type: "MAINTENANCE",
        sourceTable: "maintenance",
        sourceId: mId,
        createdAt: todayAtUtc("10"),
      });
      insertUncoveredDebt({
        txnId,
        transactionType: "Maintenance Debt",
        amountUsd: 50,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });

    it("still counts a maintenance job with no debt row at all", () => {
      insertMaintenance(50, 20, todayAtUtc("10"));

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(30);
    });
  });

  describe("loto", () => {
    it("excludes a CUSTOMER_ACCOUNT-charged ('Loto Debt') commission while uncovered", () => {
      const ticketId = insertLotoTicket(todayAtUtc("10"));
      const txnId = insertTxn({
        type: "LOTO",
        sourceTable: "loto_tickets",
        sourceId: ticketId,
        profitLbp: 4500,
        createdAt: todayAtUtc("10"),
      });
      insertUncoveredDebt({
        txnId,
        transactionType: "Loto Debt",
        amountUsd: 0,
        amountLbp: 4500,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitLBP).toBe(0);
    });

    it("still counts a loto commission with no debt row at all", () => {
      const ticketId = insertLotoTicket(todayAtUtc("10"));
      insertTxn({
        type: "LOTO",
        sourceTable: "loto_tickets",
        sourceId: ticketId,
        profitLbp: 4500,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitLBP).toBe(4500);
    });
  });
});
