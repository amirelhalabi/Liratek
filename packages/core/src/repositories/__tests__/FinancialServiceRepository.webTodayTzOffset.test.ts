/**
 * LIRA-237 wave 2 — `FinancialServiceRepository.getAnalytics()`'s "today"
 * and "this month" cards used to hand-roll
 * `DATE(created_at, 'localtime') = DATE('now', 'localtime')` and
 * `strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')`
 * five times combined: on a Fly web host (UTC, no `TZ` pinned — rule 27),
 * both sides resolve in the CONTAINER's day/month, so an OMT/Whish
 * transaction made between 00:00 and 03:00 Beirut (still the previous UTC
 * day) was invisible to "today"'s card until the container's own day
 * caught up ~3 hours later, and a transaction made in the last ~3 hours of
 * a UTC month (already the 1st in Beirut) was booked into last month's
 * card instead of this month's.
 *
 * The fix (`isToday()`/`isThisMonth()`, `reportingTimeFragments.ts`) shifts
 * both sides by the client's offset via `localtimeModifier()` instead —
 * same mechanism as `ProfitRepository.webClientTzOffset.test.ts` /
 * `SalesRepository.webTodayTzOffset.test.ts`.
 *
 * Runs under ANY machine timezone (including CI's `TZ=Asia/Beirut` — core's
 * real test script, `cross-env TZ=Asia/Beirut jest`). A UTC Fly host with no
 * client offset behaves EXACTLY like an explicit `clientTzOffsetMinutes: 0`
 * (`localtimeModifier()`'s numeric-minutes branch never touches SQLite's
 * host-dependent `'localtime'` string), so the day/month bug-reproduction
 * tests below use offset 0 vs offset 180 (Beirut) rather than relying on
 * this runner's OS zone actually being UTC. The no-offset desktop-fallback
 * test computes its expectation from SQLite's own `'localtime'`/`strftime`
 * on THIS runner instead of hardcoding a UTC-only answer.
 *
 * Rule 17: written and run BEFORE `FinancialServiceRepository.ts` is
 * touched — the "fix" tests below are expected to FAIL on the current
 * hardcoded-'localtime' code (see the recorded red run in the task
 * report). The first test proves the OLD day predicate's failure directly.
 *
 * Both boundary rows' `created_at` are computed from the REAL `Date.now()`
 * at test-run time via `dayBoundaryInstant()`/`monthBoundaryInstant()`
 * (`helpers/boundaryInstant.ts`), not a fixed calendar date — a hardcoded
 * "2026-08-31 22:30:00"/"2026-09-27 22:30:00" pair only reproduces the bug
 * on one specific real-world date, and the month case broke on the 1st of
 * ANY month (not just outside September 2026).
 *
 * The day-focused assertions call `getAnalytics(['OMT'])` (and the
 * month-boundary bug-repro test calls `getAnalytics(['WHISH'])`) rather than
 * the unfiltered `getAnalytics()` production default: `monthBoundaryInstant`
 * always places the WHISH row on the 1st of the current local month, and on
 * the ~1-in-30 real-world run where "today" itself IS the 1st, the OMT
 * day-boundary row and the WHISH month-boundary row would land on the SAME
 * Beirut calendar day — an unfiltered `.today.count` would then (correctly!)
 * count both, breaking a hardcoded "count is exactly 1" expectation for a
 * reason that has nothing to do with the day/month mechanism under test.
 * Filtering by provider isolates each boundary row's own mechanism from the
 * other row's, independent of which day of the month the suite executes on.
 * The "BOTH boundary transactions" test and the no-offset fallback test are
 * unaffected (see their own comments) and stay unfiltered.
 *
 * Schema copied from the minimal `financial_services` shape already
 * exercised by `FinancialServiceRepository.tenantIsolation.test.ts`'s
 * `getAnalytics()` coverage (no `commission_model` column — that makes
 * `_hasCommissionModelColumn()` degrade to its documented pre-LIRA-158
 * fallback, which `getAnalytics()` is built to tolerate).
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import {
  dayBoundaryInstant,
  monthBoundaryInstant,
} from "../testHelpers/boundaryInstant.js";

let db: Database.Database;
let repo: FinancialServiceRepository;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE financial_services (
      tenant_id INTEGER,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL, service_type TEXT NOT NULL, amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL, commission REAL DEFAULT 0,
      cost REAL DEFAULT 0, price REAL DEFAULT 0, paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER, client_name TEXT, reference_number TEXT, phone_number TEXT,
      omt_service_type TEXT, omt_fee REAL DEFAULT 0, whish_fee REAL DEFAULT 0,
      profit_rate REAL, pay_fee INTEGER DEFAULT 0, payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL, item_key TEXT, note TEXT,
      sender_name TEXT, sender_phone TEXT, receiver_name TEXT, receiver_phone TEXT,
      sender_client_id INTEGER, receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1, settled_at TEXT, settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, created_by INTEGER,
      paid_amount REAL DEFAULT NULL, paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER, partner_mode TEXT,
      edited_by TEXT DEFAULT NULL, edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER NOT NULL DEFAULT 0, refunded_at TEXT,
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0
    );
  `);
}

const BEIRUT_OFFSET_MINUTES = 180;

// An OMT SEND at the DAY boundary, and a WHISH SEND at the MONTH boundary —
// both computed fresh each run from the real current instant.
let DAY_BOUNDARY_TX_UTC: string;
let MONTH_BOUNDARY_TX_UTC: string;

beforeEach(() => {
  const nowMs = Date.now();
  DAY_BOUNDARY_TX_UTC = dayBoundaryInstant(nowMs, BEIRUT_OFFSET_MINUTES);
  MONTH_BOUNDARY_TX_UTC = monthBoundaryInstant(nowMs, BEIRUT_OFFSET_MINUTES);
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  db.prepare(
    `INSERT INTO financial_services
       (tenant_id, provider, service_type, amount, currency, commission, is_settled, created_at)
     VALUES (1, 'OMT', 'SEND', 100, 'USD', 5, 1, ?)`,
  ).run(DAY_BOUNDARY_TX_UTC);
  db.prepare(
    `INSERT INTO financial_services
       (tenant_id, provider, service_type, amount, currency, commission, is_settled, created_at)
     VALUES (1, 'WHISH', 'SEND', 100, 'USD', 7, 1, ?)`,
  ).run(MONTH_BOUNDARY_TX_UTC);
  repo = new FinancialServiceRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("LIRA-237 wave 2 — FinancialServiceRepository.getAnalytics() web 'today'/'this month' boundary", () => {
  it("a UTC Fly host with no client offset (== explicit offset 0) drops the day-boundary OMT row from 'today', while a Beirut client offset (180) counts it — the bug, reproduced without depending on this runner's OS timezone or the calendar date", () => {
    // Scoped to provider 'OMT' — isolates the day-boundary row's own
    // mechanism from the WHISH month-boundary row (see this file's
    // docblock for why an unfiltered call is not safe here).
    const asUtcHost = runWithTenant(1, () => repo.getAnalytics(["OMT"]), {
      clientTzOffsetMinutes: 0,
    });
    const asBeirutClient = runWithTenant(1, () => repo.getAnalytics(["OMT"]), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(asUtcHost.today.count).toBe(0);
    expect(asUtcHost.today.commission).toBe(0);
    expect(asBeirutClient.today.count).toBe(1);
    expect(asBeirutClient.today.commission).toBe(5);
  });

  it("a UTC Fly host with no client offset (== explicit offset 0) books the month-boundary WHISH row into the WRONG (UTC) month, while a Beirut client offset (180) books it into the client's month — the bug, reproduced without depending on this runner's OS timezone or the calendar date", () => {
    // Scoped to provider 'WHISH' — isolates the month-boundary row's own
    // mechanism from the OMT day-boundary row (see this file's docblock).
    const asUtcHost = runWithTenant(1, () => repo.getAnalytics(["WHISH"]), {
      clientTzOffsetMinutes: 0,
    });
    const asBeirutClient = runWithTenant(1, () => repo.getAnalytics(["WHISH"]), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    // Under offset 0 (pure UTC), the month-boundary row is still last
    // month's — monthBoundaryInstant() guarantees utcMonth(T) != this
    // month's UTC month.
    expect(asUtcHost.month.count).toBe(0);
    expect(asUtcHost.month.commission).toBe(0);
    // Under the Beirut offset, the row lands in the client's current month.
    expect(asBeirutClient.month.count).toBe(1);
    expect(asBeirutClient.month.commission).toBe(7);
  });

  it("getAnalytics().today counts the day-boundary transaction's commission when the request carries the client's (Beirut) offset (the fix)", () => {
    const analytics = runWithTenant(1, () => repo.getAnalytics(["OMT"]), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(analytics.today.count).toBe(1);
    expect(analytics.today.commission).toBe(5);
  });

  it("getAnalytics().month counts BOTH boundary transactions' commission when the request carries the client's (Beirut) offset — the OLD code only ever counted the day-boundary one (the fix)", () => {
    // Unfiltered is safe here: dayBoundaryInstant()'s day-match invariant is
    // strictly stronger than month-match (same calendar day implies same
    // month), so the OMT row is unconditionally within "this month" too —
    // no dependency on which day of the month the suite runs on.
    const analytics = runWithTenant(1, () => repo.getAnalytics(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(analytics.month.count).toBe(2);
    expect(analytics.month.commission).toBe(12);
  });

  it("without a client offset, getAnalytics().today/.month still use the HOST's OWN OS day/month (SQLite 'localtime') — the fallback is inert, not a silent fix", () => {
    // Ground truth computed from SQLite's own 'localtime' on THIS runner
    // (whatever its OS timezone is), not a hardcoded UTC-only answer.
    // Mirrors getAnalytics()'s own predicates exactly: `count` is COUNT(*)
    // over the day/month window (no provider filter, no settlement filter
    // when getAnalytics() is called with no provider argument, as here);
    // `commission` sums only settled rows (both fixture rows are settled).
    const dayGroundTruth = db
      .prepare(
        `SELECT
           SUM(CASE WHEN DATE(created_at, 'localtime') = DATE('now', 'localtime')
                    THEN 1 ELSE 0 END) AS count,
           SUM(CASE WHEN DATE(created_at, 'localtime') = DATE('now', 'localtime')
                      AND is_settled = 1 THEN commission ELSE 0 END) AS commission
         FROM financial_services`,
      )
      .get() as { count: number; commission: number };
    const monthGroundTruth = db
      .prepare(
        `SELECT
           SUM(CASE WHEN strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')
                    THEN 1 ELSE 0 END) AS count,
           SUM(CASE WHEN strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')
                      AND is_settled = 1 THEN commission ELSE 0 END) AS commission
         FROM financial_services`,
      )
      .get() as { count: number; commission: number };

    const analytics = runWithTenant(1, () => repo.getAnalytics());
    expect(analytics.today.count).toBe(dayGroundTruth.count);
    expect(analytics.today.commission).toBe(dayGroundTruth.commission);
    expect(analytics.month.count).toBe(monthGroundTruth.count);
    expect(analytics.month.commission).toBe(monthGroundTruth.commission);
  });
});
