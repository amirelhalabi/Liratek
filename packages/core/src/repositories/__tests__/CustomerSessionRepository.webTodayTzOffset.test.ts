/**
 * LIRA-237 wave 2 — `CustomerSessionRepository.getTodayAllSessions()` /
 * `getTodaySessions()` / `getSessionsByDateRange()` used to hand-roll
 * `date(started_at, 'localtime') = date('now', 'localtime')` (and a
 * `>= ? AND <= ?` range variant): on a Fly web host (UTC, no `TZ` pinned —
 * rule 27), both sides resolve in the CONTAINER's day, so a customer
 * session started between 00:00 and 03:00 Beirut (still the previous UTC
 * day) was invisible to "today"'s session list until the container's own
 * day caught up ~3 hours later, and a date-range pick (e.g. "just today")
 * silently excluded it too.
 *
 * The fix (`isToday()`/`localDayExpr()`, `reportingTimeFragments.ts`)
 * shifts both sides by the client's offset via `localtimeModifier()`
 * instead — same mechanism as `ProfitRepository.webClientTzOffset.test.ts`
 * / `SalesRepository.webTodayTzOffset.test.ts`.
 *
 * Runs under ANY machine timezone (including CI's `TZ=Asia/Beirut` — core's
 * real test script, `cross-env TZ=Asia/Beirut jest`). A UTC Fly host with no
 * client offset behaves EXACTLY like an explicit `clientTzOffsetMinutes: 0`
 * (`localtimeModifier()`'s numeric-minutes branch never touches SQLite's
 * host-dependent `'localtime'` string), so the bug-reproduction test below
 * uses offset 0 vs offset 180 (Beirut) rather than relying on this runner's
 * OS zone actually being UTC. The no-offset desktop-fallback test computes
 * its expectation from SQLite's own `'localtime'` on THIS runner instead of
 * hardcoding a UTC-only answer.
 *
 * Rule 17: written and run BEFORE `CustomerSessionRepository.ts` is
 * touched — the "fix" tests below are expected to FAIL on the current
 * hardcoded-'localtime' code (see the recorded red run in the task
 * report). The first test proves the OLD predicate's failure directly.
 *
 * `CustomerSessionRepository` takes its `db` straight in its constructor
 * (no singleton/`getDatabase()` indirection), so no `__LIRATEK_TEST_DB__`
 * global is needed here.
 *
 * The boundary session's `started_at` (and `BEIRUT_DAY`, the bound the
 * fixed-range `getSessionsByDateRange` tests use) are computed from the
 * REAL `Date.now()` at test-run time via `dayBoundaryInstant()`/`localDay()`
 * (`helpers/boundaryInstant.ts`), not a fixed calendar date — a hardcoded
 * "2026-09-27 22:30:00"/"2026-09-28" pair only reads as "today" against SQL
 * `'now'` on one specific real-world day.
 */

import Database from "better-sqlite3";
import { CustomerSessionRepository } from "../CustomerSessionRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { dayBoundaryInstant, localDay } from "../testHelpers/boundaryInstant.js";

