/**
 * Migration v139 — add_system_float_topups_table.
 *
 * Simple CREATE TABLE migration (mirrors v138's add_wallet_exchanges_table
 * shape) — this test proves up() creates the table with a working CHECK
 * constraint on target_drawer, and down() drops it cleanly (round-trip).
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
  db.pragma("foreign_keys = OFF");
  return db;
}

describe("Migration v139 — add_system_float_topups_table", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("up() creates the system_float_topups table with the expected columns", () => {
    getMigration(139).up(db);

    const tableInfo = db
      .prepare(`PRAGMA table_info(system_float_topups)`)
      .all() as Array<{ name: string }>;
    const columns = tableInfo.map((c) => c.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "tenant_id",
        "target_drawer",
        "funding_drawer",
        "amount_usd",
        "amount_lbp",
        "notes",
        "created_by",
        "is_refunded",
        "refunded_at",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("up() enforces the target_drawer CHECK — only OMT_System/Whish_System are valid", () => {
    getMigration(139).up(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO system_float_topups (target_drawer, funding_drawer, amount_usd, amount_lbp) VALUES (?, ?, ?, ?)`,
        )
        .run("OMT_System", "General", 100, 0),
    ).not.toThrow();

    expect(() =>
      db
        .prepare(
          `INSERT INTO system_float_topups (target_drawer, funding_drawer, amount_usd, amount_lbp) VALUES (?, ?, ?, ?)`,
        )
        .run("General", "OMT_System", 100, 0),
    ).toThrow(/CHECK constraint failed/);
  });

  it("down() drops the table cleanly (round-trip)", () => {
    getMigration(139).up(db);
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='system_float_topups'`,
        )
        .get(),
    ).toBeDefined();

    getMigration(139).down(db);
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='system_float_topups'`,
        )
        .get(),
    ).toBeUndefined();
  });

  it("up() is idempotent (CREATE TABLE IF NOT EXISTS) — running twice does not throw", () => {
    getMigration(139).up(db);
    expect(() => getMigration(139).up(db)).not.toThrow();
  });
});
