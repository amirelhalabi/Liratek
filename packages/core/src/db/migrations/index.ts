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
        -- First delete old rows if Whish_System already exists to avoid unique constraint
        DELETE FROM drawer_balances WHERE drawer_name = 'Wish_App_Money'
          AND EXISTS (SELECT 1 FROM drawer_balances WHERE drawer_name = 'Whish_System');
        DELETE FROM currency_drawers WHERE drawer_name = 'Wish_App_Money'
          AND EXISTS (SELECT 1 FROM currency_drawers WHERE drawer_name = 'Whish_System');
        UPDATE drawer_balances SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';
        UPDATE currency_drawers SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';
        UPDATE payments SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';
        UPDATE daily_closings SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';
        UPDATE daily_closing_amounts SET drawer_name = 'Whish_System' WHERE drawer_name = 'Wish_App_Money';

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
  {
    version: 13,
    name: "add_whish_app_supplier",
    description:
      "Seed Whish App supplier for existing databases (parallel to OMT App)",
    type: "typescript",
    up(db) {
      db.exec(`
        INSERT OR IGNORE INTO suppliers (name, module_key, provider, is_system)
          VALUES ('Whish App', 'ipec_katch', 'WHISH_APP', 1);
      `);
    },
  },
  {
    version: 14,
    name: "financial_services_cost_price_columns",
    description:
      "Add cost/price/paid_by/client_id/item_key columns to financial_services, update CHECK constraint to include OMT_APP, create item_costs and voucher_images tables",
    type: "typescript",
    up(db) {
      // 1. Recreate financial_services with updated CHECK constraint and new columns
      db.exec(`
        -- Rename old table
        ALTER TABLE financial_services RENAME TO financial_services_migrate;

        -- Create new table with all columns and updated CHECK
        CREATE TABLE IF NOT EXISTS financial_services (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT CHECK(provider IN ('OMT','WHISH','BOB','OTHER','IPEC','KATCH','WISH_APP','OMT_APP')) NOT NULL,
          service_type TEXT CHECK(service_type IN ('SEND','RECEIVE','BILL_PAYMENT')) NOT NULL,
          amount DECIMAL(10, 2) NOT NULL,
          currency TEXT DEFAULT 'USD' NOT NULL,
          commission DECIMAL(10, 2) DEFAULT 0,
          cost DECIMAL(10, 2) DEFAULT 0,
          price DECIMAL(10, 2) DEFAULT 0,
          paid_by TEXT DEFAULT 'CASH',
          client_id INTEGER REFERENCES clients(id),
          client_name TEXT,
          reference_number TEXT,
          item_key TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER
        );

        -- Copy old data, filling new columns with defaults
        INSERT INTO financial_services (id, provider, service_type, amount, currency, commission, cost, price, paid_by, client_id, client_name, reference_number, item_key, note, created_at, created_by)
          SELECT id, provider, service_type, amount, currency, commission,
                 0, 0, 'CASH', NULL, client_name, reference_number, NULL, note, created_at, created_by
          FROM financial_services_migrate;

        -- Drop the old table
        DROP TABLE financial_services_migrate;

        -- 2. Create item_costs table
        CREATE TABLE IF NOT EXISTS item_costs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          category TEXT NOT NULL,
          item_key TEXT NOT NULL,
          cost DECIMAL(10, 2) NOT NULL,
          currency TEXT DEFAULT 'USD' NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(provider, category, item_key, currency)
        );

        -- 3. Create voucher_images table
        CREATE TABLE IF NOT EXISTS voucher_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          category TEXT NOT NULL,
          item_key TEXT NOT NULL,
          image_path TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(provider, category, item_key)
        );
      `);
    },
  },
  {
    version: 15,
    name: "add_custom_services_module",
    description:
      "Add Custom Services module and currency mappings for existing databases",
    type: "typescript",
    up(db) {
      db.exec(`
        INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
          VALUES ('custom_services', 'Services', 'Briefcase', '/custom-services', 13, 1, 0, 0);

        INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
          VALUES ('USD', 'custom_services');
        INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
          VALUES ('LBP', 'custom_services');
      `);
    },
  },
  {
    version: 16,
    name: "maintenance_paid_by_column",
    description:
      "Add paid_by column to maintenance table for payment method tracking",
    type: "typescript",
    up(db) {
      // Check if column already exists (fresh installs have it)
      const cols = db.prepare("PRAGMA table_info(maintenance)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "paid_by")) {
        db.exec(
          `ALTER TABLE maintenance ADD COLUMN paid_by TEXT DEFAULT 'CASH';`,
        );
      }
      // Backfill existing rows
      db.exec(`UPDATE maintenance SET paid_by = 'CASH' WHERE paid_by IS NULL;`);
    },
  },
  {
    version: 17,
    name: "unified_transactions_table",
    description:
      "Create unified transactions table and add FK columns to payments, debt_ledger, supplier_ledger, customer_session_transactions",
    type: "typescript",
    up(db) {
      // 1. Create the transactions table
      db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          type            TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'ACTIVE',
          source_table    TEXT NOT NULL,
          source_id       INTEGER NOT NULL,
          user_id         INTEGER NOT NULL,
          amount_usd      REAL NOT NULL DEFAULT 0,
          amount_lbp      REAL NOT NULL DEFAULT 0,
          exchange_rate   REAL,
          client_id       INTEGER,
          reverses_id     INTEGER,
          summary         TEXT,
          metadata_json   TEXT,
          device_id       TEXT,
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id)      REFERENCES users(id),
          FOREIGN KEY (client_id)    REFERENCES clients(id),
          FOREIGN KEY (reverses_id)  REFERENCES transactions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_transactions_type_created
          ON transactions(type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_transactions_created_at
          ON transactions(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_transactions_user_id
          ON transactions(user_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_client_id
          ON transactions(client_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_source
          ON transactions(source_table, source_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_reverses
          ON transactions(reverses_id);
      `);

      // 2. Add transaction_id to payments
      const paymentCols = db.prepare("PRAGMA table_info(payments)").all() as {
        name: string;
      }[];
      if (!paymentCols.some((c) => c.name === "transaction_id")) {
        db.exec(
          `ALTER TABLE payments ADD COLUMN transaction_id INTEGER REFERENCES transactions(id);`,
        );
      }

      // 3. Add unified_transaction_id to debt_ledger
      const debtCols = db.prepare("PRAGMA table_info(debt_ledger)").all() as {
        name: string;
      }[];
      if (!debtCols.some((c) => c.name === "unified_transaction_id")) {
        db.exec(
          `ALTER TABLE debt_ledger ADD COLUMN unified_transaction_id INTEGER REFERENCES transactions(id);`,
        );
      }

      // 4. Add unified_transaction_id to supplier_ledger
      const supplierCols = db
        .prepare("PRAGMA table_info(supplier_ledger)")
        .all() as { name: string }[];
      if (!supplierCols.some((c) => c.name === "unified_transaction_id")) {
        db.exec(
          `ALTER TABLE supplier_ledger ADD COLUMN unified_transaction_id INTEGER REFERENCES transactions(id);`,
        );
      }

      // 5. Add unified_transaction_id to customer_session_transactions
      const sessionCols = db
        .prepare("PRAGMA table_info(customer_session_transactions)")
        .all() as { name: string }[];
      if (!sessionCols.some((c) => c.name === "unified_transaction_id")) {
        db.exec(
          `ALTER TABLE customer_session_transactions ADD COLUMN unified_transaction_id INTEGER REFERENCES transactions(id);`,
        );
      }
    },
  },
  {
    version: 18,
    name: "debt_aging_support",
    description:
      "Add due_date column to debt_ledger and default_debt_term_days system setting",
    type: "typescript",
    up(db) {
      // 1. Add due_date column to debt_ledger
      const cols = db.prepare("PRAGMA table_info(debt_ledger)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "due_date")) {
        db.exec(`ALTER TABLE debt_ledger ADD COLUMN due_date TEXT;`);
      }

      // 2. Backfill: set due_date = created_at + 30 days for debt entries (positive amounts = original debt)
      db.exec(`
        UPDATE debt_ledger
        SET due_date = datetime(created_at, '+30 days')
        WHERE due_date IS NULL
          AND (amount_usd > 0 OR amount_lbp > 0);
      `);

      // 3. Add system setting for default debt term
      db.exec(`
        INSERT OR IGNORE INTO system_settings (key_name, value)
        VALUES ('default_debt_term_days', '30');
      `);

      // 4. Create index for aging queries
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_debt_ledger_due_date
          ON debt_ledger(due_date);
      `);
    },
  },
  // =========================================================================
  // v19 — Schema Cleanup: drop activity_logs, remove polymorphic columns
  // =========================================================================
  {
    version: 19,
    name: "schema_cleanup",
    description:
      "Drop activity_logs table, remove source_type/source_id from payments, consolidate unified_transaction_id in debt_ledger and supplier_ledger",
    type: "typescript",
    up(db) {
      // 1. Drop activity_logs table and its indexes
      db.exec(`DROP TABLE IF EXISTS activity_logs;`);
      db.exec(`DROP INDEX IF EXISTS idx_activity_logs_created_at;`);
      db.exec(`DROP INDEX IF EXISTS idx_activity_logs_user_id_created_at;`);

      // 2. Rebuild payments — drop source_type, source_id columns; drop idx_payments_source
      db.exec(`DROP INDEX IF EXISTS idx_payments_source;`);
      db.exec(`
        CREATE TABLE payments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id INTEGER,
          method TEXT NOT NULL,
          drawer_name TEXT NOT NULL,
          currency_code TEXT NOT NULL,
          amount REAL NOT NULL,
          note TEXT,
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id),
          FOREIGN KEY (transaction_id) REFERENCES transactions(id)
        );
      `);
      db.exec(`
        INSERT INTO payments_new (id, transaction_id, method, drawer_name, currency_code, amount, note, created_by, created_at)
        SELECT id, transaction_id, method, drawer_name, currency_code, amount, note, created_by, created_at
        FROM payments;
      `);
      db.exec(`DROP TABLE payments;`);
      db.exec(`ALTER TABLE payments_new RENAME TO payments;`);

      // 3. Rebuild debt_ledger — drop old transaction_id, rename unified_transaction_id → transaction_id
      //    Also drop old transaction_type if it exists (some schemas may not have it)
      db.exec(`
        CREATE TABLE debt_ledger_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER NOT NULL,
          transaction_type TEXT NOT NULL,
          amount_usd DECIMAL(10, 2),
          amount_lbp DECIMAL(15, 2),
          transaction_id INTEGER,
          due_date TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          FOREIGN KEY (created_by) REFERENCES users(id),
          FOREIGN KEY (transaction_id) REFERENCES transactions(id)
        );
      `);
      db.exec(`
        INSERT INTO debt_ledger_new (id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, due_date, note, created_at, created_by)
        SELECT id, client_id, transaction_type, amount_usd, amount_lbp, unified_transaction_id, due_date, note, created_at, created_by
        FROM debt_ledger;
      `);
      db.exec(`DROP TABLE debt_ledger;`);
      db.exec(`ALTER TABLE debt_ledger_new RENAME TO debt_ledger;`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_debt_ledger_due_date ON debt_ledger(due_date);`,
      );

      // 4. Rebuild supplier_ledger — drop old transaction_id + transaction_type, rename unified_transaction_id → transaction_id
      db.exec(`
        CREATE TABLE supplier_ledger_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'PAYMENT', 'ADJUSTMENT')),
          amount_usd REAL NOT NULL DEFAULT 0,
          amount_lbp REAL NOT NULL DEFAULT 0,
          note TEXT,
          created_by INTEGER,
          transaction_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );
      `);
      db.exec(`
        INSERT INTO supplier_ledger_new (id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, created_at)
        SELECT id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, unified_transaction_id, created_at
        FROM supplier_ledger;
      `);
      db.exec(`DROP TABLE supplier_ledger;`);
      db.exec(`ALTER TABLE supplier_ledger_new RENAME TO supplier_ledger;`);
    },
  },

  // =========================================================================
  // v20 — Soft-delete support for custom_services, expenses, maintenance
  // =========================================================================
  {
    version: 20,
    name: "soft_delete_support",
    description:
      "Add voided status to custom_services (CHECK rebuild), add status column to expenses, maintenance already supports free-text status",
    type: "typescript",
    up(db) {
      // 1. Rebuild custom_services to include 'voided' in CHECK constraint
      db.exec(`
        CREATE TABLE custom_services_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          description TEXT NOT NULL,
          cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
          cost_lbp DECIMAL(15,2) NOT NULL DEFAULT 0,
          price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
          price_lbp DECIMAL(15,2) NOT NULL DEFAULT 0,
          profit_usd DECIMAL(10,2) GENERATED ALWAYS AS (price_usd - cost_usd) STORED,
          profit_lbp DECIMAL(15,2) GENERATED ALWAYS AS (price_lbp - cost_lbp) STORED,
          paid_by TEXT NOT NULL DEFAULT 'CASH',
          status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','voided')),
          client_id INTEGER,
          client_name TEXT,
          phone_number TEXT,
          note TEXT,
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );
      `);
      db.exec(`
        INSERT INTO custom_services_new (id, description, cost_usd, cost_lbp, price_usd, price_lbp, paid_by, status, client_id, client_name, phone_number, note, created_by, created_at)
        SELECT id, description, cost_usd, cost_lbp, price_usd, price_lbp, paid_by, status, client_id, client_name, phone_number, note, created_by, created_at
        FROM custom_services;
      `);
      db.exec(`DROP TABLE custom_services;`);
      db.exec(`ALTER TABLE custom_services_new RENAME TO custom_services;`);

      // 2. Add status column to expenses (no CHECK constraint needed)
      db.exec(
        `ALTER TABLE expenses ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`,
      );

      // 3. Maintenance: status column already exists with no CHECK — 'Voided' works as-is
    },
  },

  // =========================================================================
  // v21 — Add Profits module (admin-only)
  // =========================================================================
  {
    version: 21,
    name: "add_profits_module",
    description: "Register the Profits analytics module (admin-only)",
    type: "typescript",
    up(db) {
      db.exec(`
        INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
        VALUES ('profits', 'Profits', 'TrendingUp', '/profits', 14, 1, 1, 0);
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
