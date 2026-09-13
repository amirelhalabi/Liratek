/**
 * ClosingRepository.createCheckpoint — `closing_date` comes from the CLIENT,
 * not the server clock.
 *
 * Owner-reported bug (live production data): on web the process runs on the
 * Fly machine (`fra`, no `TZ` set → UTC), not the shop's Beirut clock. A
 * checkpoint taken between 00:00 and 03:00 Beirut used to be stamped with
 * the server's OWN `localDay()` (still UTC's previous day at that hour) and
 * silently filed under the wrong day — invisible on the (client-computed)
 * "today" checkpoint timeline. Desktop was never affected: there the server
 * process IS the shop's PC, so server-local and shop-local already agreed.
 *
 * The fix: the browser sends its own `localDay()` as `closing_date`, and the
 * repository prefers it over the server's `localDay()`, which now only
 * covers callers that omit the field (desktop, and any other module that
 * has not been updated to pass it).
 *
 * Rule 17: both cases below were run against the pre-fix line
 * (`const closingDate = localDay();`, ignoring `data.closing_date`
 * entirely). The "honours the client value" case FAILED — it recorded the
 * server's `localDay()` instead of the supplied date. The fallback case
 * passed either way (nothing to distinguish when the field is omitted).
 * Reverted back to `data.closing_date ?? localDay()` and confirmed identical
 * via git diff.
 */

import Database from "better-sqlite3";
import { ClosingRepository, resetClosingRepository } from "../ClosingRepository.js";
import { resetCarrierLineRepository } from "../CarrierLineRepository.js";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { localDay } from "../../utils/localDate.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      username  TEXT
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER DEFAULT 1,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      user_id       INTEGER NOT NULL,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER DEFAULT 1,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

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

    CREATE TABLE daily_closing_amounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id       INTEGER DEFAULT 1,
      closing_id      INTEGER NOT NULL,
      drawer_name     TEXT NOT NULL,
      currency_code   TEXT NOT NULL,
      opening_amount  REAL DEFAULT 0,
      physical_amount REAL DEFAULT 0,
      UNIQUE(closing_id, drawer_name, currency_code)
    );

    CREATE TABLE daily_closing_carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER NOT NULL,
      closing_id          INTEGER NOT NULL,
      carrier_line_id     INTEGER NOT NULL,
      expected_credits    REAL NOT NULL DEFAULT 0,
      counted_credits     REAL NOT NULL DEFAULT 0,
      expected_expires_at TEXT,
      counted_expires_at  TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(closing_id, carrier_line_id)
    );

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE carrier_line_movements (
      id                           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                    INTEGER,
      carrier_line_id              INTEGER NOT NULL,
      transaction_id               INTEGER,
      credits_delta                REAL NOT NULL DEFAULT 0,
      validity_days_delta          INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at TEXT,
      reason                       TEXT NOT NULL,
      is_reversed                  INTEGER NOT NULL DEFAULT 0,
      created_at                   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("ClosingRepository.createCheckpoint — closing_date", () => {
  let db: Database.Database;
  let repo: ClosingRepository;

  const closingDateOf = (id: number | bigint): string =>
    (
      db
        .prepare(`SELECT closing_date FROM daily_closings WHERE id = ?`)
        .get(id) as { closing_date: string }
    ).closing_date;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetClosingRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetTransactionRepository();
    repo = new ClosingRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetClosingRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetTransactionRepository();
  });

  it("stamps the row with the CLIENT-supplied closing_date, not the server's local day", () => {
    // A date that can never equal today (whatever machine/timezone runs the
    // suite), so this proves the client value WON rather than merely
    // matching localDay() by coincidence.
    const clientDay = "2020-01-15";
    expect(clientDay).not.toBe(localDay());

    const result = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "MAIN",
      closing_date: clientDay,
      amounts: [
        {
          drawer_name: "MAIN",
          currency_code: "USD",
          expected_amount: 0,
          physical_amount: 0,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(closingDateOf(result.id!)).toBe(clientDay);
  });

  it("falls back to the server's localDay() when closing_date is omitted", () => {
    const result = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "MAIN",
      amounts: [
        {
          drawer_name: "MAIN",
          currency_code: "USD",
          expected_amount: 0,
          physical_amount: 0,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(closingDateOf(result.id!)).toBe(localDay());
  });
});
