/**
 * Database connection management
 * Supports both local and network database paths
 */
import Database from "better-sqlite3";
import { OFFLINE_ID_FLOOR } from "../offline/idRange.js";
import { assertNotBlockedByReplay } from "./replayGuard.js";

let db: Database.Database | null = null;
let databasePath: string | null = null;

/**
 * Phase A per-tenant routing seam (`docs/plans/ongoing_plans/
 * PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.1). Core does not know about
 * tenants or files — it asks an injected strategy for "which connection is
 * current" (dependency inversion). Only the web backend ever installs one
 * (`backend/src/database/connection.ts`, gated by `TENANT_DB_MODE`); desktop
 * never calls this, so `initFixedTenantContext(1)` + the single `db` below
 * keeps working exactly as before.
 */
let databaseResolver: (() => Database.Database) | null = null;

/**
 * Install (or clear, with `null`) the current-connection resolver.
 * `getDatabase()` consults it after the test hook and before the single `db`
 * fallback, so installing a resolver never has to touch `initDatabase()`,
 * and clearing it (`setDatabaseResolver(null)`) restores byte-identical
 * single-database behaviour.
 */
export function setDatabaseResolver(
  resolver: (() => Database.Database) | null,
): void {
  databaseResolver = resolver;
}

export function getDatabase(): Database.Database {
  // LIRA-306: while an offline replay transaction is open, statements from
  // any other async context are refused (REPLAY_IN_PROGRESS). Before the
  // test hook so tests exercise it too; a null check when no replay runs.
  assertNotBlockedByReplay();
  // Test hook: allow injecting a mock DB without calling initDatabase()
  const testDb = (globalThis as any).__LIRATEK_TEST_DB__ as
    | Database.Database
    | undefined;
  if (testDb) {
    return testDb;
  }

  if (databaseResolver) {
    return databaseResolver();
  }

  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function initDatabase(
  database: Database.Database,
  dbPath?: string,
): void {
  db = database;
  databasePath = dbPath || null;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    databasePath = null;
  }
}

export function getDatabasePath(): string | null {
  return databasePath;
}

export function isNetworkDatabase(): boolean {
  if (!databasePath) return false;
  return databasePath.startsWith("\\\\") || databasePath.startsWith("//");
}

/**
 * LIRA-306 (FR-012, R3) — server ids must stay below the offline id range
 * (10¹²): a server row id at or above it could be read as a PC's offline id
 * and rewritten. The WEB SERVER calls this explicitly at startup, after
 * migrations (backend/src/database/connection.ts); desktop never does — a
 * PC's working copy legitimately holds ids ≥ 10¹². Throws, naming the
 * tables, so the process refuses to start.
 */
export function assertServerIdsBelowOfflineRange(database: Database.Database): void {
  let rows: Array<{ name: string; seq: number }> = [];
  try {
    rows = database
      .prepare(`SELECT name, seq FROM sqlite_sequence WHERE seq >= ?`)
      .all(OFFLINE_ID_FLOOR) as Array<{ name: string; seq: number }>;
  } catch {
    return; // no AUTOINCREMENT table yet → no sqlite_sequence
  }
  if (rows.length > 0) {
    throw new Error(
      `Server ids reached the offline id range (≥ ${OFFLINE_ID_FLOOR}): ` +
        rows.map((r) => `${r.name}=${r.seq}`).join(", ") +
        ". Refusing to start — offline replay would mistake these rows for PC rows.",
    );
  }
}
