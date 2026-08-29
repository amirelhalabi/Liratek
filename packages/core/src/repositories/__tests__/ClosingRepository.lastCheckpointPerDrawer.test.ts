/**
 * ClosingRepository.getLastCheckpointPerDrawer — per-drawer freshness
 * (LIRA-156, owner-reported 2026-08-29: "Dashboard checkpoint is not
 * changing the last checkpoint time in dashboard but is propagating
 * correctly in checkpoint timeline.").
 *
 * THE BUG (see the method's doc comment in ClosingRepository.ts for the
 * full explanation): the old query's `IN (SELECT MAX(closing_id) ...
 * GROUP BY drawer_name)` flattened a per-drawer MAX into one bare id list
 * with no link back to which drawer each id belonged to, and had no time
 * ordering at all. A drawer that has ever been checkpointed BOTH as part of
 * the setup wizard's multi-drawer `AGGREGATED` baseline (written by
 * `InitialDrawerAmountsModal.tsx` / `StepComplete.tsx` — the latter runs on
 * every fresh install) AND on its own individually ends up with rows from
 * TWO closings passing the filter. The JS aggregation loop then took
 * `checked_at` from whichever row scan order put first (in practice: the
 * older, aggregated one) while `amounts` got overwritten by whichever came
 * last — so the dashboard chip's amounts updated but its time stayed
 * frozen at the setup date. Exactly the reported symptom.
 *
 * Rule 17 provenance: this file was written against the pre-fix query
 * first, and the repro below (the `it` block named "the LIRA-156 repro")
 * was traced by hand against the ORIGINAL SQL — before ClosingRepository's
 * `getLastCheckpointPerDrawer()` was rewritten — to confirm it disagrees
 * with the fixed behavior asserted here:
 *
 *   - the old `IN`-list for this fixture evaluates to (2, 1) (MAX(closing_id)
 *     per drawer_name, flattened), which — being unfiltered by drawer — lets
 *     EVERY row in the 2-closing fixture through, General's stale (closing 1)
 *     rows included;
 *   - `ORDER BY drawer_name, currency_code` (no closing/time tiebreak) then
 *     leaves the JS loop reading General's two closings in an order the SQL
 *     never pins down, so `checked_at` (taken from the first row seen per
 *     drawer) and `amounts` (overwritten by every row seen) can disagree on
 *     which closing they came from — under either tie order this file's
 *     assertions on BOTH `checked_at` and `amounts` together cannot both
 *     hold, since one of them is guaranteed to reflect the stale closing.
 *
 * This was reasoned through the query and the fixture, NOT executed — the
 * task this file was written under forbids running any test/build/lint
 * command. Run this file against the pre-fix query (e.g. `git stash` just
 * the ClosingRepository.ts fix) before trusting it as a guard; it is
 * expected to fail there and pass against the fix below it.
 */

