/**
 * DC-12 (OWNER_NOTES_2026-09-21.md §7.2) — reconciliation guard, on a REAL
 * `ProfitRepository`/`ProfitService` over an in-memory better-sqlite3
 * database (not mocked), spanning two modules (product sales + telecom
 * recharges) and both currencies (USD + LBP), plus expenses in both
 * currencies:
 *
 *   1. Σ chart gross (SalesService.getChartData("Profit")) − Σ expenses
 *      (same window) = tile net (SalesService.getNetProfitLast30Days) —
 *      per currency.
 *   2. Each chart day's gross equals ProfitService.getByDate's OWN gross
 *      for that day — i.e. DC-10's composition never drifts from the
 *      source it reads, INCLUDING when that source is queried over a
 *      DIFFERENT (Profits-page-style, wider) range than the chart's own
 *      30-day window.
 *   3. Activity strictly BEFORE the 30-day window (a "day 31" sale) is
 *      excluded from both the chart and the tile — CHART-m3 (verifier
 *      finding, round 1 of the DC-10..12 fix pass): the original fixture
 *      had no out-of-window row and no LBP expense, so it could not have
 *      caught a window-boundary drift between the chart and the tile, or
 *      an LBP-vs-USD expense-gating bug, even though both M-B and M-C
 *      (mutations that broke exactly those things) were in the same
 *      round's mutation set.
 *
 * Schema copied from `ProfitRepository.auditBatchLO.test.ts` (every table
 * `ProfitRepository.getByDate`'s single multi-CTE query touches
 * unconditionally — see `reference_test_schema_completeness`: a missing
 * table here makes the WHOLE query throw in setup, not a "0 rows" false
 * negative). Only `sales`/`sale_items` (module 1, USD), `recharges` (module
 * 2, LBP) and `expenses` are seeded; every other table stays empty, which
 * `getByDate`'s LEFT JOINs and `COALESCE(...,0)` already treat as "no
 * activity that day" (proven by every other `ProfitRepository.*.test.ts`
 * fixture that reuses this exact shape).
 *
 * RULE 17 (red observed 2026-09-24): before `SalesService
 * .getNetProfitLast30Days` existed, `service.getNetProfitLast30Days is not a
 * function` — TS2339 at compile time (same class of failure the DC-10/DC-11
 * unit tests already document observing). Re-verified here with a REAL
 * bug: temporarily changed the sum to use `profit_usd` (gross) instead of
 * `net_profit_usd`, ran this file, watched
 * "chart gross - expenses = tile net" fail (see the two numbers this test's
 * own assertion messages would show), then restored the fix — recorded
 * inline below rather than duplicating the whole revert here since
 * `SalesService.netProfitLast30Days.dc11.test.ts` already carries that
 * exact revert/run/restore cycle for the unit-level proof; this file adds
 * the CROSS-CHECK (chart vs tile, real DB) that only makes sense once that
 * fix already exists.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../../repositories/SalesRepository.js";
import { resetProfitRepository } from "../../repositories/ProfitRepository.js";
import { resetRateRepository } from "../../repositories/RateRepository.js";
import { ProfitService } from "../ProfitService.js";
import { SalesService } from "../SalesService.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { addDaysToDateString } from "../../utils/calendarDate.js";

const TENANT_ID = 1;
// Two days inside the 30-day window ending on END_DAY.
const DAY_1 = "2026-09-10";
const DAY_2 = "2026-09-24";
const END_DAY = "2026-09-24";
// CHART-m3 — the window is [END_DAY - 29, END_DAY] = ["2026-08-26",
// "2026-09-24"] (CHART_WINDOW_DAYS=30 in SalesService.ts). This date is
// ONE DAY before that window starts — the "day 31" case — chosen with a
// LARGE, distinguishing profit (999, not a multiple/sum of the in-window
// fixture's 40 and 100,000) so an accidental inclusion is unmistakable
// rather than a coincidental match.
const OUT_OF_WINDOW_DAY = "2026-08-25";
const OUT_OF_WINDOW_PROFIT_USD = 999;

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      full_name TEXT,
      phone_number TEXT
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      name TEXT
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      -- DAY-1 (rule 27) — SalesRepository.getChartData("Sales", endDay)'s
      -- refunded-share CASE (DC-3) divides by total_amount_usd (the
      -- PRE-discount total); required for the "Sales" branch, unlike the
      -- other fixtures in this file that only ever drive "Profit".
      total_amount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      discount_usd DECIMAL(10, 2) DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_id INTEGER,
      product_id INTEGER,
      sold_price_usd REAL DEFAULT 0,
      cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      -- DAY-1 — read by the same "Sales" branch's refunded-share CASE
      -- (ri.refunded_pre_discount_usd, SUM(sold_price_usd *
      -- refunded_quantity)). No row in this file ever refunds, so this
      -- stays at its DEFAULT 0 everywhere, same as is_refunded above.
      refunded_quantity INTEGER DEFAULT 0
    );

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
      client_phone TEXT,
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
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      commission_model INTEGER DEFAULT 0,
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      settlement_id INTEGER DEFAULT NULL,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    ,
      parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
    );

    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT DEFAULT 'active',
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    , refunded_at TEXT DEFAULT NULL);

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

/** Module 1 — a product sale (USD): sold 100, cost 60 -> profit 40. */
function seedSale(db: Database.Database, createdAt: string): void {
  const sale = db
    .prepare(
      `INSERT INTO sales (tenant_id, status, final_amount_usd, total_amount_usd, paid_usd, created_at)
       VALUES (1, 'completed', 100, 100, 100, ?)`,
    )
    .run(createdAt);
  const saleId = Number(sale.lastInsertRowid);
  db.prepare(
    `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
     VALUES (1, ?, 100, 60, 1, 0)`,
  ).run(saleId);
  // daily_sales_profit reads the unified-ledger SALE transaction, not
  // sale_items directly (see ProfitRepository.getByDate's own doc comment).
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
     VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, 100, 40, 0, ?)`,
  ).run(saleId, createdAt);
}

/** Module 2 — an MTC/Alfa telecom recharge (LBP): price 900,000, cost 800,000 -> profit 100,000 LBP. */
function seedRecharge(db: Database.Database, createdAt: string): void {
  const recharge = db
    .prepare(
      `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
       VALUES (1, 'MTC', 'LBP', 900000, 800000, 0, ?)`,
    )
    .run(createdAt);
  const rechargeId = Number(recharge.lastInsertRowid);
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_lbp, profit_usd, profit_lbp, created_at)
     VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 900000, 0, 100000, ?)`,
  ).run(rechargeId, createdAt);
}

