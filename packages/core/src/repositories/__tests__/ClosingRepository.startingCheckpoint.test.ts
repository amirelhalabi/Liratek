/**
 * ClosingRepository.hasStartingCheckpoint — dashboard "no starting checkpoint"
 * banner backing check.
 *
 * True once the checkpoint timeline has ANY entry (the earliest daily_closings
 * row IS the starting checkpoint, always written by the setup wizard). Drives
 * the amber dashboard banner that nudges the operator to record a baseline —
 * the checkpoint sibling of hasInitialBalancesSet.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";

let db: Database.Database;
let repo: ClosingRepository;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE daily_closings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER,
      closing_date TEXT NOT NULL,
      drawer_name  TEXT NOT NULL,
      notes        TEXT,
      created_by   INTEGER,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  repo = new ClosingRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ClosingRepository.hasStartingCheckpoint", () => {
  it("returns false when the timeline is empty (no checkpoint ever recorded)", () => {
    expect(repo.hasStartingCheckpoint()).toBe(false);
  });

  it("returns true once any checkpoint exists (the earliest IS the starting one)", () => {
    db.prepare(
      `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, notes, created_by)
       VALUES (1, '2026-01-01', 'AGGREGATED', 'Initial drawer amounts from setup', 1)`,
    ).run();
    expect(repo.hasStartingCheckpoint()).toBe(true);
  });

  it("stays true regardless of the checkpoint's date (not today-scoped)", () => {
    // Distinct from hasOpeningBalanceToday: a starting checkpoint from any past
    // day still counts as a recorded baseline.
    db.prepare(
      `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, created_by)
       VALUES (1, '2020-06-15', 'General', 1)`,
    ).run();
    expect(repo.hasStartingCheckpoint()).toBe(true);
  });
});

describe("ClosingRepository.getInitialCheckpointDate", () => {
  it("returns null when no checkpoint exists", () => {
    expect(repo.getInitialCheckpointDate()).toBeNull();
  });

  it("returns the earliest (first-created) checkpoint's closing_date", () => {
    // Insert out of date order; the SETUP checkpoint is the first ROW (id ASC),
    // not the earliest closing_date, so id-ordering is what identifies it.
    db.prepare(
      `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, notes, created_by)
       VALUES (1, '2026-02-01', 'AGGREGATED', 'Initial drawer amounts from setup', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, created_by)
       VALUES (1, '2026-03-01', 'General', 1)`,
    ).run();
    expect(repo.getInitialCheckpointDate()).toBe("2026-02-01");
  });
});
