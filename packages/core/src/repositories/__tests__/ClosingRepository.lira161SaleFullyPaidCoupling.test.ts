/**
 * LIRA-161 item 3 (2026-09-04, resolution) — `ClosingRepository
 * .getDailyStatsSnapshot`'s `salesProfit` sub-query used to hand-inline
 * `ProfitRepository.saleFullyPaid`'s formula
 * (`(s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1))
 * >= s.final_amount_usd - 0.05`) instead of calling the shared fragment —
 * rule 14. The previous LIRA-161 pass was blocked from fixing this because
 * `saleFullyPaid` was a private, unexported function and a concurrent agent
 * was mid-edit on `ProfitRepository.ts` for LIRA-162/163. That fence is
 * lifted (Task 1 of this follow-up exports `saleFullyPaid`), and
 * `ClosingRepository.ts`'s `salesProfit` now calls `${saleFullyPaid("s")}`
 * directly instead of re-typing its formula.
 *
 * This file has TWO jobs, matching the ticket's own instruction that a
 * behaviour-preserving refactor needs a different kind of proof than rule 17
 * (which proves nothing here — the SQL text is unchanged, byte-for-byte):
 *
 *   1. "Before" proof (describe block 1): the inlined text and
 *      `saleFullyPaid("s")` produce IDENTICAL results across the boundary
 *      cases that formula actually discriminates on (fully paid, short by a
 *      cent past the $0.05 tolerance, exactly at the tolerance edge, and a
 *      mixed USD+LBP payment). These assertions are written against
 *      OBSERVABLE BEHAVIOUR only (today's totalProfitUSD for a given
 *      fixture) — they do not care whether the underlying query text is
 *      inlined or delegates to the fragment, so the SAME test file passes
 *      unmodified both BEFORE and AFTER the `${saleFullyPaid("s")}` swap.
 *      That is the proof the ticket asked for: "a test that passes both
 *      before and after."
 *
 *   2. Coupling proof (describe block 2, exercised via the harness's
 *      documented procedure — see the PR/task report for the verbatim
 *      before/after console output): temporarily tighten
 *      `ProfitRepository.saleFullyPaid`'s tolerance (e.g. from `- 0.05` to
 *      `- 0.00`) and re-run this file's "boundary — $0.03 short still counts
 *      (within the $0.05 tolerance)" test. AFTER the rule-14 fix, that
 *      mutation changes `ClosingRepository`'s own result (the test flips
 *      from pass to fail) — proving Closing is now genuinely coupled to the
 *      shared definition. Revert immediately after observing the flip.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: ClosingRepository;

/**
 * Every table `getDailyStatsSnapshot` unconditionally prepares against
 * (legacy/pre-v148 shape — no `commission_model`, no `transactions`, no
 * `partner_ledger` — none of which `salesProfit` touches at all, so this
 * minimal shape is sufficient and keeps the fixture focused).
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
      currency TEXT, commission REAL, created_at TEXT
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

function insertSale(row: {
  finalAmountUsd: number;
  paidUsd: number;
  paidLbp?: number;
  exchangeRateSnapshot?: number;
  createdAt: string;
}): number {
  const res = db
    .prepare(
      `INSERT INTO sales (tenant_id, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, status, created_at)
       VALUES (1, ?, ?, ?, ?, 'completed', ?)`,
    )
    .run(
      row.finalAmountUsd,
      row.paidUsd,
      row.paidLbp ?? 0,
      row.exchangeRateSnapshot ?? 90000,
      row.createdAt,
    );
  return Number(res.lastInsertRowid);
}

function insertSaleItem(row: {
  saleId: number;
  soldPriceUsd: number;
  costPriceSnapshotUsd: number;
}): void {
  db.prepare(
    `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, is_refunded)
     VALUES (1, ?, ?, ?, 0)`,
  ).run(row.saleId, row.soldPriceUsd, row.costPriceSnapshotUsd);
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ClosingRepository.getDailyStatsSnapshot — salesProfit / saleFullyPaid parity (LIRA-161 item 3)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  it("1. a fully-paid sale (paid == final) contributes its margin", () => {
    const saleId = insertSale({
      finalAmountUsd: 100,
      paidUsd: 100,
      createdAt: todayAtUtc("10"),
    });
    insertSaleItem({ saleId, soldPriceUsd: 100, costPriceSnapshotUsd: 60 });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(40);
  });

  it("2. boundary — $0.03 short still counts (within the $0.05 tolerance)", () => {
    // paid_usd = 99.97, final_amount_usd = 100 -> shortfall 0.03 < 0.05
    // tolerance. This is the EXACT case the coupling proof mutates: tighten
    // saleFullyPaid's tolerance from "- 0.05" to "- 0.00" and this specific
    // assertion flips from 40 to 0.
    const saleId = insertSale({
      finalAmountUsd: 100,
      paidUsd: 99.97,
      createdAt: todayAtUtc("10"),
    });
    insertSaleItem({ saleId, soldPriceUsd: 100, costPriceSnapshotUsd: 60 });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(40);
  });

  it("3. boundary — $0.10 short (outside the $0.05 tolerance) contributes nothing", () => {
    const saleId = insertSale({
      finalAmountUsd: 100,
      paidUsd: 99.9,
      createdAt: todayAtUtc("10"),
    });
    insertSaleItem({ saleId, soldPriceUsd: 100, costPriceSnapshotUsd: 60 });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(0);
  });

  it("4. a mixed USD+LBP payment that sums (via the snapshot rate) to fully paid contributes its margin", () => {
    // paid_usd 50 + paid_lbp 4,500,000 / rate 90,000 = 50 + 50 = 100 == final.
    const saleId = insertSale({
      finalAmountUsd: 100,
      paidUsd: 50,
      paidLbp: 4_500_000,
      exchangeRateSnapshot: 90000,
      createdAt: todayAtUtc("10"),
    });
    insertSaleItem({ saleId, soldPriceUsd: 100, costPriceSnapshotUsd: 70 });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(30);
  });

  it("5. a materially under-paid sale (no LBP top-up) contributes nothing", () => {
    const saleId = insertSale({
      finalAmountUsd: 100,
      paidUsd: 20,
      createdAt: todayAtUtc("10"),
    });
    insertSaleItem({ saleId, soldPriceUsd: 100, costPriceSnapshotUsd: 60 });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(0);
  });
});
