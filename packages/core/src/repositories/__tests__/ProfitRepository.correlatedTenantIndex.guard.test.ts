/**
 * Guard: a correlated sub-query on `transactions` must never be answered
 * through `idx_transactions_tenant_id`.
 *
 * Cornertech 2026-11-10: `/api/profits/summary` took ~19 s for ONE day and
 * froze the API (better-sqlite3 is synchronous). The planner answered the
 * per-sale `sxt` sub-query (`saleExtraUsdEquiv`) with the tenant index — one
 * tenant = every transaction the shop has — so each sale re-scanned ~17k
 * rows, several times. `constants/partnerObligation.ts:233` documents the
 * same trap and the fix: the unary `+` on the tenant term, which keeps the
 * planner on `idx_transactions_source` / the rowid.
 *
 * Per-tenant database files (owner plan 2026-11-10) make this worse, not
 * better: there every row shares one tenant_id, so a tenant index IS a full
 * scan. The plan is asserted here, on the real schema, for every profit
 * fragment and method that correlates on `transactions`.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  ProfitRepository,
  exchangeKeptProfitUsd,
  exchangeNotDebtPending,
  holdMoneyCountEligible,
  notReversedByRefund,
  saleTotalPaidUsdEquiv,
  warrantyCostCountEligible,
  wrongNumberRecoverySource,
} from "../ProfitRepository";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);

/** Every alias a profit fragment gives its correlated `transactions` row. */
const CORRELATED_ALIASES = [
  "sxt",
  "xdt",
  "r",
  "hmv",
  "wcr",
  "wnr",
  "kpt",
  "t2",
  "wsorig",
  "bdorig",
  "kcorig",
  "rkcu",
];

let db: Database.Database;
let captured: Array<{ sql: string; args: unknown[] }>;
let explain: (sql: string, args?: unknown[]) => string[];

beforeAll(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  const origPrepare = db.prepare.bind(db);
  explain = (sql, args = []) =>
    (
      origPrepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{
        detail: string;
      }>
    ).map((p) => p.detail);
  captured = [];
  // Capture every statement a repository method prepares, with its binds,
  // so the plan can be asked for the SQL the method really runs.
  (db as unknown as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
    const st = origPrepare(sql);
    for (const m of ["all", "get"] as const) {
      const f = st[m].bind(st);
      (st as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
        captured.push({ sql, args: a });
        return f(...a);
      };
    }
    return st;
  }) as typeof db.prepare;
});

afterAll(() => {
  resetTenantContext();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

function tenantIndexHits(plan: string[]): string[] {
  const aliases = CORRELATED_ALIASES.join("|");
  const re = new RegExp(
    `^SEARCH (${aliases}) USING .*idx_transactions_tenant_id`,
  );
  return plan.filter((d) => re.test(d));
}

describe("profit fragments: correlated transactions look-ups avoid the tenant index", () => {
  it.each([
    [
      "saleTotalPaidUsdEquiv (sxt)",
      `SELECT ${saleTotalPaidUsdEquiv("s")} FROM sales s`,
    ],
    [
      "exchangeNotDebtPending (xdt)",
      `SELECT 1 FROM exchange_transactions x WHERE ${exchangeNotDebtPending("x")}`,
    ],
    [
      "exchangeKeptProfitUsd (kpt)",
      `SELECT ${exchangeKeptProfitUsd("x")} FROM exchange_transactions x`,
    ],
    [
      "notReversedByRefund (r)",
      `SELECT 1 FROM transactions a WHERE ${notReversedByRefund("a")}`,
    ],
    [
      "holdMoneyCountEligible (hmv)",
      `SELECT 1 FROM transactions a WHERE ${holdMoneyCountEligible("a")}`,
    ],
    [
      "warrantyCostCountEligible (wcr)",
      `SELECT 1 FROM transactions a WHERE ${warrantyCostCountEligible("a")}`,
    ],
    [
      "wrongNumberRecoverySource (wnr)",
      `SELECT 1 FROM transactions a WHERE ${wrongNumberRecoverySource("a")}`,
    ],
  ])("%s", (_name, sql) => {
    expect(tenantIndexHits(explain(sql))).toEqual([]);
  });
});

describe("profit methods: no correlated transactions look-up uses the tenant index", () => {
  it.each([
    ["getPendingSaleProfit", (r: ProfitRepository) => r.getPendingSaleProfit()],
    [
      "getSalesProfit",
      (r: ProfitRepository) =>
        r.getSalesProfit("2026-11-01 00:00:00", "2026-11-30 23:59:59"),
    ],
    [
      "getSalesDetail",
      (r: ProfitRepository) =>
        r.getSalesDetail("2026-11-01 00:00:00", "2026-11-30 23:59:59"),
    ],
    [
      "getByDate",
      (r: ProfitRepository) =>
        r.getByDate(
          "2026-11-01",
          "2026-11-30",
          "2026-11-01 00:00:00",
          "2026-11-30 23:59:59",
        ),
    ],
  ])("%s", (_name, run) => {
    captured.length = 0;
    run(new ProfitRepository());
    const offenders: string[] = [];
    for (const c of captured) {
      if (!/transactions/.test(c.sql)) continue;
      for (const hit of tenantIndexHits(explain(c.sql, c.args))) {
        offenders.push(`${hit}  <=  ${c.sql.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
