/**
 * Migration v142 — add_carrier_line_movement_previous_validity (LIRA-090 M2
 * fix, 2026-07-30 adversarial review).
 *
 * Covers TELECOM_DAYS_VALIDITY_PLAN.md §8: `carrier_line_movements` gains a
 * nullable `previous_validity_expires_at` TEXT column (defaultless ALTER —
 * v104 prod-brick lesson), letting `CarrierLineRepository.reverseMovement`
 * restore a line's validity verbatim instead of re-deriving it via day-math.
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
    -- The exact post-v140 shape (no previous_validity_expires_at yet).
    CREATE TABLE carrier_line_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier_line_id INTEGER NOT NULL,
      transaction_id INTEGER,
      credits_delta REAL NOT NULL DEFAULT 0,
      validity_days_delta INTEGER NOT NULL DEFAULT 0,
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

describe("Migration v142 — add_carrier_line_movement_previous_validity", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("adds a nullable previous_validity_expires_at column", () => {
    getMigration(142).up(db);
    expect(tableColumns(db, "carrier_line_movements")).toContain(
      "previous_validity_expires_at",
    );
  });

  it("leaves existing rows NULL on the new column (no default backfill)", () => {
    db.prepare(
      `INSERT INTO carrier_line_movements (carrier_line_id, credits_delta, validity_days_delta, reason)
       VALUES (1, 77, 30, 'SELF_CHARGE')`,
    ).run();

    getMigration(142).up(db);

    const row = db
      .prepare(
        `SELECT previous_validity_expires_at FROM carrier_line_movements WHERE carrier_line_id = 1`,
      )
      .get() as { previous_validity_expires_at: string | null };
    expect(row.previous_validity_expires_at).toBeNull();
  });

  it("accepts a real date value after migrating", () => {
    getMigration(142).up(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO carrier_line_movements
             (carrier_line_id, credits_delta, validity_days_delta, previous_validity_expires_at, reason)
           VALUES (1, 0, 30, '2020-01-01', 'SELF_CHARGE')`,
        )
        .run(),
    ).not.toThrow();

    const row = db
      .prepare(
        `SELECT previous_validity_expires_at FROM carrier_line_movements WHERE carrier_line_id = 1`,
      )
      .get() as { previous_validity_expires_at: string | null };
    expect(row.previous_validity_expires_at).toBe("2020-01-01");
  });

  it("up() is idempotent — running twice does not throw", () => {
    getMigration(142).up(db);
    expect(() => getMigration(142).up(db)).not.toThrow();
  });

  it("down() drops the column cleanly", () => {
    getMigration(142).up(db);
    expect(tableColumns(db, "carrier_line_movements")).toContain(
      "previous_validity_expires_at",
    );

    getMigration(142).down(db);

    expect(tableColumns(db, "carrier_line_movements")).not.toContain(
      "previous_validity_expires_at",
    );
  });

  it("up() -> down() -> up() round-trips cleanly", () => {
    getMigration(142).up(db);
    getMigration(142).down(db);
    expect(() => getMigration(142).up(db)).not.toThrow();
    expect(tableColumns(db, "carrier_line_movements")).toContain(
      "previous_validity_expires_at",
    );
  });
});
