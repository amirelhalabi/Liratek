/**
 * LIRA-185 — profit-surface audit, MAINTENANCE module. Each `describe` below
 * reproduces one lead from the September audit with the REAL writers
 * (`MaintenanceService.saveJob` → `MaintenanceRepository.processPayments` →
 * `TransactionRepository.createTransaction`, and `voidTransaction` for the
 * void lead) against the REAL `electron-app/create_db.sql` schema, then reads
 * every surface the lead names (Profits `getSummary`/`getByModule`/
 * `getByUser`/`getByClient`, and the closing snapshot
 * `ClosingService.getDailyStatsSnapshot`).
 *
 * Tests asserting the CORRECT value that FAIL today are the rule-17
 * failing-first guards for the later fix. Tests that pass are REFUTED /
 * ALREADY_FIXED evidence (the lead's divergence no longer reproduces).
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { MaintenanceRepository } from "../MaintenanceRepository.js";
import { MaintenanceService } from "../../services/MaintenanceService.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { resetStockBatchRepository } from "../StockBatchRepository.js";
import { ClosingRepository } from "../ClosingRepository.js";
import { ProfitRepository } from "../ProfitRepository.js";
import { ProfitService } from "../../services/ProfitService.js";
import { ClosingService } from "../../services/ClosingService.js";
import { runWithTenant } from "../../db/tenantContext.js";

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "..", "electron-app", "create_db.sql"),
  "utf-8",
);

let db: Database.Database;
let TODAY = "";
let PAST = "";
let PAST_ISO = "";

function fresh(): void {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
  resetStockBatchRepository();
  TODAY = (db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }).d;
  PAST = (db.prepare(`SELECT date('now','localtime','-2 days') AS d`).get() as { d: string }).d;
  // Noon local on PAST, as a UTC ISO string (what the page's
  // TransactionTimeOverride sends).
  PAST_ISO = new Date(`${PAST}T12:00:00`).toISOString();
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  resetStockBatchRepository();
  db?.close();
});

const t1 = <T>(fn: () => T): T => runWithTenant(1, fn);
const svc = () => new MaintenanceService(new MaintenanceRepository());
const profits = () => new ProfitService(new ProfitRepository());
const r = (x: number | undefined | null) => Math.round(((x ?? 0) as number) * 100) / 100;

function snapshot(day: string) {
  return t1(() =>
    new ClosingService(new ClosingRepository(), profits()).getDailyStatsSnapshot(
      { day },
      { includeProfit: true },
    ),
  );
}

function maintModule(day: string) {
  const rows = t1(() => profits().getByModule(day, day));
  return rows.find((m) => m.module === "MAINTENANCE");
}

function byUserTotals(day: string) {
  const rows = t1(() => profits().getByUser(day, day));
  return rows.reduce(
    (a, u) => ({
      revenue_usd: a.revenue_usd + (u.revenue_usd ?? 0),
      revenue_lbp: a.revenue_lbp + (u.revenue_lbp ?? 0),
      profit_usd: a.profit_usd + (u.profit_usd ?? 0),
      profit_lbp: a.profit_lbp + (u.profit_lbp ?? 0),
    }),
    { revenue_usd: 0, revenue_lbp: 0, profit_usd: 0, profit_lbp: 0 },
  );
}

function byClientTotals(day: string) {
  const rows = t1(() => profits().getByClient(day, day));
  return rows.reduce(
    (a, c) => ({
      revenue_usd: a.revenue_usd + (c.revenue_usd ?? 0),
      profit_usd: a.profit_usd + (c.profit_usd ?? 0),
    }),
    { revenue_usd: 0, profit_usd: 0 },
  );
}

function jobTxn(jobId: number) {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, status, created_at
         FROM transactions WHERE source_table='maintenance' AND source_id=? AND type='MAINTENANCE' AND reverses_id IS NULL`,
    )
    .get(jobId) as
    | { id: number; amount_usd: number; amount_lbp: number; profit_usd: number; profit_lbp: number; status: string; created_at: string }
    | undefined;
}

function drawer(name: string, cur: string): number {
  const row = db
    .prepare(`SELECT balance FROM drawer_balances WHERE drawer_name=? AND currency_code=? AND tenant_id=1`)
    .get(name, cur) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("LIRA-185 maintenance — D1: LBP job profit reaches the closing (LIRA-219)", () => {
  beforeEach(fresh);

  it("LBP job cost 100,000 / price 300,000: Profits and closing both show 200,000 LBP", () => {
    const res = t1(() =>
      svc().saveJob(
        {
          device_name: "Phone",
          issue_description: "screen",
          currency: "LBP",
          cost_lbp: 100000,
          price_lbp: 300000,
          final_amount_lbp: 300000,
          exchange_rate: 89500,
          status: "Delivered_Paid",
          payments: [{ method: "CASH", currency_code: "LBP", amount: 300000 }],
        },
        1,
      ),
    );
    expect(res.success).toBe(true);
    const txn = jobTxn(res.id as number)!;
    expect(txn.profit_lbp).toBe(200000);
    expect(txn.profit_usd).toBe(0);

    const mod = maintModule(TODAY)!;
    expect(mod).toBeDefined();
    expect(r(mod.profit_lbp)).toBe(200000);
    const snap = snapshot(TODAY);
    expect(r(snap.totalProfitLBP)).toBe(200000);
    expect(r(snap.totalProfitUSD)).toBe(0);
  });
});

describe("LIRA-185 maintenance — D4: By Module margin for an LBP-only job", () => {
  beforeEach(fresh);

  it("margin_pct is computed from the LBP figures (66.67%), not a fabricated 0%", () => {
    const res = t1(() =>
      svc().saveJob(
        {
          device_name: "Phone",
          issue_description: "screen",
          currency: "LBP",
          cost_lbp: 100000,
          price_lbp: 300000,
          final_amount_lbp: 300000,
          exchange_rate: 89500,
          status: "Delivered_Paid",
          payments: [{ method: "CASH", currency_code: "LBP", amount: 300000 }],
        },
        1,
      ),
    );
    expect(res.success).toBe(true);
    const mod = maintModule(TODAY)!;
    expect(mod).toBeDefined();
    expect(r(mod.revenue_lbp)).toBe(300000);
    expect(mod.margin_pct).not.toBeUndefined();
    expect(r(mod.margin_pct as number)).toBeCloseTo(66.67, 1);
  });
});

describe("LIRA-185 maintenance — D2: one job, one day across every Profits tab and the closing", () => {
  beforeEach(fresh);

  it("received 2 days ago as a draft, delivered+paid today: By Module, By Cashier, By Client and the closing all put the $30 on the SAME day", () => {
    const s = svc();
    const created = t1(() =>
      s.saveJob(
        {
          device_name: "Laptop",
          issue_description: "hinge",
          currency: "USD",
          cost_usd: 20,
          price_usd: 50,
          final_amount_usd: 50,
          status: "Received",
          transaction_time: PAST_ISO,
        },
        1,
      ),
    );
    expect(created.success).toBe(true);
    const id = created.id as number;
    const delivered = t1(() =>
      s.saveJob(
        {
          id,
          device_name: "Laptop",
          issue_description: "hinge",
          currency: "USD",
          cost_usd: 20,
          price_usd: 50,
          final_amount_usd: 50,
          status: "Delivered_Paid",
          exchange_rate: 89500,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        },
        1,
      ),
    );
    expect(delivered.success).toBe(true);
    const txn = jobTxn(id)!;
    expect(txn.profit_usd).toBe(30);

    // Collect the per-day figure on every surface.
    const surfaces = (day: string) => ({
      byModule: r(maintModule(day)?.profit_usd),
      byCashier: r(byUserTotals(day).profit_usd),
      byClient: r(byClientTotals(day).profit_usd),
      closing: r(snapshot(day).totalProfitUSD),
    });
    const past = surfaces(PAST);
    const today = surfaces(TODAY);
    // Exactly one day carries the $30, and every surface agrees on which.
    // (Which day is correct — received vs delivered — is an owner decision;
    // this asserts only that the surfaces agree.)
    expect({ past, today }).toEqual(
      past.byModule === 30
        ? { past: { byModule: 30, byCashier: 30, byClient: 30, closing: 30 }, today: { byModule: 0, byCashier: 0, byClient: 0, closing: 0 } }
        : { past: { byModule: 0, byCashier: 0, byClient: 0, closing: 0 }, today: { byModule: 30, byCashier: 30, byClient: 30, closing: 30 } },
    );
  });

  it("[D9 web half] a backdated checkout (transaction_time) dates the job AND its transaction to the same day", () => {
    const res = t1(() =>
      svc().saveJob(
        {
          device_name: "Laptop",
          issue_description: "hinge",
          currency: "USD",
          cost_usd: 20,
          price_usd: 50,
          final_amount_usd: 50,
          status: "Delivered_Paid",
          exchange_rate: 89500,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
          transaction_time: PAST_ISO,
        },
        1,
      ),
    );
    expect(res.success).toBe(true);
    const id = res.id as number;
    const days = db
      .prepare(
        `SELECT date(m.created_at,'localtime') AS m_day, date(t.created_at,'localtime') AS t_day
           FROM maintenance m JOIN transactions t ON t.source_table='maintenance' AND t.source_id=m.id
          WHERE m.id=?`,
      )
      .get(id) as { m_day: string; t_day: string };
    expect(days.m_day).toBe(PAST);
    expect(days.t_day).toBe(days.m_day);
    // And the Profits tabs agree on that day.
    expect(r(maintModule(PAST)?.profit_usd)).toBe(30);
    expect(r(byUserTotals(PAST).profit_usd)).toBe(30);
  });
});

describe("LIRA-185 maintenance — D3: fully-discounted job ($0 net, no payments)", () => {
  beforeEach(fresh);

  it("closing and Profits agree (no negative -$20 in the closing)", () => {
    const res = t1(() =>
      svc().saveJob(
        {
          device_name: "Phone",
          issue_description: "free fix",
          currency: "USD",
          cost_usd: 20,
          price_usd: 50,
          discount_usd: 50,
          final_amount_usd: 0,
          status: "Delivered_Paid",
          payments: [],
        },
        1,
      ),
    );
    expect(res.success).toBe(true);
    expect(jobTxn(res.id as number)).toBeUndefined(); // no transaction written
    const snap = snapshot(TODAY);
    const summary = t1(() => profits().getSummary(TODAY, TODAY));
    expect(r(snap.totalProfitUSD)).toBe(r(summary.totals.gross_profit_usd));
    expect(r(snap.totalProfitUSD)).toBe(0);
    expect(r(maintModule(TODAY)?.profit_usd)).toBe(0);
  });
});

describe("LIRA-185 maintenance — D5/D7: keep-change on a maintenance checkout", () => {
  beforeEach(fresh);

  it("[D7] when kept_change_usd reaches core, the stamp, Profits and the closing all read $40 (one definition)", () => {
    const res = t1(() =>
      svc().saveJob(
        {
          device_name: "Phone",
          issue_description: "screen",
          currency: "USD",
          cost_usd: 20,
          price_usd: 50,
          final_amount_usd: 50,
          status: "Delivered_Paid",
          exchange_rate: 89500,
          payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
          change_given_usd: 0,
          kept_change_usd: 10,
        },
        1,
      ),
    );
    expect(res.success).toBe(true);
    expect(jobTxn(res.id as number)!.profit_usd).toBe(40);
    expect(r(maintModule(TODAY)?.profit_usd)).toBe(40);
    expect(r(snapshot(TODAY).totalProfitUSD)).toBe(40);
  });

  // [D5] used to hardcode the PRE-fix Maintenance page payload (kept_change_*
  // omitted from buildJobPayload's checkout block), asserting the resulting
  // $10-stuck-in-the-drawer-with-no-profit bug. The frontend fix now forwards
  // kept_change_usd/lbp (frontend/src/features/maintenance/pages/Maintenance/index.tsx),
  // guarded by
  // frontend/src/features/maintenance/pages/Maintenance/__tests__/Maintenance.keptChangePayload.test.tsx.
  // The core-side contract for a payload that DOES carry kept_change_usd is
  // already asserted by [D7] immediately above — a second case here would
  // just re-run the same core call with the same inputs.
});

describe("LIRA-185 maintenance — D8: void of a paid job", () => {
  beforeEach(fresh);

  it("after a same-day void, By Cashier / By Client revenue is $0 like By Module and the closing (not -$50)", () => {
    const res = t1(() =>
      svc().saveJob(
        {
          device_name: "Phone",
          issue_description: "screen",
          currency: "USD",
          cost_usd: 20,
          price_usd: 50,
          final_amount_usd: 50,
          status: "Delivered_Paid",
          exchange_rate: 89500,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        },
        1,
      ),
    );
    expect(res.success).toBe(true);
    const txn = jobTxn(res.id as number)!;
    // Sanity: before the void, By Cashier sees the job.
    expect(r(byUserTotals(TODAY).revenue_usd)).toBe(50);
    t1(() => getTransactionRepository().voidTransaction(txn.id, 1));
    expect(jobTxn(res.id as number)!.status).toBe("VOIDED");

    const result = {
      byModuleRevenue: r(maintModule(TODAY)?.revenue_usd),
      byModuleProfit: r(maintModule(TODAY)?.profit_usd),
      closingProfit: r(snapshot(TODAY).totalProfitUSD),
      byCashierRevenue: r(byUserTotals(TODAY).revenue_usd),
      byCashierProfit: r(byUserTotals(TODAY).profit_usd),
      byClientRevenue: r(byClientTotals(TODAY).revenue_usd),
    };
    expect(result).toEqual({
      byModuleRevenue: 0,
      byModuleProfit: 0,
      closingProfit: 0,
      byCashierRevenue: 0,
      byCashierProfit: 0,
      byClientRevenue: 0,
    });
  });
});