function seedExpense(
  db: Database.Database,
  amountUsd: number,
  expenseDate: string,
  amountLbp = 0,
): void {
  db.prepare(
    `INSERT INTO expenses (tenant_id, status, amount_usd, amount_lbp, expense_date)
     VALUES (1, 'active', ?, ?, ?)`,
  ).run(amountUsd, amountLbp, expenseDate);
}

/**
 * CHART-m3 — a sale on `OUT_OF_WINDOW_DAY` (before the chart/tile's 30-day
 * window starts), with a distinguishing profit (999) so its accidental
 * inclusion in either the chart's sum or the tile's net is unmistakable.
 */
function seedOutOfWindowSale(db: Database.Database): void {
  const sale = db
    .prepare(
      `INSERT INTO sales (tenant_id, status, final_amount_usd, total_amount_usd, paid_usd, created_at)
       VALUES (1, 'completed', 1999, 1999, 1999, ?)`,
    )
    .run(`${OUT_OF_WINDOW_DAY} 10:00:00`);
  const saleId = Number(sale.lastInsertRowid);
  db.prepare(
    `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
     VALUES (1, ?, 1999, 1000, 1, 0)`,
  ).run(saleId);
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
     VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, 1999, ?, 0, ?)`,
  ).run(saleId, OUT_OF_WINDOW_PROFIT_USD, `${OUT_OF_WINDOW_DAY} 10:00:00`);
}

describe("DC-12 — chart/tile reconciliation over a real multi-module, multi-currency fixture", () => {
  let db: Database.Database;
  let service: SalesService;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    // MUST run after __LIRATEK_TEST_DB__ is (re)pointed and BEFORE
    // `new ProfitService()`'s default `getProfitRepository()`/
    // `getRateRepository()` singletons construct against THIS test's db
    // (the same singleton-hygiene requirement every ProfitRepository-backed
    // fixture in this codebase follows).
    resetProfitRepository();
    resetRateRepository();

    // Day 1: a sale (USD profit 40) + a $5 expense + a 20,000 LBP expense
    // (CHART-m3 — the original fixture had no LBP expense, so it could not
    // catch an LBP-vs-USD expense-gating bug in the tile's net calculation).
    seedSale(db, `${DAY_1} 10:00:00`);
    seedExpense(db, 5, `${DAY_1} 09:00:00`, 20_000);
    // Day 2 (the window's last day): a recharge (LBP profit 100,000).
    seedRecharge(db, `${DAY_2} 11:00:00`);
    // CHART-m3 — a sale the day BEFORE the 30-day window starts ("day 31"),
    // with a large, distinguishing profit. Neither the chart nor the tile
    // may include it.
    seedOutOfWindowSale(db);

    runWithTenant(TENANT_ID, () => {
      const salesRepo = new SalesRepository();
      const profitService = new ProfitService();
      service = new SalesService(salesRepo, profitService);
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
    resetProfitRepository();
    resetRateRepository();
  });

  it("Σ chart gross − Σ expenses (same window) = tile net, per currency", () => {
    let chart: ReturnType<SalesService["getChartData"]> = [];
    let tile: ReturnType<SalesService["getNetProfitLast30Days"]>;
    let totalExpensesUsd = 0;
    let totalExpensesLbp = 0;

    // The window's own bounds — CHART-m3 requires the expense cross-check
    // to filter to this SAME window; the original version summed EVERY
    // expense ever inserted, so an out-of-window expense would have passed
    // undetected.
    const windowFrom = addDaysToDateString(END_DAY, -(30 - 1));

    runWithTenant(TENANT_ID, () => {
      chart = service.getChartData("Profit", END_DAY);
      tile = service.getNetProfitLast30Days(END_DAY);
      // Independent read of the SAME window's expenses, straight off the
      // raw table (not through SalesService) — the cross-check must not
      // reuse the code path it's verifying.
      const rows = db
        .prepare(
          `SELECT COALESCE(SUM(amount_usd),0) AS usd, COALESCE(SUM(amount_lbp),0) AS lbp
           FROM expenses
           WHERE status='active' AND is_refunded=0
             AND date(expense_date) BETWEEN ? AND ?`,
        )
        .get(windowFrom, END_DAY) as { usd: number; lbp: number };
      totalExpensesUsd = rows.usd;
      totalExpensesLbp = rows.lbp;
    });

    const sumGrossUsd = chart.reduce((s, d) => s + (d.profit ?? 0), 0);
    const sumGrossLbp = chart.reduce((s, d) => s + (d.lbp ?? 0), 0);

    // Sanity: the fixture actually produced non-zero activity in both
    // currencies (a reconciliation over all-zeros would prove nothing), and
    // the out-of-window sale's distinguishing profit (999) is NOT folded
    // into either sum — proof the chart respects the window boundary, not
    // just that the two totals happen to agree with each other.
    expect(sumGrossUsd).toBe(40);
    expect(sumGrossUsd).not.toBe(40 + OUT_OF_WINDOW_PROFIT_USD);
    expect(sumGrossLbp).toBe(100_000);
    expect(totalExpensesUsd).toBe(5);
    expect(totalExpensesLbp).toBe(20_000);

    expect(sumGrossUsd - totalExpensesUsd).toBe(tile!.netProfitUSD);
    expect(sumGrossLbp - totalExpensesLbp).toBe(tile!.netProfitLBP);
    // The tile's net must not have absorbed the out-of-window sale either.
    expect(tile!.netProfitUSD).not.toBe(
      40 + OUT_OF_WINDOW_PROFIT_USD - totalExpensesUsd,
    );
  });

  it("each chart day's gross equals ProfitService.getByDate's own gross for that day", () => {
    let chart: ReturnType<SalesService["getChartData"]> = [];
    let byDate: ReturnType<ProfitService["getByDate"]> = [];
    // CHART-m3 (optional half of the finding) — a Profits-page-style
    // range: WIDER than the chart's own 30-day window, and starting before
    // `OUT_OF_WINDOW_DAY` so it DOES include that sale. If DC-10's
    // composition ever drifted from its source (e.g. re-derived the day
    // boundary itself instead of reading `ProfitService.getByDate`'s row
    // as-is), comparing against a differently-bounded call is what would
    // catch it — comparing only against the SAME window the chart itself
    // requested cannot.
    let byDateWideRange: ReturnType<ProfitService["getByDate"]> = [];

    runWithTenant(TENANT_ID, () => {
      chart = service.getChartData("Profit", END_DAY);
      const profitService = new ProfitService();
      const from = chart[0]!.date;
      byDate = profitService.getByDate(from, END_DAY);
      byDateWideRange = profitService.getByDate(OUT_OF_WINDOW_DAY, END_DAY);
    });

    const byDateMap = new Map(byDate.map((r) => [r.date, r]));
    for (const point of chart) {
      const sourceRow = byDateMap.get(point.date);
      expect(point.profit ?? 0).toBe(sourceRow?.profit_usd ?? 0);
      expect(point.lbp ?? 0).toBe(sourceRow?.profit_lbp ?? 0);
    }
    // Confirms the loop above actually compared real (non-default) values
    // on both activity days, not just the 28 zero-filled ones.
    const day1 = chart.find((d) => d.date === DAY_1);
    const day2 = chart.find((d) => d.date === DAY_2);
    expect(day1?.profit).toBe(40);
    expect(day2?.lbp).toBe(100_000);

    // The chart itself never carries a point for the out-of-window day at
    // all (its 30-day loop starts at DAY_1's window, not OUT_OF_WINDOW_DAY).
    expect(chart.find((d) => d.date === OUT_OF_WINDOW_DAY)).toBeUndefined();

    // But the SAME source, queried over the WIDER Profits-page-style range,
    // DOES see it — proving the exclusion above is the chart's window
    // choice, not a hole in the underlying data or in getByDate itself.
    const wideRangeMap = new Map(byDateWideRange.map((r) => [r.date, r]));
    expect(wideRangeMap.get(OUT_OF_WINDOW_DAY)?.profit_usd).toBe(
      OUT_OF_WINDOW_PROFIT_USD,
    );
    // And every in-window day's figure is IDENTICAL under the wider range —
    // the per-day source row does not depend on which range it was queried
    // through (rule 14: one definition, read twice, same answer).
    expect(wideRangeMap.get(DAY_1)?.profit_usd).toBe(
      byDateMap.get(DAY_1)?.profit_usd,
    );
    expect(wideRangeMap.get(DAY_2)?.profit_lbp).toBe(
      byDateMap.get(DAY_2)?.profit_lbp,
    );
  });

  /**
   * DAY-1 (rule 27, rule 17) — the Sales series used to ask SQLite for
   * `date('now','localtime')` independently of the day `SalesService
   * .getChartData` resolves for "Profit", so on web, between 00:00 and
   * 03:00 Beirut, the two series could cover different 30-day windows.
   * The fix: `SalesService.getChartData` resolves `to` ONCE and passes it
   * through to `SalesRepository.getChartData("Sales", to)` too — this test
   * proves it end to end on a real DB with an EXPLICIT `endDay`, not the
   * machine's own clock, so it cannot pass by coincidence of when it runs.
   *
   * RED OBSERVED (rule 17): the real pre-fix bug decoupled the two day
   * sources (Sales resolved its own day; Profit used the shared `to`), and
   * this sandbox's actual clock (2026-09-24) happens to equal this
   * fixture's own `END_DAY` constant, so reproducing the historical
   * `date('now','localtime')` bug verbatim would have passed by
   * coincidence today and proven nothing. Instead, temporarily changed line
   * 323's call from `this.salesRepo.getChartData("Sales", to)` to
   * `this.salesRepo.getChartData("Sales", addDaysToDateString(to, -1))` —
   * a deterministic stand-in for "the two day sources disagree" that does
   * not depend on what day it is. Ran `jest … -t "DAY-1"`: RED — the "SAME
   * 30 days" assertion failed with the Sales array shifted one day
   * (missing "2026-09-24", extra "2026-08-25"). Reverted the line
   * immediately after observing the failure; rerun below is green.
   */
  it("DAY-1: 'Sales' and 'Profit' cover the SAME 30 days for an explicit endDay, both non-zero on the window's last day", () => {
    let salesChart: ReturnType<SalesService["getChartData"]> = [];
    let profitChart: ReturnType<SalesService["getChartData"]> = [];

    runWithTenant(TENANT_ID, () => {
      salesChart = service.getChartData("Sales", END_DAY);
      profitChart = service.getChartData("Profit", END_DAY);
    });

    // Same 30 calendar days, in the same order — one day source (DAY-1),
    // not two independently-resolved windows.
    expect(salesChart.map((d) => d.date)).toEqual(
      profitChart.map((d) => d.date),
    );
    expect(salesChart).toHaveLength(30);

    // The window's last day (END_DAY = DAY_2) carries the LBP recharge in
    // BOTH series — a zero-filled/mismatched window would show 0 here.
    const salesLast = salesChart[salesChart.length - 1]!;
    const profitLast = profitChart[profitChart.length - 1]!;
    expect(salesLast.date).toBe(END_DAY);
    expect(profitLast.date).toBe(END_DAY);
    expect(salesLast.lbp).toBe(900_000);
    expect(profitLast.lbp).toBe(100_000);
  });
});
