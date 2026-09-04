/**
 * LIRA-160 (2026-09-04) — `ClosingRepository.getDailyStatsSnapshot` OVER-
 * recognises profit on four module sources because it was missing the same
 * `notPartnerPending`/`notDebtPending` gates their `ProfitRepository`
 * counterparts already carry (`getFinancialSettledByCurrency`,
 * `getRechargesByCurrency`, `getCustomServicesTotals`), and `maintProfit`
 * was additionally missing `notRefunded` entirely (`ProfitRepository
 * .getMaintenanceTotals` has both `notRefunded` + `notDebtPending`, but
 * never `notPartnerPending` — verified, and reproduced here: maintenance has
 * no partner-routing path).
 *
 * SCOPE NOTE, why `notDebtPending` is absent from every fix in this file:
 * `ProfitRepository.notDebtPending` is a private, unexported
 * `function notDebtPending(...)` — importing it would require adding
 * `export` to ProfitRepository.ts, which this ticket's own handover
 * explicitly forbids touching (a second agent was concurrently mid-edit on
 * that exact file for LIRA-162/163; a concurrent write risks corrupting or
 * losing either agent's in-progress work). Only `notPartnerPending` (already
 * exported) and `notRefunded` (already exported, already imported by this
 * file) could be added. This is a real, documented, STILL-OPEN residual gap
 * — see `profitRecognition.guard.test.ts`'s updated `EXCLUDED_UNITS` entries
 * for `finProfitLegacyDegraded`/`rechargeProfitDegraded`/
 * `customProfitDegraded`/`maintProfit`, and the LIRA-160 status note in
 * current_sprint.md.
 *
 * Fixtures deliberately build a for-partner / refunded row where the OLD
 * (ungated) predicate and the NEW (gated) predicate DISAGREE — CLAUDE.md
 * rule 17's own warning against "fixtures where gated and ungated happen to
 * agree" — so each test is a real proof, not a coincidence.
 *
 * Rule 17 — every test below was proven against the pre-fix code: the
 * specific gate it covers was temporarily reverted in ClosingRepository.ts,
 * this file was run with `--testPathPatterns lira160PartnerPendingGates`,
 * the failure was captured, and the fix was restored. The verbatim
 * before/after output is recorded in the PR description / task report, not
 * copied into this file (keeps the fixture the single source of truth for
 * the CURRENT, fixed behaviour).
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: ClosingRepository;

/**
 * Full schema for every table `getDailyStatsSnapshot` unconditionally
 * touches, PLUS `partner_ledger` (the table `notPartnerPending` reads) with
 * the real production column set (`reference_table`/`reference_id`/
 * `transaction_type`/`amount`/`covered_amount` — exactly what
 * `ProfitRepository.notPartnerPending`'s NOT EXISTS subquery reads).
 * `financial_services` carries `commission_model` (LIRA-158) so
 * `embeddedCommission` exercises its real (not schema-drift) branch.
 * `maintenance` carries `is_refunded` (LIRA-160's own fix needs it).
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
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      amount_usd REAL, amount_lbp REAL, transaction_type TEXT, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
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
  `);
}

/** "Today, local calendar day, at HH:00:00 local time" as the UTC string a
 *  real `created_at` column would store — same construction used across the
 *  sibling ClosingRepository test fixtures, so `todayLocal()`'s
 *  `DATE(col,'localtime') = DATE('now','localtime')` matches regardless of
 *  the machine's actual TZ. */
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

function insertFs(row: {
  commission: number;
  createdAt: string;
}): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services (tenant_id, currency, commission, commission_model, is_refunded, created_at)
       VALUES (1, 'USD', ?, 0, 0, ?)`,
    )
    .run(row.commission, row.createdAt);
  return Number(res.lastInsertRowid);
}

function insertRecharge(row: { price: number; cost: number; createdAt: string }): number {
  const res = db
    .prepare(
      `INSERT INTO recharges (tenant_id, currency_code, price, cost, is_refunded, created_at)
       VALUES (1, 'USD', ?, ?, 0, ?)`,
    )
    .run(row.price, row.cost, row.createdAt);
  return Number(res.lastInsertRowid);
}

function insertCustomService(row: { profitUsd: number; createdAt: string }): number {
  const res = db
    .prepare(
      `INSERT INTO custom_services (tenant_id, profit_usd, status, is_refunded, created_at)
       VALUES (1, ?, 'completed', 0, ?)`,
    )
    .run(row.profitUsd, row.createdAt);
  return Number(res.lastInsertRowid);
}

function insertMaintenance(row: {
  finalAmountUsd: number;
  costUsd: number;
  isRefunded: number;
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO maintenance (tenant_id, final_amount_usd, cost_usd, status, is_refunded, created_at)
     VALUES (1, ?, ?, 'Delivered', ?, ?)`,
  ).run(row.finalAmountUsd, row.costUsd, row.isRefunded, row.createdAt);
}

/** An uncovered FOR-partner obligation against `refTable`/`refId` — makes
 *  `notPartnerPending(refTable, idExpr)` evaluate to FALSE for that row
 *  (the exact shape `ProfitRepository.notPartnerPending`'s doc comment
 *  describes: a FOR_% row whose covered_amount is still short of amount). */
function insertUncoveredPartnerObligation(refTable: string, refId: number): void {
  db.prepare(
    `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, direction, covered_amount)
     VALUES (1, 1, 'FOR_PARTNER_CHARGE', ?, ?, 100, 'CREDIT', 0)`,
  ).run(refTable, refId);
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ClosingRepository.getDailyStatsSnapshot — LIRA-160 notPartnerPending gates", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  describe("finProfitLegacy", () => {
    it("excludes a for-partner legacy commission while the partner obligation is uncovered", () => {
      const fsId = insertFs({ commission: 5, createdAt: todayAtUtc("10") });
      insertUncoveredPartnerObligation("financial_services", fsId);

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });

    it("still counts a non-partner legacy commission", () => {
      insertFs({ commission: 5, createdAt: todayAtUtc("10") });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(5);
    });
  });

  describe("rechargeProfit", () => {
    it("excludes a for-partner recharge margin while the partner obligation is uncovered", () => {
      const rId = insertRecharge({ price: 10, cost: 4, createdAt: todayAtUtc("10") });
      insertUncoveredPartnerObligation("recharges", rId);

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });

    it("still counts a non-partner recharge margin", () => {
      insertRecharge({ price: 10, cost: 4, createdAt: todayAtUtc("10") });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(6);
    });
  });

  describe("customProfit", () => {
    it("excludes a for-partner custom-service margin while the partner obligation is uncovered", () => {
      const csId = insertCustomService({ profitUsd: 15, createdAt: todayAtUtc("10") });
      insertUncoveredPartnerObligation("custom_services", csId);

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });

    it("still counts a non-partner custom-service margin", () => {
      insertCustomService({ profitUsd: 15, createdAt: todayAtUtc("10") });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(15);
    });
  });

  describe("maintProfit — notRefunded", () => {
    it("excludes a same-day refunded maintenance job", () => {
      insertMaintenance({
        finalAmountUsd: 50,
        costUsd: 20,
        isRefunded: 1,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });

    it("still counts a live (not refunded) maintenance job", () => {
      insertMaintenance({
        finalAmountUsd: 50,
        costUsd: 20,
        isRefunded: 0,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(30);
    });
  });
});
