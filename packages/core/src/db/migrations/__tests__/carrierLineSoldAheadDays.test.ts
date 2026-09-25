/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * Migration v184 — carrier_line_sold_ahead_days (#28, LIRA-218).
 *
 * Adds `carrier_lines.days_owed`, `carrier_line_movements.days_owed_delta` /
 * `previous_days_owed`, and the `carrier_line_owed_deliveries` table. Mirrors
 * the shape of the v142 previous_validity_expires_at migration test.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function getMigration(version: number) {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) {
    throw new Error(`Migration v${version} not found`);
  }
  if (!migration.down) {
    throw new Error(`Migration v${version} has no down()`);
  }
  return migration as Required<typeof migration>;
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (id INTEGER PRIMARY KEY);
    INSERT INTO tenants (id) VALUES (1);

    -- Minimal FK targets for carrier_line_owed_deliveries (transaction_id ->
    -- transactions, client_id -> clients, sent_by -> users). Better-sqlite3
    -- enforces "PRAGMA foreign_keys = ON" by default, so preparing ANY DML
    -- against a table with a FOREIGN KEY clause requires every referenced
    -- table to exist, even for columns the statement never sets — these
    -- three tables always exist by the time v184 runs against a real
    -- (non-fixture) database (they predate it by many migrations), so this
    -- is purely fixture completeness, not a change to the migration itself.
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT);

    -- Pre-v184 shape (no days_owed yet).
    CREATE TABLE carrier_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT NOT NULL CHECK(carrier IN ('alfa', 'mtc')),
      phone_number TEXT NOT NULL,
      credits REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Pre-v184 shape (no days_owed_delta/previous_days_owed yet).
    CREATE TABLE carrier_line_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier_line_id INTEGER NOT NULL,
      transaction_id INTEGER,
      credits_delta REAL NOT NULL DEFAULT 0,
      validity_days_delta INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at TEXT,
      reason TEXT NOT NULL,
      is_reversed INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number)
      VALUES (1, 1, 'mtc', '71000000');
  `);
  return db;
}

function tableColumns(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(table);
}

describe("Migration v184 — carrier_line_sold_ahead_days", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("adds carrier_lines.days_owed, NOT NULL DEFAULT 0", () => {
    getMigration(184).up(db);
    expect(tableColumns(db, "carrier_lines")).toContain("days_owed");
    const row = db
      .prepare(`SELECT days_owed FROM carrier_lines WHERE id = 1`)
      .get() as { days_owed: number };
    expect(row.days_owed).toBe(0);
  });

  it("adds carrier_line_movements.days_owed_delta / previous_days_owed, defaulting to 0 on existing rows", () => {
    db.prepare(
      `INSERT INTO carrier_line_movements (carrier_line_id, validity_days_delta, reason)
       VALUES (1, -30, 'DAYS_SALE')`,
    ).run();

    getMigration(184).up(db);

    const cols = tableColumns(db, "carrier_line_movements");
    expect(cols).toContain("days_owed_delta");
    expect(cols).toContain("previous_days_owed");

    const row = db
      .prepare(
        `SELECT days_owed_delta, previous_days_owed FROM carrier_line_movements WHERE carrier_line_id = 1`,
      )
      .get() as { days_owed_delta: number; previous_days_owed: number };
    expect(row.days_owed_delta).toBe(0);
    expect(row.previous_days_owed).toBe(0);
  });

  it("creates carrier_line_owed_deliveries", () => {
    getMigration(184).up(db);
    expect(tableExists(db, "carrier_line_owed_deliveries")).toBe(true);

    expect(() =>
      db
        .prepare(
          `INSERT INTO carrier_line_owed_deliveries
             (tenant_id, carrier_line_id, transaction_id, client_id, client_name, days_owed, status)
           VALUES (1, 1, NULL, NULL, 'Walk-in', 210, 'PENDING')`,
        )
        .run(),
    ).not.toThrow();

    // The status CHECK constraint rejects anything outside PENDING/SENT.
    expect(() =>
      db
        .prepare(
          `INSERT INTO carrier_line_owed_deliveries
             (tenant_id, carrier_line_id, days_owed, status)
           VALUES (1, 1, 10, 'BOGUS')`,
        )
        .run(),
    ).toThrow();
  });

  it("up() is idempotent — running twice does not throw", () => {
    getMigration(184).up(db);
    expect(() => getMigration(184).up(db)).not.toThrow();
  });

  it("down() drops everything cleanly", () => {
    getMigration(184).up(db);
    getMigration(184).down(db);

    expect(tableColumns(db, "carrier_lines")).not.toContain("days_owed");
    expect(tableColumns(db, "carrier_line_movements")).not.toContain(
      "days_owed_delta",
    );
    expect(tableExists(db, "carrier_line_owed_deliveries")).toBe(false);
  });

  it("up() -> down() -> up() round-trips cleanly", () => {
    getMigration(184).up(db);
    getMigration(184).down(db);
    expect(() => getMigration(184).up(db)).not.toThrow();
    expect(tableColumns(db, "carrier_lines")).toContain("days_owed");
    expect(tableExists(db, "carrier_line_owed_deliveries")).toBe(true);
  });
});
