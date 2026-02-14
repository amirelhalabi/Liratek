/**
 * Database Migration System
 *
 * Provides a centralized, version-tracked migration system for LiraTek.
 * Supports both TypeScript and SQL migrations.
 */

import type Database from "better-sqlite3";
import { migrateDrawerNames } from "./drawers.js";
import { migrateCustomerSessions } from "./customer-sessions.js";
import { migrateBinanceTransactions } from "./binance-transactions.js";
import { migrateIKWProviders } from "./ikw-providers.js";

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
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "add_sessions_table",
    description: "Add database sessions table for authentication",
    type: "typescript",
    up: (db) => {
      // Sessions table is in core schema (create_db.sql)
      // This migration ensures it exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);`,
      );
    },
  },
  {
    version: 2,
    name: "add_binance_transactions",
    description: "Add Binance cryptocurrency transaction tracking",
    type: "typescript",
    up: migrateBinanceTransactions,
  },
  {
    version: 3,
    name: "add_ikw_providers",
    description:
      "Add IKW financial service providers (OMT, Whish, Western Union)",
    type: "typescript",
    up: migrateIKWProviders,
  },
  {
    version: 4,
    name: "add_customer_sessions",
    description:
      "Add customer session tracking for multi-transaction workflows",
    type: "typescript",
    up: migrateCustomerSessions,
  },
  {
    version: 5,
    name: "migrate_drawer_names",
    description: "Normalize drawer names to canonical format",
    type: "typescript",
    up: migrateDrawerNames,
  },
  {
    version: 6,
    name: "add_performance_indexes",
    description: "Add strategic indexes for query optimization",
    type: "sql",
    up: (db) => {
      // This matches electron-app/migrations/004_add_missing_indexes.sql
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_clients_full_name ON clients(full_name COLLATE NOCASE)`,
        `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`,
        `CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)`,
        `CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(is_active, category)`,
        `CREATE INDEX IF NOT EXISTS idx_products_active_status ON products(is_active, status)`,
        `CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category)`,
        `CREATE INDEX IF NOT EXISTS idx_expenses_type ON expenses(expense_type)`,
        `CREATE INDEX IF NOT EXISTS idx_expenses_date_category ON expenses(expense_date, category)`,
        `CREATE INDEX IF NOT EXISTS idx_expenses_type_date ON expenses(expense_type, expense_date DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_maintenance_client_id ON maintenance(client_id)`,
        `CREATE INDEX IF NOT EXISTS idx_sales_drawer_name ON sales(drawer_name)`,
        `CREATE INDEX IF NOT EXISTS idx_sales_status_drawer ON sales(status, drawer_name)`,
        `CREATE INDEX IF NOT EXISTS idx_debt_ledger_client_type ON debt_ledger(client_id, transaction_type)`,
      ];

      for (const sql of indexes) {
        db.exec(sql);
      }
    },
  },
];

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
