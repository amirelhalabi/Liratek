/**
 * ClosingRepository — "today" is the machine-LOCAL business day, not UTC.
 *
 * SQLite stores created_at in UTC. A transaction made at 01:00 Beirut is stored
 * as the PREVIOUS UTC day (22:00). The old `getDailyStatsSnapshot` filtered with
 * `DATE(created_at) = <JS UTC today>`, so that transaction fell out of "today"
 * for the 00:00–03:00 Beirut window and the day rolled over at 03:00 local. The
 * fix uses `DATE(created_at, 'localtime') = DATE('now', 'localtime')` (the
 * convention already used by SalesRepository et al.), so the boundary row counts
 * under the LOCAL day.
 *
 * This test MUST run with TZ pinned to a non-UTC zone at PROCESS LAUNCH
 * (`TZ=Asia/Beirut jest ...`) — SQLite's `'localtime'` reads the C runtime zone
 * once, so a mid-test `process.env.TZ` assignment is unreliable. The beforeAll
 * probe fails loudly if the zone isn't actually non-UTC (e.g. a UTC CI runner
 * without the launch env), which would otherwise make every assertion hollow.
 *
 * Rule 17: proven to FAIL on the pre-fix `DATE(created_at) = <UTC today>` query
 * (boundary row excluded → salesCount 0) before the localtime change; reverted
 * and confirmed identical via git diff.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: ClosingRepository;

/** Minimal schema covering every table getDailyStatsSnapshot() reads. */
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
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
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
    );
    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT
    );
  `);
}

/**
 * UTC timestamp for "today-LOCAL at HH:00" — i.e. its local calendar day is
 * today but (for early hours in a positive-offset zone) its UTC day is
 * yesterday. Built inside SQLite so it uses the same zone as the queries.
 */
function localTodayAtUtc(hour: string): string {
  return db
    .prepare(
      `SELECT datetime(date('now','localtime') || ' ${hour}:00:00', 'utc') AS ts`,
    )
    .get() as { ts: string } extends never
    ? string
    : string as unknown as string;
}

beforeAll(() => {
  db = new Database(":memory:");
  // Probe: the pinned zone must actually differ from UTC, or the whole test is
  // hollow (the fix and the bug would behave identically under UTC).
  const { off } = db
    .prepare(
      `SELECT strftime('%s','now') - strftime('%s','now','localtime') AS off`,
    )
    .get() as { off: number };
  if (off === 0) {
    throw new Error(
      "SQLite 'localtime' == UTC — run this suite with TZ=Asia/Beirut at launch " +
        "(TZ=Asia/Beirut jest …). Offset was 0, so the local-vs-UTC assertions prove nothing.",
    );
  }
  db.close();
});

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  repo = new ClosingRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ClosingRepository.getDailyStatsSnapshot — local business day", () => {
  it("counts a 01:00-local sale under TODAY even though its UTC day is yesterday", () => {
    // created_at = today-local 01:00 → stored as yesterday 22:00 UTC in Beirut.
    const boundaryTs = db
      .prepare(
        `SELECT datetime(date('now','localtime') || ' 01:00:00', 'utc') AS ts`,
      )
      .get() as { ts: string };

    db.prepare(
      `INSERT INTO sales (tenant_id, final_amount_usd, paid_usd, paid_lbp, status, created_at)
       VALUES (1, 25, 25, 0, 'completed', ?)`,
    ).run(boundaryTs.ts);
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, is_refunded)
       VALUES (1, 1, 25, 10, 0)`,
    ).run();

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());

    // Pre-fix (UTC filter) this was 0 / 0 — the sale fell under "yesterday".
    expect(snap.salesCount).toBe(1);
    expect(snap.totalSalesUSD).toBe(25);
    expect(snap.totalProfitUSD).toBeCloseTo(15, 2); // 25 − 10, fully paid
  });

  it("counts a 01:00-local expense under TODAY (expense_date localtime bucketing)", () => {
    const boundaryTs = db
      .prepare(
        `SELECT datetime(date('now','localtime') || ' 01:00:00', 'utc') AS ts`,
      )
      .get() as { ts: string };

    db.prepare(
      `INSERT INTO expenses (tenant_id, amount_usd, amount_lbp, expense_date)
       VALUES (1, 7, 0, ?)`,
    ).run(boundaryTs.ts);

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalExpensesUSD).toBe(7);
  });

  it("excludes a sale from two local days ago", () => {
    const oldTs = db
      .prepare(
        `SELECT datetime(date('now','localtime','-2 days') || ' 12:00:00', 'utc') AS ts`,
      )
      .get() as { ts: string };

    db.prepare(
      `INSERT INTO sales (tenant_id, final_amount_usd, paid_usd, status, created_at)
       VALUES (1, 99, 99, 'completed', ?)`,
    ).run(oldTs.ts);

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.salesCount).toBe(0);
    expect(snap.totalSalesUSD).toBeFalsy();
  });
});
