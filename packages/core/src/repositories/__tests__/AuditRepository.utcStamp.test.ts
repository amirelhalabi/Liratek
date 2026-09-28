/**
 * LIRA-243 — AuditRepository must stamp `created_at`/`updated_at` in UTC,
 * the SAME convention every other table in the schema uses (`transactions`,
 * and the repository template in `packages/core/CLAUDE.md`, both
 * `CURRENT_TIMESTAMP` — plain UTC, no timezone marker).
 *
 * `AuditRepository.log()` used to write `datetime('now', 'localtime')` —
 * the QUERY HOST's wall-clock time, not UTC. The frontend renders BOTH the
 * Transactions tab and the Audit Log tab through the SAME
 * `parseDbDate` (`frontend/src/shared/utils/parseDbDate.ts`), which pins a
 * marker-less "YYYY-MM-DD HH:MM:SS" string to UTC (correct for
 * `CURRENT_TIMESTAMP`) before converting to the viewer's local zone for
 * display. Feeding it an ALREADY-local value therefore double-shifts: the
 * viewer sees local-time-again-converted-as-if-UTC, which is off by exactly
 * the writing machine's own UTC offset (Beirut: 3h) — this reproduced the
 * owner's report of Transactions reading 20:53 and Audit Log reading 23:53
 * for the same moment.
 *
 * Must run WITHOUT `TZ` pinned to UTC (do not run this file with
 * `TZ=UTC`): the whole point is a NON-zero machine offset, so the beforeAll
 * probe below guards against a UTC runner making the assertion hollow (same
 * pattern as `ProfitRepository.localBusinessDay.test.ts`). On this repo's
 * Windows dev machine, leaving `TZ` unset resolves to Asia/Beirut (+03:00)
 * consistently for both Node and better-sqlite3 — do NOT set
 * `TZ=Asia/Beirut` explicitly (that produces a Node/SQLite offset mismatch
 * on this specific machine, per the LIRA-237/243 investigation notes).
 *
 * Rule 17: seen failing on the pre-fix `'localtime'` INSERT before the fix
 * landed — the assertion missed by ~10,797,416 ms (~2h59m57s, Beirut's +3h
 * offset).
 */

import Database from "better-sqlite3";
import { AuditRepository } from "../AuditRepository.js";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: AuditRepository;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      summary TEXT NOT NULL,
      old_values TEXT,
      new_values TEXT,
      metadata TEXT,
      impersonator_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);
}

beforeAll(() => {
  const probeDb = new Database(":memory:");
  const { off } = probeDb
    .prepare(
      `SELECT strftime('%s','now') - strftime('%s','now','localtime') AS off`,
    )
    .get() as { off: number };
  probeDb.close();
  if (off === 0) {
    throw new Error(
      "SQLite 'localtime' == UTC on this runner — this guard proves nothing " +
        "under UTC (the bug is a UTC-vs-machine-local mismatch). Run this " +
        "file with TZ left UNSET, not TZ=UTC and not TZ=Asia/Beirut.",
    );
  }
});

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  repo = new AuditRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTenantContext();
  db.close();
});

describe("AuditRepository.log() — UTC stamping", () => {
  it("stamps created_at within seconds of the real UTC now, not shifted by the machine's local offset", () => {
    const before = Date.now();
    const id = repo.log({
      user_id: 1,
      username: "tester",
      role: "admin",
      action: "CREATE",
      entity_type: "test",
      summary: "guard row",
    });
    const after = Date.now();

    const row = db
      .prepare(`SELECT created_at, updated_at FROM audit_log WHERE id = ?`)
      .get(id) as { created_at: string; updated_at: string };

    // Same UTC-pinning parseDbDate.ts applies to a marker-less DB string.
    const storedMs = Date.parse(`${row.created_at.replace(" ", "T")}Z`);

    // Pre-fix (datetime('now','localtime')): storedMs is the machine's UTC
    // offset AWAY from real "now" (Beirut: ~+3h ~= 10.8M ms) — far outside
    // this window. Post-fix (CURRENT_TIMESTAMP-equivalent UTC): within the
    // few-ms test execution window.
    expect(storedMs).toBeGreaterThanOrEqual(before - 2000);
    expect(storedMs).toBeLessThanOrEqual(after + 2000);

    const updatedMs = Date.parse(`${row.updated_at.replace(" ", "T")}Z`);
    expect(updatedMs).toBeGreaterThanOrEqual(before - 2000);
    expect(updatedMs).toBeLessThanOrEqual(after + 2000);
  });
});
