/**
 * LIRA-237 — web daily reports must bucket a row by the CLIENT's (Beirut)
 * day, not the Fly host's (UTC) day.
 *
 * `ProfitRepository.dateRange()` used to hardcode SQLite's `'localtime'`
 * modifier, which reads the QUERY HOST's OS timezone. On desktop that host
 * IS the shop's PC (Beirut), so it was always correct there. On web the
 * host is a Fly container with no `TZ` pinned (UTC, by design — rule 27), so
 * `'localtime'` there is the CONTAINER's day: a row written between 00:00
 * and 03:00 Beirut (still the PREVIOUS UTC day) fell out of "today"'s
 * window in a web report.
 *
 * The fix threads the browser's own UTC offset through the SAME
 * `runWithTenant()` AsyncLocalStorage scope `clientDay` already uses (see
 * `reportingTimeFragments.ts`'s `localtimeModifier()`), set by
 * `authenticateJWT` from the `X-Client-Tz-Offset` header
 * (`backend/src/middleware/auth.ts`) — sent on every request by
 * `httpClient.ts`.
 *
 * Runs under ANY machine timezone (including CI's `TZ=Asia/Beirut` — core's
 * real test script, `cross-env TZ=Asia/Beirut jest`). `getSalesRevCost`'s
 * `from`/`to` bounds are fixed literal timestamps (not `'now'`), so once the
 * bug-reproduction test uses explicit `clientTzOffsetMinutes` instead of
 * SQLite's host-dependent `'localtime'` string it is fully deterministic on
 * any host: a UTC Fly host with no client offset behaves EXACTLY like an
 * explicit `clientTzOffsetMinutes: 0` (`localtimeModifier()`'s
 * numeric-minutes branch never touches `'localtime'`). The no-offset
 * desktop-fallback test computes its expectation from SQLite's own
 * `'localtime'` on THIS runner instead of hardcoding a UTC-only answer.
 *
 * Rule 17 note: `ProfitRepository.dateRange()`/`localtimeModifier()` were
 * already implemented by the time this file was written (the tenant-context
 * plumbing was built first) — this is NOT proven failing-first on a
 * reverted `dateRange()`, per the no-revert rule. To still prove the
 * mechanism directly (rather than merely asserting the new code "works"),
 * the first test below calls `getSalesRevCost` itself with an explicit
 * offset of 0 (the Fly-host-equivalent) alongside 180 (Beirut) and shows the
 * boundary row is genuinely dropped/recovered — a real, executed
 * before/after of the mechanism, independent of this runner's OS zone.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: ProfitRepository;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT,
      paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000, final_amount_usd REAL, created_at TEXT
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER,
      sold_price_usd REAL, cost_price_snapshot_usd REAL, quantity REAL DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL, transaction_type TEXT,
      reference_table TEXT, reference_id INTEGER,
      amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT, user_id INTEGER, settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    -- LIRA-258 / G36: the net-obligation fragments read transactions to
    -- link item-refund / undo partner rows back to their sale
    -- (constants/partnerObligation.ts). Production schema always has it.
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT,
      source_id INTEGER
    );
  `);
}

// A sale at 01:30 Beirut (UTC+3) on 2026-09-28, stored as UTC per
// CURRENT_TIMESTAMP convention — the exact 00:00-03:00 Beirut boundary
// window the ticket names.
const BOUNDARY_SALE_UTC = "2026-09-27 22:30:00";
const BEIRUT_DAY = "2026-09-28";
const BEIRUT_OFFSET_MINUTES = 180;

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  db.prepare(
    `INSERT INTO sales (tenant_id, status, paid_usd, paid_lbp, final_amount_usd, created_at)
     VALUES (1, 'completed', 40, 0, 40, ?)`,
  ).run(BOUNDARY_SALE_UTC);
  db.prepare(
    `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
     VALUES (1, 1, 40, 25, 1, 0)`,
  ).run();
  repo = new ProfitRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("LIRA-237 — web (UTC Fly host) client-day boundary", () => {
  it("a UTC Fly host with no client offset (== explicit offset 0) drops the 01:30-Beirut sale from the Beirut day's window, while a Beirut client offset (180) includes it — the bug, reproduced without depending on this runner's OS timezone", () => {
    const asUtcHost = runWithTenant(
      1,
      () =>
        repo.getSalesRevCost(`${BEIRUT_DAY} 00:00:00`, `${BEIRUT_DAY} 23:59:59`),
      { clientTzOffsetMinutes: 0 },
    );
    const asBeirutClient = runWithTenant(
      1,
      () =>
        repo.getSalesRevCost(`${BEIRUT_DAY} 00:00:00`, `${BEIRUT_DAY} 23:59:59`),
      { clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES },
    );
    // With offset 0 (the stored 22:30-on-the-27th UTC value never enters
    // the 28th's window), this is the LIRA-237 bug.
    expect(asUtcHost.count).toBe(0);
    expect(asBeirutClient.count).toBe(1);
    expect(asBeirutClient.revenue_usd).toBe(40);
    expect(asBeirutClient.cost_usd).toBe(25);
  });

  it("ProfitRepository.getSalesRevCost includes the same sale when the request carries the client's (Beirut) offset (the fix)", () => {
    const result = runWithTenant(
      1,
      () =>
        repo.getSalesRevCost(`${BEIRUT_DAY} 00:00:00`, `${BEIRUT_DAY} 23:59:59`),
      { clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES },
    );

    expect(result.count).toBe(1);
    expect(result.revenue_usd).toBe(40);
    expect(result.cost_usd).toBe(25);
  });

  it("without a client offset (no header), the same request still uses the HOST's OWN OS day (SQLite 'localtime') — the fallback is inert, not a silent fix", () => {
    // Ground truth computed from SQLite's own 'localtime' on THIS runner
    // (whatever its OS timezone is), not a hardcoded UTC-only answer.
    const { matches } = db
      .prepare(
        `SELECT (datetime(created_at, 'localtime') >= ? AND datetime(created_at, 'localtime') <= ?) AS matches
         FROM sales WHERE id = 1`,
      )
      .get(`${BEIRUT_DAY} 00:00:00`, `${BEIRUT_DAY} 23:59:59`) as {
      matches: number;
    };

    const result = runWithTenant(1, () =>
      repo.getSalesRevCost(`${BEIRUT_DAY} 00:00:00`, `${BEIRUT_DAY} 23:59:59`),
    );
    // No clientTzOffsetMinutes supplied -> localtimeModifier() falls back to
    // SQLite's own 'localtime', which reads THIS machine's OS zone.
    // Documents that the fix depends on the header actually being sent
    // (httpClient.ts sends it on every authenticated request) — the
    // fallback is the desktop behavior (correct there), not a silent fix
    // for a UTC host.
    expect(result.count).toBe(matches ? 1 : 0);
  });
});
