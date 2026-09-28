/**
 * LIRA-237 wave 2 — `ExchangeRepository.getTodayTransactions()` /
 * `getTodayStats()` used to hand-roll
 * `DATE(created_at, 'localtime') = DATE('now', 'localtime')`: on a Fly web
 * host (UTC, no `TZ` pinned — rule 27), both sides resolve in the
 * CONTAINER's day, so an exchange made between 00:00 and 03:00 Beirut
 * (still the previous UTC day) was invisible to "today" until the
 * container's own day caught up ~3 hours later.
 *
 * The fix (`isToday()`, `reportingTimeFragments.ts`) shifts BOTH sides by
 * the client's offset via `localtimeModifier()` instead — same mechanism as
 * `ProfitRepository.webClientTzOffset.test.ts` /
 * `SalesRepository.webTodayTzOffset.test.ts`.
 *
 * Runs under ANY machine timezone (including CI's `TZ=Asia/Beirut` — core's
 * real test script, `cross-env TZ=Asia/Beirut jest`). A UTC Fly host with no
 * client offset behaves EXACTLY like an explicit `clientTzOffsetMinutes: 0`
 * (`localtimeModifier()`'s numeric-minutes branch never touches SQLite's
 * host-dependent `'localtime'` string), so the first test below reproduces
 * the bug with offset 0 vs offset 180 (Beirut) rather than relying on this
 * runner's OS zone actually being UTC. The no-offset desktop-fallback test
 * computes its expectation from SQLite's own `'localtime'` on THIS runner
 * instead of hardcoding a UTC-only answer.
 *
 * Rule 17: this file is written and run BEFORE `ExchangeRepository.ts` is
 * touched — the "fix" tests below are expected to FAIL on the current
 * hardcoded-'localtime' code (see the recorded red run in the task report).
 * The first test proves the OLD predicate's failure directly and
 * independently of any source file's current state.
 *
 * The boundary row's `created_at` is computed from the REAL `Date.now()` at
 * test-run time via `dayBoundaryInstant()` (`helpers/boundaryInstant.ts`),
 * not a fixed calendar date — a hardcoded "2026-09-27 22:30:00" anchor only
 * reads as "today" against SQL `'now'` on one specific real-world day.
 */

import Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { dayBoundaryInstant } from "../testHelpers/boundaryInstant.js";

let db: Database.Database;
let repo: ExchangeRepository;
let BOUNDARY_TX_UTC: string;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE exchange_transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      rate REAL,
      base_rate REAL,
      profit_usd REAL,
      leg1_rate REAL,
      leg1_market_rate REAL,
      leg1_profit_usd REAL,
      leg2_rate REAL,
      leg2_market_rate REAL,
      leg2_profit_usd REAL,
      via_currency TEXT,
      client_name TEXT,
      note TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

const BEIRUT_OFFSET_MINUTES = 180;

beforeEach(() => {
  BOUNDARY_TX_UTC = dayBoundaryInstant(Date.now(), BEIRUT_OFFSET_MINUTES);
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  db.prepare(
    `INSERT INTO exchange_transactions
       (tenant_id, type, from_currency, to_currency, amount_in, amount_out, rate, created_at)
     VALUES (1, 'sell', 'USD', 'LBP', 100, 9000000, 90000, ?)`,
  ).run(BOUNDARY_TX_UTC);
  repo = new ExchangeRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("LIRA-237 wave 2 — ExchangeRepository 'today' web boundary", () => {
  it("a UTC Fly host with no client offset (== explicit offset 0) drops the boundary exchange from 'today', while a Beirut client offset (180) counts it — the bug, reproduced without depending on this runner's OS timezone", () => {
    const asUtcHost = runWithTenant(1, () => repo.getTodayStats(), {
      clientTzOffsetMinutes: 0,
    });
    const asBeirutClient = runWithTenant(1, () => repo.getTodayStats(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(asUtcHost.count).toBe(0);
    expect(asBeirutClient.count).toBe(1);
    expect(asBeirutClient.totalIn).toBe(100);
  });

  it("getTodayTransactions() includes the boundary exchange when the request carries the client's (Beirut) offset (the fix)", () => {
    const rows = runWithTenant(1, () => repo.getTodayTransactions(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(rows).toHaveLength(1);
  });

  it("getTodayStats() counts the boundary exchange when the request carries the client's (Beirut) offset (the fix)", () => {
    const stats = runWithTenant(1, () => repo.getTodayStats(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(stats.count).toBe(1);
    expect(stats.totalIn).toBe(100);
  });

  it("without a client offset, getTodayTransactions()/getTodayStats() still use the HOST's OWN OS day (SQLite 'localtime') — the fallback is inert, not a silent fix", () => {
    const { matchesToday } = db
      .prepare(
        `SELECT (DATE(?, 'localtime') = DATE('now', 'localtime')) AS matchesToday`,
      )
      .get(BOUNDARY_TX_UTC) as { matchesToday: number };

    const rows = runWithTenant(1, () => repo.getTodayTransactions());
    const stats = runWithTenant(1, () => repo.getTodayStats());
    expect(rows).toHaveLength(matchesToday ? 1 : 0);
    expect(stats.count).toBe(matchesToday ? 1 : 0);
  });
});
