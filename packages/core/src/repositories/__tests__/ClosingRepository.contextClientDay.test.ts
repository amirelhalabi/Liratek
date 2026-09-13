/**
 * ClosingRepository — ambient tenant-context `clientDay`, with NO explicit
 * `closing_date`/`day`/`date_from`/`date_to` argument anywhere in the call.
 *
 * `createCheckpoint`'s `closing_date` and `hasOpeningBalanceToday`'s `day`
 * were already fixed as EXPLICIT parameters (commits 690dc2b0 / 1ad3f8d9) —
 * `ClosingRepository.checkpointClosingDate.test.ts` and
 * `.hasOpeningBalanceTodayClientDay.test.ts` cover that. This file proves the
 * FOLLOW-ON: since both now fall back to `clientDay()` instead of a bare
 * `localDay()`, wrapping a request in
 * `runWithTenant(tenantId, fn, { clientDay })` — what `authenticateJWT` does
 * once, for every request — is now enough on its own, with no explicit
 * argument at all. `getCheckpointTimeline()`'s `date_from`/`date_to` default
 * window gets the identical treatment here for the first time.
 *
 * Each case pins `clientDay` far from the real "today" so a test that
 * accidentally read the server's `localDay()` instead would see a visibly
 * different (wrong) result — these cannot pass by coincidence.
 *
 * Schema copied from `ClosingRepository.checkpointClosingDate.test.ts` —
 * `createCheckpoint` unconditionally posts a CHECKPOINT transaction (and a
 * reconciliation payment when any drawer/currency balance differs), so it
 * needs a full `transactions`/`payments` shape even when `amounts: []`.
 */

import Database from "better-sqlite3";
import {
  ClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository.js";
import { resetCarrierLineRepository } from "../CarrierLineRepository.js";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { localDay } from "../../utils/localDate.js";

// Far from whatever day the suite actually runs on.
const CLIENT_DAY = "2031-07-04";

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

describe("ClosingRepository — ambient tenant-context clientDay (no explicit day/date args)", () => {
  let db: Database.Database;
  let repo: ClosingRepository;

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
    expect(CLIENT_DAY).not.toBe(localDay());
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

  it("createCheckpoint() stamps closing_date from the ambient clientDay when data.closing_date is omitted entirely", () => {
    const result = runWithTenant(
      1,
      () =>
        repo.createCheckpoint({
          user_id: 1,
          drawer_name: "MAIN",
          amounts: [],
        }),
      { clientDay: CLIENT_DAY },
    );
    expect(result.success).toBe(true);

    const row = db
      .prepare(`SELECT closing_date FROM daily_closings WHERE id = ?`)
      .get(result.id) as { closing_date: string };
    expect(row.closing_date).toBe(CLIENT_DAY);
    expect(row.closing_date).not.toBe(localDay());
  });

  it("hasOpeningBalanceToday() finds a checkpoint filed under the ambient clientDay, with no `day` argument at all", () => {
    db.prepare(
      `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name) VALUES (1, ?, 'MAIN')`,
    ).run(CLIENT_DAY);

    const foundUnderContext = runWithTenant(
      1,
      () => repo.hasOpeningBalanceToday(),
      { clientDay: CLIENT_DAY },
    );
    expect(foundUnderContext).toBe(true);

    // Outside the request scope, the same zero-arg call reverts to the
    // server's real day, which has no row.
    const foundWithoutContext = runWithTenant(1, () =>
      repo.hasOpeningBalanceToday(),
    );
    expect(foundWithoutContext).toBe(false);
  });

  it("getCheckpointTimeline() defaults its date_from/date_to window to the ambient clientDay, with no filters argument at all", () => {
    db.prepare(
      `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, notes, created_by)
       VALUES (1, ?, 'AGGREGATED', 'client-day checkpoint', 1)`,
    ).run(CLIENT_DAY);

    const underContext = runWithTenant(1, () => repo.getCheckpointTimeline(), {
      clientDay: CLIENT_DAY,
    });
    expect(underContext).toHaveLength(1);
    expect(underContext[0].notes).toBe("client-day checkpoint");

    // Outside the request scope, the default window is the server's real
    // today — which has no row filed under it.
    const withoutContext = runWithTenant(1, () => repo.getCheckpointTimeline());
    expect(withoutContext).toHaveLength(0);
  });

  it("an explicit closing_date still wins over the ambient clientDay (override, not replacement)", () => {
    const explicitDate = "2020-02-14";
    const result = runWithTenant(
      1,
      () =>
        repo.createCheckpoint({
          user_id: 1,
          drawer_name: "MAIN",
          amounts: [],
          closing_date: explicitDate,
        }),
      { clientDay: CLIENT_DAY },
    );
    expect(result.success).toBe(true);

    const row = db
      .prepare(`SELECT closing_date FROM daily_closings WHERE id = ?`)
      .get(result.id) as { closing_date: string };
    expect(row.closing_date).toBe(explicitDate);
  });
});
