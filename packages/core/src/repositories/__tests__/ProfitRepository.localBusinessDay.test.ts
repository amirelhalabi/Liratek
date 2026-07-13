/**
 * ProfitRepository — the profit date range is the operator's LOCAL day, not UTC.
 *
 * ProfitService builds `"${from} 00:00:00"` / `"${to} 23:59:59"` and the repo's
 * `dateRange()` compares the created_at column against it. The old form
 * (`s.created_at >= ?`) compared the raw UTC timestamp, so a fully-paid sale at
 * 01:00 Beirut (stored as the PREVIOUS UTC day, 22:00) fell OUTSIDE a
 * same-local-day [from,to] window. The fix converts the column to local
 * wall-clock (`datetime(s.created_at, 'localtime') >= ?`) so it lands in the
 * local day the operator sees.
 *
 * Runs under TZ=Asia/Beirut (pinned by jest setupFiles); the beforeAll probe
 * guards against a UTC runner making the assertion hollow.
 *
 * Rule 17: proven to FAIL on the pre-fix `${col} >= ? AND ${col} <= ?` form
 * (boundary sale excluded → count 0) before the localtime change; reverted and
 * confirmed identical via git diff.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository.js";

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
    -- Referenced by ProfitRepository's notPartnerPending / salePaidOrPartnerSettled
    -- fragments (PFT-6). Left empty: the NOT EXISTS gate then passes every row,
    -- preserving this suite's pre-partner expectations unchanged.
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
  `);
}

beforeAll(() => {
  db = new Database(":memory:");
  const { off } = db
    .prepare(
      `SELECT strftime('%s','now') - strftime('%s','now','localtime') AS off`,
    )
    .get() as { off: number };
  db.close();
  if (off === 0) {
    throw new Error(
      "SQLite 'localtime' == UTC — jest setupFiles should pin TZ=Asia/Beirut. " +
        "The local-vs-UTC profit assertions prove nothing under UTC.",
    );
  }
});

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  repo = new ProfitRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ProfitRepository.getSalesRevCost — local business day range", () => {
  it("includes a 01:00-local sale in a same-local-day [from,to] window", () => {
    const { day } = db
      .prepare(`SELECT date('now','localtime') AS day`)
      .get() as { day: string };
    // created_at = today-local 01:00 → stored as yesterday 22:00 UTC in Beirut.
    const boundaryTs = db
      .prepare(
        `SELECT datetime(date('now','localtime') || ' 01:00:00', 'utc') AS ts`,
      )
      .get() as { ts: string };

    db.prepare(
      `INSERT INTO sales (tenant_id, status, paid_usd, paid_lbp, final_amount_usd, created_at)
       VALUES (1, 'completed', 40, 0, 40, ?)`,
    ).run(boundaryTs.ts);
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
       VALUES (1, 1, 40, 25, 1, 0)`,
    ).run();

    // Same window ProfitService builds for a single local day.
    const row = repo.getSalesRevCost(`${day} 00:00:00`, `${day} 23:59:59`);

    // Pre-fix (raw UTC compare) this was count 0 / revenue 0 — the sale fell
    // under "yesterday" and dropped out of today's profit.
    expect(row.count).toBe(1);
    expect(row.revenue_usd).toBe(40);
    expect(row.cost_usd).toBe(25);
  });

  it("excludes a sale whose LOCAL day is before the window", () => {
    // Yesterday 23:00 local → outside a today-only window.
    const { day } = db
      .prepare(`SELECT date('now','localtime') AS day`)
      .get() as { day: string };
    const oldTs = db
      .prepare(
        `SELECT datetime(date('now','localtime','-1 day') || ' 23:00:00', 'utc') AS ts`,
      )
      .get() as { ts: string };

    db.prepare(
      `INSERT INTO sales (tenant_id, status, paid_usd, paid_lbp, final_amount_usd, created_at)
       VALUES (1, 'completed', 99, 0, 99, ?)`,
    ).run(oldTs.ts);
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
       VALUES (1, 1, 99, 50, 1, 0)`,
    ).run();

    const row = repo.getSalesRevCost(`${day} 00:00:00`, `${day} 23:59:59`);
    expect(row.count).toBe(0);
  });
});