import Database from "better-sqlite3";
import {
  ClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

/**
 * Schema mirrors ClosingRepository.carrierLineCheckpoint.test.ts minus the
 * carrier-line tables: `createCheckpoint()` only touches `carrier_lines` /
 * `carrier_line_movements` / `daily_closing_carrier_lines` when
 * `data.carrier_lines` is non-empty, which no test below passes, so those
 * tables are never queried and are omitted here.
 */
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      username  TEXT
    );

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

    -- createCheckpoint() prepares an INSERT against this table at method
    -- entry -- unconditionally, before its transaction and whether or not any
    -- carrier lines were counted. SQLite prepare() throws on a missing table,
    -- so omitting it makes every createCheckpoint() call fail in setup with
    -- "no such table", long before any assertion here can run.
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
  `);
  return db;
}

/** created_at is second-granular (rule 15) — pin it explicitly rather than
 *  relying on wall-clock separation between two createCheckpoint() calls. */
function setCreatedAt(
  db: Database.Database,
  closingId: number,
  createdAt: string,
): void {
  db.prepare(`UPDATE daily_closings SET created_at = ? WHERE id = ?`).run(
    createdAt,
    closingId,
  );
}

function readCreatedAt(db: Database.Database, closingId: number): string {
  return (
    db
      .prepare(`SELECT created_at FROM daily_closings WHERE id = ?`)
      .get(closingId) as { created_at: string }
  ).created_at;
}

describe("ClosingRepository.getLastCheckpointPerDrawer — per-drawer freshness (LIRA-156)", () => {
  let db: Database.Database;
  let repo: ClosingRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetClosingRepository();
    resetTransactionRepository();
    repo = new ClosingRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetClosingRepository();
    resetTransactionRepository();
  });

  it("a drawer's later INDIVIDUAL checkpoint supersedes an earlier AGGREGATED one — time AND amounts together (the LIRA-156 repro)", () => {
    // (a) The setup-wizard-style baseline: one AGGREGATED checkpoint with an
    // amount row for every drawer in the shop.
    const aggregated = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "AGGREGATED",
      amounts: [
        {
          drawer_name: "General",
          currency_code: "USD",
          expected_amount: 500,
          physical_amount: 480,
        },
        {
          drawer_name: "General",
          currency_code: "LBP",
          expected_amount: 1_000_000,
          physical_amount: 950_000,
        },
        {
          drawer_name: "MTC",
          currency_code: "USD",
          expected_amount: 40,
          physical_amount: 40,
        },
      ],
    });
    expect(aggregated.success).toBe(true);
    const aggregatedId = Number(aggregated.id);
    setCreatedAt(db, aggregatedId, "2026-01-15 09:00:00");

    // (b) A STRICTLY LATER, drawer-specific checkpoint on General only, with
    // amounts that differ from the aggregated baseline in both currencies.
    const general = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "General",
      amounts: [
        {
          drawer_name: "General",
          currency_code: "USD",
          expected_amount: 480,
          physical_amount: 520,
        },
        {
          drawer_name: "General",
          currency_code: "LBP",
          expected_amount: 950_000,
          physical_amount: 900_000,
        },
      ],
    });
    expect(general.success).toBe(true);
    const generalId = Number(general.id);
    setCreatedAt(db, generalId, "2026-01-15 09:00:05");

    const statuses = repo.getLastCheckpointPerDrawer();

    // (c) General must report the SECOND closing's time AND amounts — not a
    // mix of the two. This is the exact bug: checked_at taken from whichever
    // row the old query's scan order saw first for the drawer, amounts
    // overwritten by whichever it saw last.
    expect(statuses.General.checked_at).toBe(readCreatedAt(db, generalId));
    expect(statuses.General.checked_at).not.toBe(
      readCreatedAt(db, aggregatedId),
    );
    expect(statuses.General.amounts.USD).toEqual({
      physical: 520,
      expected: 480,
    });
    expect(statuses.General.amounts.LBP).toEqual({
      physical: 900_000,
      expected: 950_000,
    });

    // (d) MTC has no checkpoint of its own — it must still report the
    // AGGREGATED closing untouched (it is a real physical count, per the
    // owner's deliberate decision documented on the method).
    expect(statuses.MTC.checked_at).toBe(readCreatedAt(db, aggregatedId));
    expect(statuses.MTC.amounts.USD).toEqual({ physical: 40, expected: 40 });
  });

  it("a drawer with ONLY the aggregated baseline (never checkpointed individually) reports it correctly", () => {
    const aggregated = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "AGGREGATED",
      amounts: [
        {
          drawer_name: "Alfa",
          currency_code: "USD",
          expected_amount: 100,
          physical_amount: 90,
        },
      ],
    });
    expect(aggregated.success).toBe(true);
    const aggregatedId = Number(aggregated.id);

    const statuses = repo.getLastCheckpointPerDrawer();
    expect(statuses.Alfa.checked_at).toBe(readCreatedAt(db, aggregatedId));
    expect(statuses.Alfa.amounts.USD).toEqual({ physical: 90, expected: 100 });
  });

  it("returns {} when daily_closing_amounts is empty (no checkpoint ever recorded)", () => {
    expect(repo.getLastCheckpointPerDrawer()).toEqual({});
  });

  it("tenant isolation: another tenant's newer/higher-id checkpoint for a same-named drawer never leaks in", () => {
    // Tenant 1's only checkpoint for "Shared": the OLDER row by both id and
    // time.
    const t1 = runWithTenant(1, () =>
      repo.createCheckpoint({
        user_id: 1,
        drawer_name: "Shared",
        amounts: [
          {
            drawer_name: "Shared",
            currency_code: "USD",
            expected_amount: 100,
            physical_amount: 100,
          },
        ],
      }),
    );
    expect(t1.success).toBe(true);
    const t1Id = Number(t1.id);
    setCreatedAt(db, t1Id, "2026-01-15 09:00:00");

    // Tenant 2's checkpoint for the SAME drawer name gets a HIGHER id and a
    // LATER created_at than tenant 1's. If either tenant_id filter were
    // dropped anywhere in the fixed query's window/join chain, this row
    // would out-rank tenant 1's own row and leak across the tenant boundary.
    const t2 = runWithTenant(2, () =>
      repo.createCheckpoint({
        user_id: 1,
        drawer_name: "Shared",
        amounts: [
          {
            drawer_name: "Shared",
            currency_code: "USD",
            expected_amount: 999,
            physical_amount: 999,
          },
        ],
      }),
    );
    expect(t2.success).toBe(true);
    const t2Id = Number(t2.id);
    setCreatedAt(db, t2Id, "2026-01-15 09:00:05");

    const statusesT1 = runWithTenant(1, () =>
      repo.getLastCheckpointPerDrawer(),
    );
    expect(statusesT1.Shared.checked_at).toBe(readCreatedAt(db, t1Id));
    expect(statusesT1.Shared.amounts.USD).toEqual({
      physical: 100,
      expected: 100,
    });

    const statusesT2 = runWithTenant(2, () =>
      repo.getLastCheckpointPerDrawer(),
    );
    expect(statusesT2.Shared.checked_at).toBe(readCreatedAt(db, t2Id));
    expect(statusesT2.Shared.amounts.USD).toEqual({
      physical: 999,
      expected: 999,
    });
  });
});
