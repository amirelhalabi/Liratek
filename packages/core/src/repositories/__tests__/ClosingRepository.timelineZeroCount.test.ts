/**
 * Checkpoint Timeline — a counted amount of 0 (or below) is a real count.
 *
 * The bug: `getCheckpointTimeline()` mapped any `physical_amount` that was
 * not > 0 to `undefined` ("not counted"). The page then fell back to the
 * EXPECTED amount, so a drawer counted at $0 against $205 expected showed
 * "$205 · Matched" — the shortage vanished from the timeline while the
 * Dashboard (which reads the same row through another query) said $0.
 * Found by driving the web app on 2026-10-12.
 *
 * Only a NULL `physical_amount` means "not counted".
 *
 * Rule 17: written before the fix and run against the unfixed repository.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

const DATE = "2026-10-12";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username  TEXT NOT NULL
    );

    -- Only needs to exist for getCheckpointTimeline()'s LEFT JOIN — no rows
    -- required since checkpoint_type defaults to 'CHECKPOINT' when absent.
    CREATE TABLE transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER,
      type         TEXT,
      source_table TEXT,
      source_id    INTEGER
    );

    CREATE TABLE daily_closings (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id            INTEGER,
      closing_date         TEXT,
      drawer_name          TEXT,
      opening_balance_usd  REAL DEFAULT 0,
      opening_balance_lbp  REAL DEFAULT 0,
      physical_usd         REAL DEFAULT 0,
      physical_lbp         REAL DEFAULT 0,
      physical_eur         REAL DEFAULT 0,
      system_expected_usd  REAL DEFAULT 0,
      system_expected_lbp  REAL DEFAULT 0,
      variance_usd         REAL DEFAULT 0,
      notes                TEXT,
      report_path          TEXT,
      created_by           INTEGER,
      updated_by           INTEGER,
      created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at           TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE daily_closing_amounts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER,
      closing_id       INTEGER NOT NULL,
      drawer_name      TEXT NOT NULL,
      currency_code    TEXT NOT NULL,
      opening_amount   REAL DEFAULT 0,
      physical_amount  REAL DEFAULT 0,
      UNIQUE(closing_id, drawer_name, currency_code)
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    -- Carrier lines (shop-owned SIM lines) + their per-checkpoint count
    -- snapshot. Needed only so getCheckpointCarrierLines()'s JOIN (called
    -- from getCheckpointTimeline() on every checkpoint read) doesn't throw
    -- "no such table" — no test in this file seeds or asserts carrier-line
    -- data, so both tables stay empty across tenants.
    CREATE TABLE carrier_lines (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER,
      carrier      TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      label        TEXT
    );

    CREATE TABLE daily_closing_carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER,
      closing_id          INTEGER NOT NULL,
      carrier_line_id     INTEGER NOT NULL,
      expected_credits    REAL DEFAULT 0,
      counted_credits     REAL DEFAULT 0,
      expected_expires_at TEXT,
      counted_expires_at  TEXT,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(closing_id, carrier_line_id)
    );
  `);
  return db;
}

function seedCheckpoint(
  db: Database.Database,
  rows: Array<{ currency: string; expected: number; counted: number | null }>,
): number {
  const closingId = Number(
    db
      .prepare(
        `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, notes, created_by, created_at)
         VALUES (1, ?, 'General', 'count', 1, ?)`,
      )
      .run(DATE, `${DATE} 17:55:00`).lastInsertRowid,
  );
  for (const r of rows) {
    db.prepare(
      `INSERT INTO daily_closing_amounts (tenant_id, closing_id, drawer_name, currency_code, opening_amount, physical_amount)
       VALUES (1, ?, 'General', ?, ?, ?)`,
    ).run(closingId, r.currency, r.expected, r.counted);
  }
  return closingId;
}

describe("ClosingRepository.getCheckpointTimeline — zero and negative counts", () => {
  let db: Database.Database;
  let repo: ClosingRepository;

  beforeEach(() => {
    db = createTestDb();
    db.prepare(
      `INSERT INTO users (id, tenant_id, username) VALUES (1, 1, 'admin')`,
    ).run();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  function currenciesOf() {
    const timeline = runWithTenant(1, () =>
      repo.getCheckpointTimeline({ date_from: DATE, date_to: DATE }),
    );
    expect(timeline).toHaveLength(1);
    const byCode: Record<
      string,
      { opening_amount: number; physical_amount?: number; variance?: number }
    > = {};
    for (const c of timeline[0].currencies) byCode[c.currency_code] = c;
    return byCode;
  }

  it("a drawer counted at 0 against 205 expected keeps physical 0 and a -205 variance", () => {
    seedCheckpoint(db, [
      { currency: "USD", expected: 205, counted: 0 },
      { currency: "LBP", expected: 1_450_000, counted: 1_450_000 },
    ]);

    const c = currenciesOf();
    expect(c.USD.physical_amount).toBe(0);
    expect(c.USD.variance).toBe(-205);
    expect(c.LBP.physical_amount).toBe(1_450_000);
    expect(c.LBP.variance).toBe(0);
  });

  it("an empty drawer counted 0 against 0 expected is a counted, balanced zero", () => {
    seedCheckpoint(db, [{ currency: "USD", expected: 0, counted: 0 }]);

    const c = currenciesOf();
    expect(c.USD.physical_amount).toBe(0);
    expect(c.USD.variance).toBe(0);
  });

  it("a negative count is returned as counted, not dropped", () => {
    seedCheckpoint(db, [{ currency: "USD", expected: 10, counted: -5 }]);

    const c = currenciesOf();
    expect(c.USD.physical_amount).toBe(-5);
    expect(c.USD.variance).toBe(-15);
  });

  it("only a NULL physical amount means not counted", () => {
    seedCheckpoint(db, [{ currency: "USD", expected: 50, counted: null }]);

    const c = currenciesOf();
    expect(c.USD.physical_amount).toBeUndefined();
    expect(c.USD.variance).toBeUndefined();
  });
});
