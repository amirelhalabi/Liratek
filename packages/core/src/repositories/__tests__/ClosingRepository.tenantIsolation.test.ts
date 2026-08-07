/**
 * ClosingRepository — cross-tenant isolation (multi-tenant retrofit, WP3e,
 * CLAUDE.md rule 17 regression proof).
 *
 * `daily_closings`, `daily_closing_amounts`, and `drawer_balances` are
 * single physical tables shared by every tenant — `drawer_balances`' PK is
 * now `(tenant_id, drawer_name, currency_code)` (was just `(drawer_name,
 * currency_code)` pre-retrofit), matched exactly in this fixture. Two
 * tenants are seeded with MIRRORED checkpoints for the SAME drawer/currency
 * (`General`/`USD`) with DISTINCT amounts, so a leak into any aggregate or
 * correlated-subquery read shows up as a wrong number, not just an extra
 * row — and a checkpoint lookup by its real (colliding-namespace) id is
 * proven blocked across tenants, mirroring the get-by-id proof pattern used
 * by the other WP3 isolation tests.
 *
 * This file proves, under `runWithTenant(1, ...)`:
 *   - getSystemExpectedBalancesDynamic() (drawer_balances aggregate) reports
 *     ONLY tenant 1's exact balance for the shared drawer/currency.
 *   - getCheckpointAmounts() (a get-by-id-style lookup by closing_id) cannot
 *     return tenant 2's checkpoint amounts even when given tenant 2's real
 *     closing_id.
 *   - getLastCheckpointPerDrawer() (a correlated MAX(closing_id) subquery +
 *     join) reflects ONLY tenant 1's exact physical/opening amounts.
 *   - getCheckpointTimeline() (the main checkpoint list/history read) lists
 *     ONLY tenant 1's checkpoint for the date.
 *
 * Per rule 17: the getCheckpointAmounts() assertion below was verified to
 * FAIL when the `"AND tenant_id = ?"` predicate/param was temporarily
 * removed from `ClosingRepository.getCheckpointAmounts()` (tenant 1,
 * querying tenant 2's real closing_id, got tenant 2's amounts back instead
 * of an empty result) — the predicate was then restored and the revert
 * verified identical via `git diff` before this file was finalized.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

const DATE = "2026-01-15";

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

/**
 * Seed one tenant's mirrored checkpoint: a General/USD drawer_balances row,
 * a daily_closings header, and its daily_closing_amounts breakdown. All
 * amounts are `base × mult` so a leak into any sum/lookup changes an exact
 * number. Returns the new closing_id.
 */
function seedTenantCheckpoint(
  db: Database.Database,
  tenantId: number,
  mult: number,
  username: string,
): number {
  db.prepare(
    `INSERT INTO users (id, tenant_id, username) VALUES (?, ?, ?)`,
  ).run(tenantId, tenantId, username);

  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (?, 'General', 'USD', ?)`,
  ).run(tenantId, 1000 * mult);

  const closingResult = db
    .prepare(
      `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, notes, created_by, created_at)
       VALUES (?, ?, 'AGGREGATED', ?, ?, ?)`,
    )
    .run(tenantId, DATE, `Tenant ${tenantId} checkpoint`, tenantId, DATE);
  const closingId = Number(closingResult.lastInsertRowid);

  db.prepare(
    `INSERT INTO daily_closing_amounts (tenant_id, closing_id, drawer_name, currency_code, opening_amount, physical_amount)
     VALUES (?, ?, 'General', 'USD', ?, ?)`,
  ).run(tenantId, closingId, 1000 * mult, 900 * mult);

  return closingId;
}

describe("ClosingRepository — cross-tenant isolation", () => {
  let db: Database.Database;
  let repo: ClosingRepository;

  beforeEach(() => {
    db = createTestDb();
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

  it("getSystemExpectedBalancesDynamic(): exact drawer balance reflects ONLY the active tenant", () => {
    seedTenantCheckpoint(db, 1, 1, "alice");
    seedTenantCheckpoint(db, 2, 5, "bob");

    const t1 = runWithTenant(1, () => repo.getSystemExpectedBalancesDynamic());
    expect(t1).toEqual({ General: { USD: 1000 } }); // NOT 6000 (1000 + 5000)

    const t2 = runWithTenant(2, () => repo.getSystemExpectedBalancesDynamic());
    expect(t2).toEqual({ General: { USD: 5000 } });
  });

  it("getCheckpointAmounts(): tenant 1 cannot fetch tenant 2's checkpoint amounts by its real closing_id", () => {
    seedTenantCheckpoint(db, 1, 1, "alice");
    const t2ClosingId = seedTenantCheckpoint(db, 2, 5, "bob");

    const seenByTenant1 = runWithTenant(1, () =>
      repo.getCheckpointAmounts(t2ClosingId),
    );
    expect(seenByTenant1).toEqual([]);

    const seenByTenant2 = runWithTenant(2, () =>
      repo.getCheckpointAmounts(t2ClosingId),
    );
    expect(seenByTenant2).toHaveLength(1);
    expect(seenByTenant2[0].opening_amount).toBe(5000);
    expect(seenByTenant2[0].physical_amount).toBe(4500);
  });

  it("getLastCheckpointPerDrawer(): correlated MAX(closing_id) subquery + join stays scoped to exact amounts", () => {
    seedTenantCheckpoint(db, 1, 1, "alice");
    seedTenantCheckpoint(db, 2, 5, "bob");

    const t1 = runWithTenant(1, () => repo.getLastCheckpointPerDrawer());
    expect(t1.General.amounts.USD.physical).toBe(900); // NOT 4500
    expect(t1.General.amounts.USD.expected).toBe(1000); // NOT 5000

    const t2 = runWithTenant(2, () => repo.getLastCheckpointPerDrawer());
    expect(t2.General.amounts.USD.physical).toBe(4500);
    expect(t2.General.amounts.USD.expected).toBe(5000);
  });

  it("getCheckpointTimeline(): list read returns ONLY the active tenant's checkpoint for the date", () => {
    seedTenantCheckpoint(db, 1, 1, "alice");
    seedTenantCheckpoint(db, 2, 5, "bob");

    const t1 = runWithTenant(1, () =>
      repo.getCheckpointTimeline({ date_from: DATE, date_to: DATE }),
    );
    expect(t1).toHaveLength(1);
    expect(t1[0].notes).toBe("Tenant 1 checkpoint");
    expect(t1[0].currencies[0].opening_amount).toBe(1000);

    const t2 = runWithTenant(2, () =>
      repo.getCheckpointTimeline({ date_from: DATE, date_to: DATE }),
    );
    expect(t2).toHaveLength(1);
    expect(t2[0].notes).toBe("Tenant 2 checkpoint");
    expect(t2[0].currencies[0].opening_amount).toBe(5000);
  });
});
