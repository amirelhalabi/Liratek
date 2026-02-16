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
 * The canonical schema lives in create_db.sql (for fresh databases).
 * Add incremental migrations here for existing databases.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 9,
    name: "add_payment_methods_table",
    description: "Create payment_methods table with seed data",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_methods (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          code           TEXT NOT NULL UNIQUE,
          label          TEXT NOT NULL,
          drawer_name    TEXT NOT NULL,
          affects_drawer INTEGER NOT NULL DEFAULT 1,
          sort_order     INTEGER NOT NULL DEFAULT 0,
          is_active      INTEGER NOT NULL DEFAULT 1,
          is_system      INTEGER NOT NULL DEFAULT 0,
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        INSERT OR IGNORE INTO payment_methods (code, label, drawer_name, affects_drawer, sort_order, is_system) VALUES
          ('CASH',    'Cash',          'General',    1, 0, 1),
          ('OMT',     'OMT Wallet',    'OMT_App',    1, 1, 0),
          ('WHISH',   'Whish Wallet',  'Whish_App',  1, 2, 0),
          ('BINANCE', 'Binance',       'Binance',    1, 3, 0),
          ('DEBT',    'Debt (On Tab)', 'General',    0, 4, 1);
      `);
    },
    down(db) {
      db.exec(`DROP TABLE IF EXISTS payment_methods;`);
    },
  },
  {
    version: 10,
    name: "seed_shop_name",
    description: "Seed default shop_name setting",
    type: "typescript",
    up(db) {
      db.exec(`
        INSERT OR IGNORE INTO system_settings (key_name, value)
        VALUES ('shop_name', 'Corner Tech');
      `);
    },
  },
  {
    version: 11,
    name: "supplier_module_linking",
    description:
      "Link suppliers to modules/providers, add transaction tracing to ledger, seed system suppliers",
    type: "typescript",
    up(db) {
      db.exec(`
        ALTER TABLE suppliers ADD COLUMN module_key TEXT DEFAULT NULL REFERENCES modules(key) ON DELETE SET NULL;
        ALTER TABLE suppliers ADD COLUMN provider TEXT DEFAULT NULL;
        ALTER TABLE suppliers ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

        ALTER TABLE supplier_ledger ADD COLUMN transaction_id INTEGER DEFAULT NULL;
        ALTER TABLE supplier_ledger ADD COLUMN transaction_type TEXT DEFAULT NULL;

        INSERT OR IGNORE INTO suppliers (name, module_key, provider, is_system) VALUES
          ('IPEC',  'ipec_katch', 'IPEC',  1),
          ('Katch', 'ipec_katch', 'KATCH', 1),
          ('OMT',   'omt_whish',  'OMT',   1),
          ('Whish', 'omt_whish',  'WHISH', 1);
      `);
    },
  },
  {
    version: 12,
    name: "recharge_consolidation",
    description:
      "Consolidate recharge/ipec_katch/binance routes, rename recharge label, add OMT_APP provider + supplier, add LBP to recharge module",
    type: "typescript",
    up(db) {
      db.exec(`
        -- Rename recharge label
        UPDATE modules SET label = 'MTC/Alfa' WHERE key = 'recharge';

        -- Point sub-modules to consolidated page
        UPDATE modules SET route = '/recharge' WHERE key = 'ipec_katch';
        UPDATE modules SET route = '/recharge' WHERE key = 'binance';

        -- Add LBP to recharge module currencies
        INSERT OR IGNORE INTO currency_modules (currency_code, module_key) VALUES ('LBP', 'recharge');

        -- Create OMT App supplier
        INSERT OR IGNORE INTO suppliers (name, module_key, provider, is_system)
          VALUES ('OMT App', 'ipec_katch', 'OMT_APP', 1);

        -- Rename Wish_App_Money drawer to Whish_System (fix historical mismatch)
        UPDATE drawer_balances SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';
        UPDATE currency_drawers SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';
        UPDATE payments SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';
        UPDATE daily_closings SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';
        UPDATE closing_amounts SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';

        -- Seed Whish_System drawer if it doesn't exist yet
        INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_System', 'USD', 0);
        INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_System', 'LBP', 0);
        INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('USD', 'Whish_System');
        INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('LBP', 'Whish_System');

        -- Seed OMT_App drawer
        INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'USD', 0);
        INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'LBP', 0);
        INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('USD', 'OMT_App');
        INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('LBP', 'OMT_App');

        -- Seed Whish_App drawer
        INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 0);
        INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'LBP', 0);
        INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('USD', 'Whish_App');
        INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('LBP', 'Whish_App');

        -- Seed Binance drawer
        INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Binance', 'USD', 0);
        INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('USD', 'Binance');
      `);
    },
  },
];

// =============================================================================
// Migration Runner
// =============================================================================

/**
 * Ensure migration tracking table exists.
 * The table is also created by create_db.sql for fresh databases.
 */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
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
