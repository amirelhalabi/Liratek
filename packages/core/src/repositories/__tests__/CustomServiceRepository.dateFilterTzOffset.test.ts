/**
 * Rule 27 — `CustomServiceRepository.getAll({ date })` used `DATE(created_at)
 * = ?`, the UTC day. A service booked at 01:00 Beirut on 2026-07-15 is stored
 * as `2026-07-14 22:00:00` (UTC), so filtering on the shop's 2026-07-15 missed
 * it and 2026-07-14 showed it. The filter now uses the shared
 * `localDayExpr()` fragment (`reportingTimeFragments.ts`): the request's
 * client tz offset on web, the machine's `'localtime'` on desktop.
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { CustomServiceRepository } from "../CustomServiceRepository";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

/** 01:00 Beirut (UTC+3, summer) on 2026-07-15, as the DB stores it (UTC). */
const CREATED_0100_BEIRUT = "2026-07-14 22:00:00";

describe("rule 27 — Custom Services date filter uses the shop's day", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  let serviceId: number;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
    initDatabase(db);
    runMigrations(db);
    initFixedTenantContext(1);
    serviceId = Number(
      db
        .prepare(
          `INSERT INTO custom_services (tenant_id, description, created_at) VALUES (1, 'Screen fix', ?)`,
        )
        .run(CREATED_0100_BEIRUT).lastInsertRowid,
    );
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const idsOn = (date: string, offset?: number): number[] =>
    runWithTenant(1, () => repo.getAll({ date }).map((s) => s.id as number), {
      clientTzOffsetMinutes: offset ?? null,
    });

  it("web (Beirut +180): the 01:00 service is on the shop's 2026-07-15", () => {
    expect(idsOn("2026-07-15", 180)).toEqual([serviceId]);
    expect(idsOn("2026-07-14", 180)).toEqual([]);
  });

  it("desktop (no offset): follows the machine's own day, like SQLite 'localtime'", () => {
    const machineDay = (
      db
        .prepare(`SELECT DATE(?, 'localtime') AS d`)
        .get(CREATED_0100_BEIRUT) as { d: string }
    ).d;
    expect(idsOn(machineDay)).toEqual([serviceId]);
  });
});