let db: Database.Database;
let repo: CustomerSessionRepository;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE customer_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      customer_name TEXT,
      customer_phone TEXT,
      customer_notes TEXT,
      user_id INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      started_by TEXT NOT NULL,
      closed_by TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      checkout_total_usd REAL,
      checkout_total_lbp REAL,
      checkout_profit_usd REAL,
      checkout_profit_lbp REAL,
      CHECK (is_active IN (0, 1))
    );

    CREATE TABLE customer_session_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      session_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE session_cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      session_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      module TEXT NOT NULL,
      label TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      form_data TEXT NOT NULL DEFAULT '{}',
      ipc_channel TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE
    );
  `);
}

const BEIRUT_OFFSET_MINUTES = 180;

// Computed fresh in beforeEach from the REAL current instant, so the
// boundary session is always "today" in Beirut but "yesterday" for a
// bare-UTC host, on any calendar date (and BEIRUT_DAY, used by the
// fixed-range `getSessionsByDateRange` tests, stays the exact day the
// boundary row itself falls on in Beirut — see boundaryInstant.ts).
let BOUNDARY_STARTED_AT_UTC: string;
let BEIRUT_DAY: string;

beforeEach(() => {
  const nowMs = Date.now();
  BOUNDARY_STARTED_AT_UTC = dayBoundaryInstant(nowMs, BEIRUT_OFFSET_MINUTES);
  BEIRUT_DAY = localDay(nowMs, BEIRUT_OFFSET_MINUTES);
  db = new Database(":memory:");
  createSchema(db);
  db.prepare(
    `INSERT INTO customer_sessions
       (tenant_id, customer_name, started_by, started_at, is_active)
     VALUES (1, 'Boundary Customer', 'admin', ?, 0)`,
  ).run(BOUNDARY_STARTED_AT_UTC);
  repo = new CustomerSessionRepository(db);
});

afterEach(() => {
  db.close();
});

describe("LIRA-237 wave 2 — CustomerSessionRepository 'today' web boundary", () => {
  it("a UTC Fly host with no client offset (== explicit offset 0) drops the boundary session from 'today', while a Beirut client offset (180) includes it — the bug, reproduced without depending on this runner's OS timezone or the calendar date", () => {
    // Scoped to getTodayAllSessions() ('now'-relative) only — see this
    // file's note below on why getSessionsByDateRange's OWN bug-reproduction
    // is NOT safe to combine with this one under an arbitrary real "now".
    const utcToday = runWithTenant(1, () => repo.getTodayAllSessions(), {
      clientTzOffsetMinutes: 0,
    });
    const beirutToday = runWithTenant(1, () => repo.getTodayAllSessions(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(utcToday).toHaveLength(0);
    expect(beirutToday).toHaveLength(1);
  });

  // `getSessionsByDateRange()` is a FIXED-RANGE method (like Product's
  // addedFrom/addedTo, Profit's from/to) — it compares the column against
  // literal `BEIRUT_DAY` bounds, never against SQL `'now'`, so unlike
  // `getTodayAllSessions()`/`getTodaySessions()` it was never subject to the
  // calendar-date lock this file's boundary row now avoids. It is
  // deliberately NOT given its own "offset 0 excludes" bug-reproduction test
  // here: `dayBoundaryInstant()` only guarantees the row's UTC day differs
  // from `now`'s OWN UTC day (what `isToday()`-style comparisons need) — in
  // the ~3-hours-a-day window where "now" itself is between local midnight
  // and `offsetHours` (Beirut 00:00-03:00), the row's UTC day is
  // CONSTRUCTED to equal `BEIRUT_DAY` itself (see boundaryInstant.ts's
  // "noon" branch), so an offset-0 range query against that same literal
  // `BEIRUT_DAY` bound would (correctly) still include it — asserting
  // exclusion there would be flaky for a reason that has nothing to do with
  // `getSessionsByDateRange`'s own correctness. The "fix" test below (offset
  // 180 -> included) and the no-offset fallback test (ground truth computed
  // from THIS runner's own SQLite 'localtime') both remain fully covered.

  it("getTodayAllSessions() includes the boundary session when the request carries the client's (Beirut) offset (the fix)", () => {
    const sessions = runWithTenant(1, () => repo.getTodayAllSessions(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].customer_name).toBe("Boundary Customer");
  });

  it("getTodaySessions() includes the boundary session when the request carries the client's (Beirut) offset (the fix)", () => {
    const sessions = runWithTenant(1, () => repo.getTodaySessions(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(sessions).toHaveLength(1);
  });

  it("getSessionsByDateRange(BEIRUT_DAY, BEIRUT_DAY) includes the boundary session when the request carries the client's (Beirut) offset (the fix)", () => {
    const sessions = runWithTenant(
      1,
      () => repo.getSessionsByDateRange(BEIRUT_DAY, BEIRUT_DAY),
      { clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES },
    );
    expect(sessions).toHaveLength(1);
  });

  it("without a client offset, all three still use the HOST's OWN OS day (SQLite 'localtime') — the fallback is inert, not a silent fix", () => {
    // Ground truth computed from SQLite's own 'localtime' on THIS runner
    // (whatever its OS timezone is), not a hardcoded UTC-only answer.
    const { matchesToday } = db
      .prepare(
        `SELECT (date(started_at, 'localtime') = date('now', 'localtime')) AS matchesToday
         FROM customer_sessions WHERE id = 1`,
      )
      .get() as { matchesToday: number };
    const { inRange } = db
      .prepare(
        `SELECT (date(started_at, 'localtime') >= date(?) AND date(started_at, 'localtime') <= date(?)) AS inRange
         FROM customer_sessions WHERE id = 1`,
      )
      .get(BEIRUT_DAY, BEIRUT_DAY) as { inRange: number };

    const today = runWithTenant(1, () => repo.getTodayAllSessions());
    const sessions = runWithTenant(1, () => repo.getTodaySessions());
    const range = runWithTenant(1, () =>
      repo.getSessionsByDateRange(BEIRUT_DAY, BEIRUT_DAY),
    );
    expect(today).toHaveLength(matchesToday ? 1 : 0);
    expect(sessions).toHaveLength(matchesToday ? 1 : 0);
    expect(range).toHaveLength(inRange ? 1 : 0);
  });
});
