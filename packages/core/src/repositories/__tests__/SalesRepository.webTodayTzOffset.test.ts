/**
 * LIRA-237 — `SalesRepository.getDashboardStats()`'s "today" queries used to
 * hand-roll `DATE(created_at, 'localtime') = DATE('now', 'localtime')` four
 * times: on a Fly web host (UTC, no `TZ` pinned — rule 27), both sides of
 * that comparison resolve in the CONTAINER's day, so a sale made between
 * 00:00 and 03:00 Beirut (still the previous UTC day) was invisible to
 * "today"'s dashboard stats until the container's own day caught up ~3
 * hours later.
 *
 * The fix (`isToday()`, `reportingTimeFragments.ts`) shifts BOTH sides by
 * the client's offset via `localtimeModifier()` instead.
 *
 * Runs under ANY machine timezone (including CI's `TZ=Asia/Beirut` — core's
 * real test script, `cross-env TZ=Asia/Beirut jest`). A UTC Fly host with no
 * client offset behaves EXACTLY like an explicit `clientTzOffsetMinutes: 0`
 * (`localtimeModifier()`'s numeric-minutes branch — `'0 minutes'` — never
 * touches SQLite's host-dependent `'localtime'` string), so the first test
 * below reproduces the bug by supplying offset 0 and comparing it against
 * offset 180 (Beirut), instead of relying on this runner's OS zone actually
 * being UTC. The one assertion that DOES need the host's real `'localtime'`
 * (the no-offset desktop fallback, last test) computes its expectation from
 * SQLite itself on THIS runner rather than hardcoding a UTC-only answer, so
 * it is correct under Beirut, UTC, or anything else.
 *
 * Rule 17 note: same as `ProfitRepository.webClientTzOffset.test.ts` — the
 * fix landed before this file (no-revert rule), so the first test proves
 * the OLD predicate's failure directly and independently of any source
 * file's current state, rather than by reverting `isToday()`.
 *
 * The boundary sale's `created_at` is computed from the REAL `Date.now()`
 * at test-run time via `dayBoundaryInstant()` (`helpers/boundaryInstant.ts`),
 * not a fixed calendar date — a hardcoded "2026-09-27 22:30:00" anchor only
 * reads as "today" against SQL `'now'` on one specific real-world day. See
 * that helper's doc comment for the construction.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { dayBoundaryInstant } from "../testHelpers/boundaryInstant.js";

let db: Database.Database;
let repo: SalesRepository;
let BOUNDARY_SALE_UTC: string;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT,
      paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0,
      change_given_usd REAL DEFAULT 0, change_given_lbp REAL DEFAULT 0,
      final_amount_usd REAL DEFAULT 0, created_at TEXT
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      transaction_type TEXT, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      created_at TEXT
    );
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      stock_quantity REAL DEFAULT 0, min_stock_level REAL DEFAULT 0, is_active INTEGER DEFAULT 1
    );
    -- LIRA-244: getDashboardStats()'s "Cash Collected" arm now sources
    -- tendered cash from payments/transactions (immutable — see
    -- SalesRepository.ts's cashFromSalesResult doc), not sales.paid_usd.
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      source_table TEXT, source_id INTEGER, created_at TEXT
    );
    -- LIRA-244 follow-up round 2 -- getDashboardStats()'s
    -- cashFromSessionsResult arm (session-basket checkouts) reads
    -- payments.session_id; missing it here dies in setup looking like an
    -- assertion failure (CLAUDE.md's "Test schemas silently void whole
    -- files" note). This file's own fixture never inserts a session-linked
    -- row, so session_id is always NULL -- a no-op for its own tests.
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER,
      session_id INTEGER,
      method TEXT, drawer_name TEXT, currency_code TEXT, amount REAL,
      tenant_id INTEGER, created_at TEXT
    );
  `);
}

const BEIRUT_OFFSET_MINUTES = 180;

beforeEach(() => {
  // Computed fresh each run from the REAL current instant — always "today"
  // in Beirut but "yesterday" for a bare-UTC host, on any calendar date.
  BOUNDARY_SALE_UTC = dayBoundaryInstant(Date.now(), BEIRUT_OFFSET_MINUTES);
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  const saleResult = db
    .prepare(
      `INSERT INTO sales (tenant_id, status, paid_usd, final_amount_usd, created_at)
       VALUES (1, 'completed', 40, 40, ?)`,
    )
    .run(BOUNDARY_SALE_UTC);
  const txnResult = db
    .prepare(
      `INSERT INTO transactions (tenant_id, source_table, source_id, created_at)
       VALUES (1, 'sales', ?, ?)`,
    )
    .run(saleResult.lastInsertRowid, BOUNDARY_SALE_UTC);
  db.prepare(
    `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, tenant_id, created_at)
     VALUES (?, 'CASH', 'General', 'USD', 40, 1, ?)`,
  ).run(txnResult.lastInsertRowid, BOUNDARY_SALE_UTC);
  repo = new SalesRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("LIRA-237 — SalesRepository.getDashboardStats() web 'today' boundary", () => {
  it("a UTC Fly host with no client offset (== explicit offset 0) drops the boundary sale from 'today', while a Beirut client offset (180) counts it — the bug, reproduced without depending on this runner's OS timezone", () => {
    const asUtcHost = runWithTenant(1, () => repo.getDashboardStats(), {
      clientTzOffsetMinutes: 0,
    });
    const asBeirutClient = runWithTenant(1, () => repo.getDashboardStats(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(asUtcHost.ordersCount).toBe(0);
    expect(asUtcHost.totalSalesUSD).toBe(0);
    expect(asBeirutClient.ordersCount).toBe(1);
    expect(asBeirutClient.totalSalesUSD).toBe(40);
  });

  it("getDashboardStats() counts the sale as today's when the request carries the client's (Beirut) offset (the fix)", () => {
    const stats = runWithTenant(1, () => repo.getDashboardStats(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(stats.ordersCount).toBe(1);
    expect(stats.totalSalesUSD).toBe(40);
  });

  it("without a client offset, getDashboardStats() still uses the HOST's OWN OS day (SQLite 'localtime') — the fallback is inert, not a silent fix", () => {
    // Ground truth computed from SQLite's own 'localtime' on THIS runner
    // (whatever its OS timezone is), not a hardcoded UTC-only answer —
    // the desktop fallback is supposed to read the machine's own zone.
    const { matchesToday } = db
      .prepare(
        `SELECT (DATE(?, 'localtime') = DATE('now', 'localtime')) AS matchesToday`,
      )
      .get(BOUNDARY_SALE_UTC) as { matchesToday: number };

    const stats = runWithTenant(1, () => repo.getDashboardStats());
    expect(stats.ordersCount).toBe(matchesToday ? 1 : 0);
    expect(stats.totalSalesUSD).toBe(matchesToday ? 40 : 0);
  });
});
