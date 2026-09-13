/**
 * ClosingRepository.hasOpeningBalanceToday — `day` comes from the CLIENT, not
 * the server clock.
 *
 * Sibling of the `createCheckpoint` `closing_date` fix (commit 690dc2b0): on
 * web the process runs on the Fly machine (`fra`, no `TZ` set → UTC), not the
 * shop's Beirut clock. Called on login (AuthContext) to decide whether the
 * operator must set today's opening balance — a server day that disagrees
 * with the shop's (00:00-03:00 Beirut) would either nag for an opening
 * balance that was already set under the shop's real "today", or skip asking
 * for one that is actually still missing. Desktop was never affected: there
 * the server process IS the shop's PC, so server-local and shop-local agree.
 *
 * The fix: the browser sends its own `localDay()` as `day`, and the
 * repository prefers it over the server's `localDay()`, which now only
 * covers callers that omit the argument (desktop, and any other caller that
 * has not been updated to pass it).
 *
 * Rule 17: both cases below were run against the pre-fix line
 * (`.get(localDay(), getCurrentTenantId())`, ignoring the `day` parameter
 * entirely). The "honours the client value" case FAILED — a checkpoint
 * stamped under the CLIENT's day (which does not exist under the server's
 * `localDay()`) was reported as absent even though it was the one just
 * written for that exact day. Reverted to `day ?? localDay()` and confirmed
 * identical via git diff.
 */

import Database from "better-sqlite3";
import {
  ClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository.js";
import { localDay } from "../../utils/localDate.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE daily_closings (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      closing_date        TEXT,
      drawer_name         TEXT,
      opening_balance_usd REAL DEFAULT 0,
      opening_balance_lbp REAL DEFAULT 0,
      physical_usd        REAL DEFAULT 0,
      physical_lbp        REAL DEFAULT 0,
      physical_eur        REAL DEFAULT 0,
      system_expected_usd REAL DEFAULT 0,
      system_expected_lbp REAL DEFAULT 0,
      variance_usd        REAL DEFAULT 0,
      notes               TEXT,
      report_path         TEXT,
      created_by          INTEGER,
      updated_by          INTEGER,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("ClosingRepository.hasOpeningBalanceToday — client day", () => {
  let db: Database.Database;
  let repo: ClosingRepository;

  // A date that can never equal today (whatever machine/timezone runs the
  // suite), so a match against it proves the CLIENT value won rather than
  // merely coinciding with localDay().
  const clientDay = "2020-01-15";

  const insertClosing = (closingDate: string) => {
    db.prepare(
      `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name) VALUES (1, ?, 'MAIN')`,
    ).run(closingDate);
  };

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetClosingRepository();
    repo = new ClosingRepository();
    expect(clientDay).not.toBe(localDay());
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetClosingRepository();
  });

  it("finds a checkpoint filed under the CLIENT-supplied day, not the server's local day", () => {
    insertClosing(clientDay);

    // The server's own `localDay()` has no row — only the client's does.
    expect(repo.hasOpeningBalanceToday()).toBe(false);
    expect(repo.hasOpeningBalanceToday(clientDay)).toBe(true);
  });

  it("falls back to the server's localDay() when day is omitted", () => {
    insertClosing(localDay());

    expect(repo.hasOpeningBalanceToday()).toBe(true);
    // A different, non-matching client day still correctly reports false —
    // the fallback only applies when the argument is omitted entirely.
    expect(repo.hasOpeningBalanceToday(clientDay)).toBe(false);
  });
});
