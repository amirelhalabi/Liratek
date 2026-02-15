/**
 * Database Migration System
 *
 * Provides a centralized, version-tracked migration system for LiraTek.
 * Supports both TypeScript and SQL migrations.
 */

import type Database from "better-sqlite3";

// =============================================================================
// Types
// =============================================================================

export interface Migration {
  version: number;
  name: string;
  description: string;
  type: "typescript" | "sql";
  up: (db: Database.Database) => void;
  down?: (db: Database.Database) => void;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}

// =============================================================================
// Migration Registry
// =============================================================================

/**
 * All migrations in order
 * Version numbers must be sequential
 */
/**
 * Migration registry.
 *
 * Pre-production: the canonical schema lives in create_db.sql.
 * When the project reaches production, add incremental migrations here.
 */
export const MIGRATIONS: Migration[] = [];

// =============================================================================
// Migration Runner
// =============================================================================

/**
 * Ensure migration tracking table exists with version support
 */
function ensureMigrationsTable(db: Database.Database): void {
  // Check if old table exists (name-only)
  const oldTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get() as { name: string } | undefined;

  if (oldTable) {
    // Check if it has version column
    const columns = db
      .prepare("PRAGMA table_info(schema_migrations)")
      .all() as Array<{ name: string }>;
    const hasVersion = columns.some((col) => col.name === "version");

    if (!hasVersion) {
      // Migrate old table to new format
      db.exec(`
        CREATE TABLE schema_migrations_new (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Copy existing migrations, assigning versions based on name
      db.exec(`
        INSERT INTO schema_migrations_new (version, name, applied_at)
        SELECT 
          CASE name
            WHEN 'add_sessions_table' THEN 1
            WHEN 'add_binance_transactions' THEN 2
            WHEN 'add_ikw_providers' THEN 3
            WHEN 'add_customer_sessions' THEN 4
            WHEN 'migrate_drawer_names' THEN 5
            ELSE 99
          END as version,
          name,
          applied_at
        FROM schema_migrations;
      `);

      db.exec(`DROP TABLE schema_migrations;`);
      db.exec(`ALTER TABLE schema_migrations_new RENAME TO schema_migrations;`);
    }
  } else {
    // Create new table with version support
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
}

/**
 * Get current database version
 */
export function getCurrentVersion(db: Database.Database): number {
  ensureMigrationsTable(db);

  const result = db
    .prepare("SELECT MAX(version) as version FROM schema_migrations")
    .get() as { version: number | null };

  return result.version || 0;
}

/**
 * Get all applied migrations
 */
export function getAppliedMigrations(db: Database.Database): MigrationRecord[] {
  ensureMigrationsTable(db);

  return db
    .prepare(
      "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
    )
    .all() as MigrationRecord[];
}

/**
 * Get pending migrations
 */
export function getPendingMigrations(db: Database.Database): Migration[] {
  const currentVersion = getCurrentVersion(db);
  return MIGRATIONS.filter((m) => m.version > currentVersion);
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  ensureMigrationsTable(db);

  const currentVersion = getCurrentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pending.length === 0) {
    console.log(
      "[MIGRATIONS] Database is up to date (version " + currentVersion + ")",
    );
    return;
  }

  console.log(`[MIGRATIONS] Running ${pending.length} migration(s)...`);

  for (const migration of pending) {
    console.log(
      `[MIGRATIONS] → Applying ${migration.version}: ${migration.name}`,
    );

    db.transaction(() => {
      try {
        // Run the migration
        migration.up(db);

        // Record it
        db.prepare(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
        ).run(migration.version, migration.name);

        console.log(`[MIGRATIONS] ✅ ${migration.name} applied successfully`);
      } catch (error) {
        console.error(
          `[MIGRATIONS] ❌ Failed to apply ${migration.name}:`,
          error,
        );
        throw error;
      }
    })();
  }

  console.log(
    `[MIGRATIONS] All migrations complete. Database version: ${getCurrentVersion(db)}`,
  );
}

/**
 * Rollback to a specific version (if down migrations exist)
 */
export function rollbackTo(db: Database.Database, targetVersion: number): void {
  const currentVersion = getCurrentVersion(db);

  if (targetVersion >= currentVersion) {
    console.log("[MIGRATIONS] Already at or below target version");
    return;
  }

  const toRollback = MIGRATIONS.filter(
    (m) => m.version > targetVersion && m.version <= currentVersion,
  ).sort((a, b) => b.version - a.version); // Reverse order

  if (toRollback.some((m) => !m.down)) {
    throw new Error(
      "Cannot rollback: Some migrations do not have down() method",
    );
  }

  console.log(`[MIGRATIONS] Rolling back ${toRollback.length} migration(s)...`);

  for (const migration of toRollback) {
    console.log(
      `[MIGRATIONS] ← Rolling back ${migration.version}: ${migration.name}`,
    );

    db.transaction(() => {
      migration.down!(db);
      db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(
        migration.version,
      );
      console.log(`[MIGRATIONS] ✅ ${migration.name} rolled back`);
    })();
  }

  console.log(
    `[MIGRATIONS] Rollback complete. Database version: ${getCurrentVersion(db)}`,
  );
}

/**
 * Get migration status
 */
export function getMigrationStatus(db: Database.Database): {
  currentVersion: number;
  latestVersion: number;
  applied: MigrationRecord[];
  pending: Migration[];
} {
  ensureMigrationsTable(db);

  return {
    currentVersion: getCurrentVersion(db),
    latestVersion: MIGRATIONS[MIGRATIONS.length - 1]?.version || 0,
    applied: getAppliedMigrations(db),
    pending: getPendingMigrations(db),
  };
}
