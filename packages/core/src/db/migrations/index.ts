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
          ('DEBT',    'Debt (On Tab)', 'General',    0, 4, 0);
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
  // =========================================================================
  // T-30: Financial Services improvements — phone number + OMT service type
  // =========================================================================
  {
    version: 22,
    name: "add_financial_service_phone_and_omt_type",
    description:
      "Add phone_number and omt_service_type columns to financial_services",
    type: "typescript",
    up(db) {
      // Idempotent — skip if columns already exist (e.g. fresh DB from updated create_db.sql)
      const cols = db
        .prepare("PRAGMA table_info(financial_services)")
        .all() as { name: string }[];
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has("phone_number")) {
        db.exec("ALTER TABLE financial_services ADD COLUMN phone_number TEXT");
      }
      if (!colNames.has("omt_service_type")) {
        db.exec(
          "ALTER TABLE financial_services ADD COLUMN omt_service_type TEXT",
        );
      }
    },
  },
  // =========================================================================
  {
    version: 23,
    name: "rename_legacy_drawer_names",
    description:
      "Rename General_Drawer_B → General and OMT_Drawer_A → OMT_System in drawer_balances and sales tables",
    type: "typescript",
    up(db) {
      // Rename drawer references in drawer_balances
      db.prepare(
        "UPDATE drawer_balances SET drawer_name = 'General' WHERE drawer_name = 'General_Drawer_B'",
      ).run();
      db.prepare(
        "UPDATE drawer_balances SET drawer_name = 'OMT_System' WHERE drawer_name = 'OMT_Drawer_A'",
      ).run();

      // Rename drawer references in sales
      db.prepare(
        "UPDATE sales SET drawer_name = 'General' WHERE drawer_name = 'General_Drawer_B'",
      ).run();

      // Rename drawer references in payments
      db.prepare(
        "UPDATE payments SET drawer_name = 'General' WHERE drawer_name = 'General_Drawer_B'",
      ).run();
      db.prepare(
        "UPDATE payments SET drawer_name = 'OMT_System' WHERE drawer_name = 'OMT_Drawer_A'",
      ).run();
    },
  },
  // =========================================================================
  {
    version: 24,
    name: "expand_recharges_table",
    description:
      "Expand recharges table schema, update carrier CHECK, add new columns for full workflow, and migrate recharge transactions from sales to recharges",
    type: "typescript",
    up(db) {
      // SQLite can't ALTER CHECK constraints or rename columns, so we
      // recreate the recharges table with the new schema.
      db.exec(`
        CREATE TABLE IF NOT EXISTS recharges_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          carrier TEXT CHECK(carrier IN ('MTC', 'Alfa')) NOT NULL,
          recharge_type TEXT CHECK(recharge_type IN ('CREDIT_TRANSFER', 'VOUCHER', 'DAYS', 'TOP_UP')) NOT NULL DEFAULT 'CREDIT_TRANSFER',
          amount DECIMAL(10, 2) NOT NULL,
          cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
          price DECIMAL(10, 2) NOT NULL DEFAULT 0,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          paid_by TEXT DEFAULT 'CASH',
          phone_number TEXT,
          client_id INTEGER,
          client_name TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER DEFAULT 1,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );
      `);

      // Migrate any existing data from old recharges table (unlikely, since it was unused)
      // Map old carrier values: Touch → MTC (both are the same provider, just different names)
      const oldCols = db
        .prepare("PRAGMA table_info(recharges)")
        .all() as Array<{ name: string }>;
      const colNames = oldCols.map((c) => c.name);
      if (colNames.includes("amount_usd")) {
        // Old schema - migrate with column mapping
        db.exec(`
          INSERT INTO recharges_new (carrier, amount, phone_number, client_name, note, created_at)
          SELECT
            CASE WHEN carrier = 'Touch' THEN 'MTC' ELSE carrier END,
            amount_usd, phone_number, client_name, note, created_at
          FROM recharges;
        `);
      }

      db.exec(`
        DROP TABLE recharges;
        ALTER TABLE recharges_new RENAME TO recharges;
      `);

      // Migrate recharge-type sales into the new recharges table
      // These are sales rows with note like 'MTC %' or 'Alfa %' and no sale_items
      db.exec(`
        INSERT INTO recharges (carrier, recharge_type, amount, price, currency_code, paid_by, client_id, note, created_at, created_by)
        SELECT
          CASE
            WHEN note LIKE 'MTC %' THEN 'MTC'
            WHEN note LIKE 'Alfa %' THEN 'Alfa'
            ELSE 'MTC'
          END,
          'CREDIT_TRANSFER',
          total_amount_usd,
          final_amount_usd,
          'USD',
          COALESCE((SELECT p.method FROM payments p INNER JOIN transactions t ON p.transaction_id = t.id WHERE t.source_table = 'sales' AND t.source_id = sales.id LIMIT 1), 'CASH'),
          client_id,
          note,
          created_at,
          1
        FROM sales
        WHERE note LIKE 'MTC %' OR note LIKE 'Alfa %';
      `);

      // Update transactions source_table for migrated recharges
      // (point them to the new recharges table instead of sales)
      db.exec(`
        UPDATE transactions SET source_table = 'recharges'
        WHERE type = 'RECHARGE' AND source_table = 'sales';
      `);

      // Create index for common queries
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recharges_carrier ON recharges(carrier);
        CREATE INDEX IF NOT EXISTS idx_recharges_created_at ON recharges(created_at DESC);
      `);
    },
  },
  // =========================================================================
  {
    version: 25,
    name: "merge_binance_into_financial_services",
    description:
      "Migrate binance_transactions data into financial_services as BINANCE provider, update CHECK constraint, and drop binance_transactions",
    type: "typescript",
    up(db) {
      // 1. Recreate financial_services with BINANCE in the CHECK constraint
      //    SQLite cannot ALTER CHECK constraints, so we recreate the table.
      db.exec(`
        CREATE TABLE IF NOT EXISTS financial_services_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'IPEC', 'KATCH', 'WISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,
          service_type TEXT CHECK(service_type IN ('SEND', 'RECEIVE', 'BILL_PAYMENT')) NOT NULL,
          amount DECIMAL(10, 2) NOT NULL,
          currency TEXT DEFAULT 'USD' NOT NULL,
          commission DECIMAL(10, 2) DEFAULT 0,
          cost DECIMAL(10, 2) DEFAULT 0,
          price DECIMAL(10, 2) DEFAULT 0,
          paid_by TEXT DEFAULT 'CASH',
          client_id INTEGER REFERENCES clients(id),
          client_name TEXT,
          reference_number TEXT,
          phone_number TEXT,
          omt_service_type TEXT CHECK(omt_service_type IN ('BILL_PAYMENT', 'CASH_TO_BUSINESS', 'MINISTRY_OF_INTERIOR', 'CASH_OUT', 'MINISTRY_OF_FINANCE', 'INTRA', 'ONLINE_BROKERAGE')),
          item_key TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER
        );
      `);

      // Copy existing financial_services data
      db.exec(`
        INSERT INTO financial_services_new
        SELECT * FROM financial_services;
      `);

      // 2. Migrate binance_transactions into the new table
      const binanceExists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='binance_transactions'",
        )
        .get();

      if (binanceExists) {
        db.exec(`
          INSERT INTO financial_services_new (
            provider, service_type, amount, currency, commission, cost, price,
            paid_by, client_name, note, created_at, created_by
          )
          SELECT
            'BINANCE',
            type,
            amount,
            currency_code,
            0,
            0,
            0,
            NULL,
            client_name,
            description,
            created_at,
            created_by
          FROM binance_transactions;
        `);

        // Update transactions source_table for migrated Binance rows
        db.exec(`
          UPDATE transactions SET source_table = 'financial_services'
          WHERE type = 'BINANCE' AND source_table = 'binance_transactions';
        `);

        // Drop old table
        db.exec("DROP TABLE IF EXISTS binance_transactions;");
      }

      // Swap tables
      db.exec(`
        DROP TABLE financial_services;
        ALTER TABLE financial_services_new RENAME TO financial_services;
      `);

      // Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_financial_services_provider ON financial_services(provider);
        CREATE INDEX IF NOT EXISTS idx_financial_services_created_at ON financial_services(created_at DESC);
      `);
    },
  },
  {
    version: 26,
    name: "remove_bill_payment_add_western_union",
    description:
      "Remove BILL_PAYMENT from service_type CHECK (only SEND/RECEIVE), add WESTERN_UNION to omt_service_type CHECK",
    type: "typescript",
    up(db) {
      // SQLite cannot ALTER CHECK constraints — full table rebuild required.
      // Pattern established in v14 and v25.

      // 1. Count existing BILL_PAYMENT rows to decide migration strategy
      const billPaymentCount = db
        .prepare(
          "SELECT COUNT(*) as cnt FROM financial_services WHERE service_type = 'BILL_PAYMENT'",
        )
        .get() as { cnt: number };

      // 2. Create new table with updated CHECK constraints
      db.exec(`
        CREATE TABLE IF NOT EXISTS financial_services_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'IPEC', 'KATCH', 'WISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,
          service_type TEXT CHECK(service_type IN ('SEND', 'RECEIVE')) NOT NULL,
          amount DECIMAL(10, 2) NOT NULL,
          currency TEXT DEFAULT 'USD' NOT NULL,
          commission DECIMAL(10, 2) DEFAULT 0,
          cost DECIMAL(10, 2) DEFAULT 0,
          price DECIMAL(10, 2) DEFAULT 0,
          paid_by TEXT DEFAULT 'CASH',
          client_id INTEGER REFERENCES clients(id),
          client_name TEXT,
          reference_number TEXT,
          phone_number TEXT,
          omt_service_type TEXT CHECK(omt_service_type IN ('BILL_PAYMENT', 'CASH_TO_BUSINESS', 'MINISTRY_OF_INTERIOR', 'CASH_OUT', 'MINISTRY_OF_FINANCE', 'INTRA', 'ONLINE_BROKERAGE', 'WESTERN_UNION')),
          item_key TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER
        );
      `);

      // 3. Copy data — migrate BILL_PAYMENT rows to SEND
      if (billPaymentCount.cnt > 0) {
        db.exec(`
          INSERT INTO financial_services_new
          SELECT id, provider,
            CASE WHEN service_type = 'BILL_PAYMENT' THEN 'SEND' ELSE service_type END,
            amount, currency, commission, cost, price, paid_by, client_id,
            client_name, reference_number, phone_number, omt_service_type,
            item_key, note, created_at, created_by
          FROM financial_services;
        `);
      } else {
        db.exec(`
          INSERT INTO financial_services_new
          SELECT * FROM financial_services;
        `);
      }

      // 4. Swap tables
      db.exec(`
        DROP TABLE financial_services;
        ALTER TABLE financial_services_new RENAME TO financial_services;
      `);

      // 5. Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_financial_services_provider ON financial_services(provider);
        CREATE INDEX IF NOT EXISTS idx_financial_services_created_at ON financial_services(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_financial_services_provider_type_created_at ON financial_services(provider, service_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_financial_services_paid_by ON financial_services(paid_by);
        CREATE INDEX IF NOT EXISTS idx_financial_services_client_id ON financial_services(client_id);
      `);
    },
  },
  {
    version: 27,
    name: "update_omt_service_types",
    description:
      "Update OMT service types: remove BILL_PAYMENT/MINISTRY_OF_INTERIOR/MINISTRY_OF_FINANCE/CASH_OUT, add CASH_TO_GOV/OMT_WALLET/OMT_CARD, rename BILL_PAYMENT to OGERO_MECANIQUE",
    type: "typescript",
    up(db) {
      // SQLite cannot ALTER CHECK constraints — full table rebuild required.

      // 1. Create new table with updated CHECK constraints
      db.exec(`
        CREATE TABLE IF NOT EXISTS financial_services_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'IPEC', 'KATCH', 'WISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,
          service_type TEXT CHECK(service_type IN ('SEND', 'RECEIVE')) NOT NULL,
          amount DECIMAL(10, 2) NOT NULL,
          currency TEXT DEFAULT 'USD' NOT NULL,
          commission DECIMAL(10, 2) DEFAULT 0,
          cost DECIMAL(10, 2) DEFAULT 0,
          price DECIMAL(10, 2) DEFAULT 0,
          paid_by TEXT DEFAULT 'CASH',
          client_id INTEGER REFERENCES clients(id),
          client_name TEXT,
          reference_number TEXT,
          phone_number TEXT,
          omt_service_type TEXT CHECK(omt_service_type IN ('INTRA', 'WESTERN_UNION', 'CASH_TO_BUSINESS', 'CASH_TO_GOV', 'OMT_WALLET', 'OMT_CARD', 'OGERO_MECANIQUE', 'ONLINE_BROKERAGE')),
          item_key TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER
        );
      `);

      // 2. Copy data with mapping old service types to new ones
      db.exec(`
        INSERT INTO financial_services_new
        SELECT id, provider, service_type, amount, currency, commission, cost, price, paid_by, client_id,
          client_name, reference_number, phone_number,
          CASE 
            WHEN omt_service_type = 'BILL_PAYMENT' THEN 'OGERO_MECANIQUE'
            WHEN omt_service_type IN ('MINISTRY_OF_INTERIOR', 'MINISTRY_OF_FINANCE') THEN 'CASH_TO_GOV'
            WHEN omt_service_type = 'CASH_OUT' THEN 'INTRA'
            ELSE omt_service_type
          END,
          item_key, note, created_at, created_by
        FROM financial_services;
      `);

      // 3. Swap tables
      db.exec(`
        DROP TABLE financial_services;
        ALTER TABLE financial_services_new RENAME TO financial_services;
      `);

      // 4. Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_financial_services_provider ON financial_services(provider);
        CREATE INDEX IF NOT EXISTS idx_financial_services_created_at ON financial_services(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_financial_services_provider_type_created_at ON financial_services(provider, service_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_financial_services_paid_by ON financial_services(paid_by);
        CREATE INDEX IF NOT EXISTS idx_financial_services_client_id ON financial_services(client_id);
      `);
    },
  },
  {
    version: 28,
    name: "add_fee_calculation_fields",
    description:
      "Add omtFee, profitRate, and payFee fields to financial_services for auto-calculation",
    type: "typescript",
    up(db) {
      // Get existing columns
      const columns = db
        .prepare("PRAGMA table_info(financial_services)")
        .all() as Array<{ name: string }>;
      const colNames = new Set(columns.map((c) => c.name));

      // Add omtFee column (OMT's fee, user-entered)
      if (!colNames.has("omt_fee")) {
        db.exec(
          "ALTER TABLE financial_services ADD COLUMN omt_fee DECIMAL(10, 2) DEFAULT 0",
        );
      }

      // Add profitRate column (for ONLINE_BROKERAGE, 0.1%-0.4%)
      if (!colNames.has("profit_rate")) {
        db.exec(
          "ALTER TABLE financial_services ADD COLUMN profit_rate DECIMAL(6, 5) DEFAULT NULL",
        );
      }

      // Add payFee column (for BINANCE fee checkbox)
      if (!colNames.has("pay_fee")) {
        db.exec(
          "ALTER TABLE financial_services ADD COLUMN pay_fee INTEGER DEFAULT 0",
        );
      }
    },
  },
  // =========================================================================
  // Remove analytics/commissions module (merged into Profits)
  // =========================================================================
  {
    version: 29,
    name: "remove_analytics_commissions_module",
    description:
      "Remove analytics/commissions module (functionality merged into Profits page)",
    type: "typescript",
    up(db) {
      db.exec(`
        DELETE FROM modules WHERE key IN ('analytics', 'commissions', 'commissions_dashboard');
        DELETE FROM currency_modules WHERE module_key IN ('analytics', 'commissions', 'commissions_dashboard');
      `);
    },
  },
  // =========================================================================
  // v33 — Add payment_method_fee + payment_method_fee_rate to financial_services
  // =========================================================================
  {
    version: 33,
    name: "add_payment_method_fee_columns",
    description:
      "Add payment_method_fee and payment_method_fee_rate columns to financial_services " +
      "for tracking non-cash payment method surcharge (e.g. 1% on WHISH/OMT wallet payments).",
    type: "typescript",
    up(db) {
      const cols = db
        .prepare("PRAGMA table_info(financial_services)")
        .all() as { name: string }[];
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has("payment_method_fee")) {
        db.exec(
          "ALTER TABLE financial_services ADD COLUMN payment_method_fee REAL DEFAULT 0",
        );
      }
      if (!colNames.has("payment_method_fee_rate")) {
        db.exec(
          "ALTER TABLE financial_services ADD COLUMN payment_method_fee_rate REAL DEFAULT NULL",
        );
      }
    },
    down(db) {
      // SQLite: no DROP COLUMN — rebuild table omitting the two new columns
      db.exec(`
        CREATE TABLE financial_services_v33_rb AS
        SELECT id, provider, service_type, amount, currency, commission,
               cost, price, paid_by, client_id, client_name, reference_number,
               phone_number, omt_service_type, item_key, note,
               omt_fee, whish_fee, profit_rate, pay_fee,
               is_settled, settled_at, settlement_id,
               created_at, created_by
        FROM financial_services;
        DROP TABLE financial_services;
        ALTER TABLE financial_services_v33_rb RENAME TO financial_services;
      `);
    },
  },
  // =========================================================================
  // v34 — Add supplier_id to products table
  // =========================================================================
  {
    version: 34,
    name: "add_supplier_id_to_products",
    description:
      "Add supplier_id foreign key to products table for supplier tracking per inventory item",
    type: "typescript",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(products)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "supplier_id")) {
        db.exec(
          `ALTER TABLE products ADD COLUMN supplier_id INTEGER DEFAULT NULL REFERENCES suppliers(id) ON DELETE SET NULL;`,
        );
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);`,
        );
      }
    },
    down(db) {
      // SQLite: no DROP COLUMN — rebuild table omitting supplier_id
      db.exec(`
        CREATE TABLE products_v34_rb AS
        SELECT id, barcode, name, item_type, category, description,
               cost_price_usd, selling_price_usd, min_stock_level, stock_quantity,
               imei, color, image_url, warranty_expiry, status, is_active,
               created_at, is_deleted, updated_at
        FROM products;
        DROP TABLE products;
        ALTER TABLE products_v34_rb RENAME TO products;
      `);
    },
  },
  // =========================================================================
  // v38 — Add category_id FK to products (CASCADE DELETE) + populate from text
  // =========================================================================
  {
    version: 38,
    name: "add_category_id_fk_to_products",
    description:
      "Add category_id INTEGER FK to products referencing product_categories with ON DELETE CASCADE. " +
      "Populate from existing category TEXT. Enable WAL + foreign_keys pragma.",
    type: "typescript",
    up(db) {
      // Ensure product_categories exists (may have been created by v37)
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT OR IGNORE INTO product_categories (name, sort_order) VALUES
          ('Accessories', 0),('Phones', 1),('Chargers', 2),('Audio', 3),
          ('Parts', 4),('Services', 5),('Games', 6),('Toys', 7),
          ('Education', 8),('Gifts', 9),('Other', 99);
      `);

      // Import any new categories from existing products text column
      db.exec(`
        INSERT OR IGNORE INTO product_categories (name, sort_order)
        SELECT DISTINCT category, 50
        FROM products
        WHERE category IS NOT NULL AND category != ''
          AND LOWER(category) NOT IN (SELECT LOWER(name) FROM product_categories);
      `);

      // Add category_id column if missing
      const cols = db.prepare("PRAGMA table_info(products)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "category_id")) {
        db.exec(
          `ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES product_categories(id) ON DELETE CASCADE;`,
        );
      }

      // Populate category_id from the text category field
      db.exec(`
        UPDATE products
        SET category_id = (
          SELECT id FROM product_categories
          WHERE name = products.category COLLATE NOCASE
          LIMIT 1
        )
        WHERE category_id IS NULL AND category IS NOT NULL;
      `);

      // Create index for FK lookups
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);`,
      );
    },
  },
  // =========================================================================
  // v35 — Add unit column to products table
  // =========================================================================
  {
    version: 35,
    name: "add_unit_to_products",
    description:
      "Add unit column to products table (e.g. 'pcs', 'box', 'kg') for .toon import and display",
    type: "typescript",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(products)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "unit")) {
        db.exec(`ALTER TABLE products ADD COLUMN unit TEXT DEFAULT NULL;`);
      }
    },
  },
  // =========================================================================
  // v36 — Replace supplier_id FK with supplier TEXT on products
  // =========================================================================
  {
    version: 36,
    name: "replace_supplier_id_with_supplier_text",
    description:
      "Replace supplier_id FK with plain text supplier field on products table. Remove unit column.",
    type: "typescript",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(products)").all() as {
        name: string;
      }[];
      const colNames = new Set(cols.map((c) => c.name));
      // Add supplier TEXT if missing
      if (!colNames.has("supplier")) {
        db.exec(`ALTER TABLE products ADD COLUMN supplier TEXT DEFAULT NULL;`);
      }
      // SQLite can't drop columns — we just leave supplier_id and unit in place
      // (they'll be ignored). Supplier text takes priority going forward.
    },
  },
  // =========================================================================
  // v37 — Create product_categories table
  // =========================================================================
  {
    version: 37,
    name: "create_product_categories",
    description:
      "Create product_categories table with default categories for inventory",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        INSERT OR IGNORE INTO product_categories (name, sort_order) VALUES
          ('Accessories', 0),
          ('Phones', 1),
          ('Chargers', 2),
          ('Audio', 3),
          ('Parts', 4),
          ('Services', 5),
          ('Games', 6);
      `);

      // Import any existing product categories from the products table
      db.exec(`
        INSERT OR IGNORE INTO product_categories (name, sort_order)
        SELECT DISTINCT category, 50
        FROM products
        WHERE category IS NOT NULL AND category != ''
          AND category NOT IN (SELECT name FROM product_categories);
      `);
    },
  },
  // =========================================================================
  // v32 — Add whish_fee column to financial_services
  // =========================================================================
  {
    version: 32,
    name: "add_whish_fee_to_financial_services",
    description:
      "Add whish_fee column to financial_services table for WHISH fee tracking.",
    type: "typescript",
    up(db) {
      const cols = db
        .prepare("PRAGMA table_info(financial_services)")
        .all() as { name: string }[];
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has("whish_fee")) {
        db.exec(
          "ALTER TABLE financial_services ADD COLUMN whish_fee DECIMAL(10, 4) DEFAULT NULL",
        );
      }
    },
    down(db) {
      // SQLite: no DROP COLUMN — rebuild table
      db.exec(`
        CREATE TABLE financial_services_v32_rb AS
        SELECT id, provider, service_type, amount, currency, commission,
               cost, price, paid_by, client_id, client_name, reference_number,
               phone_number, omt_service_type, item_key, note,
               omt_fee, profit_rate, pay_fee,
               is_settled, settled_at, settlement_id,
               created_at, created_by
        FROM financial_services;
        DROP TABLE financial_services;
        ALTER TABLE financial_services_v32_rb RENAME TO financial_services;
      `);
    },
  },

  // =========================================================================
  // v31 — Settlement tracking: is_settled, settled_at, settlement_id on financial_services
  //        + SETTLEMENT entry type on supplier_ledger
  // =========================================================================
  {
    version: 31,
    name: "add_settlement_tracking_to_financial_services",
    description:
      "Add is_settled, settled_at, settlement_id to financial_services. " +
      "Rebuild supplier_ledger to include SETTLEMENT entry type. " +
      "Backfill: SEND rows → is_settled=1, RECEIVE rows with commission > 0 → is_settled=0.",
    type: "typescript",
    up(db) {
      // ── Step 1: Add columns to financial_services (idempotent) ────────────
      const fsCols = db
        .prepare("PRAGMA table_info(financial_services)")
        .all() as { name: string }[];
      const fsColNames = new Set(fsCols.map((c) => c.name));

      if (!fsColNames.has("is_settled")) {
        // Default 1 = settled (all existing rows assumed settled until backfill below)
        db.exec(
          `ALTER TABLE financial_services ADD COLUMN is_settled INTEGER NOT NULL DEFAULT 1`,
        );
      }
      if (!fsColNames.has("settled_at")) {
        db.exec(`ALTER TABLE financial_services ADD COLUMN settled_at TEXT`);
      }
      if (!fsColNames.has("settlement_id")) {
        db.exec(
          `ALTER TABLE financial_services ADD COLUMN settlement_id INTEGER`,
        );
      }

      // ── Step 2: Backfill — mark RECEIVE rows with commission > 0 as unsettled ──
      db.exec(`
        UPDATE financial_services
        SET is_settled = 0, settled_at = NULL
        WHERE service_type = 'RECEIVE'
          AND commission > 0
          AND is_settled = 1;
      `);

      // Backfill settled_at for SEND rows (already settled at creation time)
      db.exec(`
        UPDATE financial_services
        SET settled_at = created_at
        WHERE service_type = 'SEND'
          AND is_settled = 1
          AND settled_at IS NULL;
      `);

      // ── Step 3: Rebuild supplier_ledger with SETTLEMENT in CHECK constraint ──
      // SQLite cannot ALTER CHECK constraints — full rebuild required.
      db.exec(`
        CREATE TABLE supplier_ledger_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id   INTEGER NOT NULL,
          entry_type    TEXT    NOT NULL CHECK(entry_type IN ('TOP_UP', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT')),
          amount_usd    REAL    NOT NULL DEFAULT 0,
          amount_lbp    REAL    NOT NULL DEFAULT 0,
          note          TEXT,
          created_by    INTEGER,
          transaction_id INTEGER,
          created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplier_id)   REFERENCES suppliers(id) ON DELETE CASCADE,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id),
          FOREIGN KEY (created_by)    REFERENCES users(id)
        );
      `);

      db.exec(`
        INSERT INTO supplier_ledger_new
          (id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, created_at)
        SELECT
          id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, created_at
        FROM supplier_ledger;
      `);

      db.exec(`DROP TABLE supplier_ledger;`);
      db.exec(`ALTER TABLE supplier_ledger_new RENAME TO supplier_ledger;`);

      // Recreate indexes on financial_services
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_financial_services_is_settled
          ON financial_services(is_settled);
        CREATE INDEX IF NOT EXISTS idx_financial_services_provider_settled
          ON financial_services(provider, is_settled);
      `);
    },
    down(db) {
      // Remove added columns (SQLite: requires table rebuild)
      db.exec(`
        CREATE TABLE financial_services_rollback AS
        SELECT id, provider, service_type, amount, currency, commission,
               cost, price, paid_by, client_id, client_name, reference_number,
               phone_number, omt_service_type, item_key, note,
               omt_fee, profit_rate, pay_fee, created_at, created_by
        FROM financial_services;
        DROP TABLE financial_services;
        ALTER TABLE financial_services_rollback RENAME TO financial_services;
      `);
      // Rebuild supplier_ledger without SETTLEMENT
      db.exec(`
        CREATE TABLE supplier_ledger_rollback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','PAYMENT','ADJUSTMENT')),
          amount_usd REAL NOT NULL DEFAULT 0,
          amount_lbp REAL NOT NULL DEFAULT 0,
          note TEXT, created_by INTEGER, transaction_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
        );
        INSERT INTO supplier_ledger_rollback
          SELECT id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, created_at
          FROM supplier_ledger WHERE entry_type != 'SETTLEMENT';
        DROP TABLE supplier_ledger;
        ALTER TABLE supplier_ledger_rollback RENAME TO supplier_ledger;
      `);
    },
  },

  // =========================================================================
  // v30 — Exchange rates schema refactor: 4-column universal formula model
  //        + leg tracking columns on exchange_transactions
  // =========================================================================
  {
    version: 30,
    name: "exchange_rates_universal_formula_schema",
    description:
      "Redesign exchange_rates to 4-column schema (to_code, market_rate, delta, is_stronger). " +
      "Add leg1/leg2 profit tracking columns to exchange_transactions.",
    type: "typescript",
    up(db) {
      // ── Step 1: Recreate exchange_rates with new schema ─────────────────
      // Derive market_rate and delta from existing rows where possible.
      // Existing schema: (from_code, to_code, rate, base_rate)
      // LBP row: ('USD','LBP', sell_rate, base_rate) → market=base_rate, delta=|rate-base_rate|, is_stronger=+1
      // EUR row: ('EUR','USD', buy_rate,  base_rate) → market=base_rate, delta=|rate-base_rate|, is_stronger=-1

      db.exec(`
        CREATE TABLE IF NOT EXISTS exchange_rates_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          to_code     TEXT    NOT NULL UNIQUE,
          market_rate REAL    NOT NULL,
          delta       REAL    NOT NULL DEFAULT 0,
          is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
          updated_at  TEXT    DEFAULT (datetime('now'))
        );
      `);

      // Migrate LBP (is_stronger = +1, USD is stronger)
      const lbpRow = db
        .prepare(
          "SELECT rate, base_rate FROM exchange_rates WHERE from_code='USD' AND to_code='LBP'",
        )
        .get() as { rate: number; base_rate: number | null } | undefined;

      if (lbpRow) {
        const market = lbpRow.base_rate ?? lbpRow.rate;
        const delta = Math.abs(lbpRow.rate - market);
        db.prepare(
          "INSERT OR IGNORE INTO exchange_rates_new (to_code, market_rate, delta, is_stronger) VALUES ('LBP', ?, ?, 1)",
        ).run(market, delta);
      } else {
        // Fresh DB with no rates yet — insert sensible defaults
        db.prepare(
          "INSERT OR IGNORE INTO exchange_rates_new (to_code, market_rate, delta, is_stronger) VALUES ('LBP', 89500, 500, 1)",
        ).run();
      }

      // Migrate EUR (is_stronger = -1, EUR is stronger)
      const eurRow = db
        .prepare(
          "SELECT rate, base_rate FROM exchange_rates WHERE from_code='EUR' AND to_code='USD'",
        )
        .get() as { rate: number; base_rate: number | null } | undefined;

      if (eurRow) {
        const market = eurRow.base_rate ?? eurRow.rate;
        const delta = Math.abs(eurRow.rate - market);
        db.prepare(
          "INSERT OR IGNORE INTO exchange_rates_new (to_code, market_rate, delta, is_stronger) VALUES ('EUR', ?, ?, -1)",
        ).run(market, delta);
      } else {
        db.prepare(
          "INSERT OR IGNORE INTO exchange_rates_new (to_code, market_rate, delta, is_stronger) VALUES ('EUR', 1.18, 0.02, -1)",
        ).run();
      }

      // Migrate any other non-USD currencies stored as (X, USD, rate, base_rate) — is_stronger = -1
      const otherRows = db
        .prepare(
          "SELECT from_code, rate, base_rate FROM exchange_rates WHERE to_code='USD' AND from_code NOT IN ('USD','LBP','EUR')",
        )
        .all() as {
        from_code: string;
        rate: number;
        base_rate: number | null;
      }[];

      for (const row of otherRows) {
        const market = row.base_rate ?? row.rate;
        const delta = Math.abs(row.rate - market);
        db.prepare(
          "INSERT OR IGNORE INTO exchange_rates_new (to_code, market_rate, delta, is_stronger) VALUES (?, ?, ?, -1)",
        ).run(row.from_code, market, delta);
      }

      // Swap tables
      db.exec(`
        DROP TABLE exchange_rates;
        ALTER TABLE exchange_rates_new RENAME TO exchange_rates;
      `);

      // ── Step 2: Add leg tracking columns to exchange_transactions ───────
      const etCols = db
        .prepare("PRAGMA table_info(exchange_transactions)")
        .all() as { name: string }[];
      const etColNames = new Set(etCols.map((c) => c.name));

      const legCols: [string, string][] = [
        ["leg1_rate", "REAL"],
        ["leg1_market_rate", "REAL"],
        ["leg1_profit_usd", "REAL"],
        ["leg2_rate", "REAL"],
        ["leg2_market_rate", "REAL"],
        ["leg2_profit_usd", "REAL"],
        ["via_currency", "TEXT"],
      ];

      for (const [col, type] of legCols) {
        if (!etColNames.has(col)) {
          db.exec(
            `ALTER TABLE exchange_transactions ADD COLUMN ${col} ${type};`,
          );
        }
      }

      // Backfill existing rows: copy old rate → leg1_rate, base_rate → leg1_market_rate, profit_usd → leg1_profit_usd
      db.exec(`
        UPDATE exchange_transactions
        SET
          leg1_rate        = rate,
          leg1_market_rate = base_rate,
          leg1_profit_usd  = profit_usd
        WHERE leg1_rate IS NULL;
      `);
    },
  },
  // =========================================================================
  // v39 — Setup wizard feature flags
  // =========================================================================
  {
    version: 39,
    name: "setup_wizard_feature_flags",
    description:
      "Add setup_complete, feature_session_management, and feature_customer_sessions settings keys",
    type: "typescript",
    up(db) {
      db.exec(`
        INSERT OR IGNORE INTO system_settings (key_name, value) VALUES ('setup_complete', '0');
        INSERT OR IGNORE INTO system_settings (key_name, value) VALUES ('feature_session_management', 'enabled');
        INSERT OR IGNORE INTO system_settings (key_name, value) VALUES ('feature_customer_sessions', 'enabled');
      `);
    },
    down(db) {
      db.exec(`
        DELETE FROM system_settings WHERE key_name IN ('setup_complete', 'feature_session_management', 'feature_customer_sessions');
      `);
    },
  },
  // =========================================================================
  // v40 — Create product_suppliers table for inventory supplier tracking
  // =========================================================================
  {
    version: 40,
    name: "create_product_suppliers",
    description:
      "Create product_suppliers table (normalised inventory suppliers). " +
      "Import unique supplier names from existing products.",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_suppliers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Import any existing supplier names from the products table
      db.exec(`
        INSERT OR IGNORE INTO product_suppliers (name, sort_order)
        SELECT DISTINCT supplier, 50
        FROM products
        WHERE supplier IS NOT NULL AND supplier != ''
          AND LOWER(supplier) NOT IN (SELECT LOWER(name) FROM product_suppliers);
      `);
    },
    down(db) {
      db.exec(`DROP TABLE IF EXISTS product_suppliers;`);
    },
  },

  // =========================================================================
  // v41 — Fix category cascade: ON DELETE CASCADE → ON DELETE SET NULL
  //        Prevents category deletion from destroying all linked products.
  // =========================================================================
  {
    version: 41,
    name: "fix_category_cascade_to_set_null",
    description:
      "Rebuild products table so that category_id FK uses ON DELETE SET NULL " +
      "instead of ON DELETE CASCADE. Prevents accidental product deletion.",
    type: "typescript",
    up(db) {
      // SQLite cannot ALTER FK constraints — full table rebuild required.
      // 1. Get column definitions from the existing table
      const cols = db.prepare("PRAGMA table_info(products)").all() as {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[];
      const colNames = cols.map((c) => c.name).join(", ");

      // 2. Build column definitions dynamically so we preserve ALL columns
      //    (including any added by earlier migrations like supplier_id, unit, etc.)
      const colDefs = cols
        .map((c) => {
          // Primary key
          if (c.pk) return `${c.name} INTEGER PRIMARY KEY AUTOINCREMENT`;
          // Fix the FK on category_id: change to ON DELETE SET NULL
          if (c.name === "category_id") {
            return `category_id INTEGER DEFAULT NULL REFERENCES product_categories(id) ON DELETE SET NULL`;
          }
          // Barcode has UNIQUE constraint
          if (c.name === "barcode") return `barcode TEXT UNIQUE`;
          // Build standard column def
          let def = `${c.name} ${c.type || "TEXT"}`;
          if (c.notnull) def += " NOT NULL";
          if (c.dflt_value !== null) def += ` DEFAULT ${c.dflt_value}`;
          return def;
        })
        .join(",\n          ");

      // 2. Recreate the table with the corrected FK
      db.exec(`CREATE TABLE products_new (\n          ${colDefs}\n        );`);

      // 3. Copy all data
      db.exec(`
        INSERT INTO products_new (${colNames})
        SELECT ${colNames} FROM products;
      `);

      // 4. Swap tables
      db.exec(`DROP TABLE products;`);
      db.exec(`ALTER TABLE products_new RENAME TO products;`);

      // 5. Recreate indexes that may have existed
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
        CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
      `);
    },
    down(db) {
      // Revert to ON DELETE CASCADE (original schema)
      const cols = db.prepare("PRAGMA table_info(products)").all() as {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[];
      const colNames = cols.map((c) => c.name).join(", ");

      // Build column definitions dynamically, reverting category_id FK to CASCADE
      const colDefs = cols
        .map((c) => {
          if (c.pk) return `${c.name} INTEGER PRIMARY KEY AUTOINCREMENT`;
          if (c.name === "category_id") {
            return `category_id INTEGER DEFAULT NULL REFERENCES product_categories(id) ON DELETE CASCADE`;
          }
          if (c.name === "barcode") return `barcode TEXT UNIQUE`;
          let def = `${c.name} ${c.type || "TEXT"}`;
          if (c.notnull) def += " NOT NULL";
          if (c.dflt_value !== null) def += ` DEFAULT ${c.dflt_value}`;
          return def;
        })
        .join(",\n          ");

      db.exec(`CREATE TABLE products_old (\n          ${colDefs}\n        );`);

      db.exec(`
        INSERT INTO products_old (${colNames})
        SELECT ${colNames} FROM products;
      `);

      db.exec(`DROP TABLE products;`);
      db.exec(`ALTER TABLE products_old RENAME TO products;`);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
        CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
      `);
    },
  },
  {
    version: 42,
    name: "add_reports_and_transactions_modules",
    description:
      "Add Reports and Transactions modules to the sidebar for existing databases.",
    type: "typescript",
    up(db) {
      db.exec(`
        INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
        VALUES
          ('reports',      'Reports',      'BarChart2',      '/reports',       14, 1, 1, 0),
          ('transactions', 'Transactions', 'ClipboardList', '/transactions', 15, 1, 1, 0);
      `);
    },
    down(db) {
      db.exec(`
        DELETE FROM modules WHERE key IN ('reports', 'transactions');
      `);
    },
  },
  {
    version: 43,
    name: "add_soft_delete_to_products",
    description:
      "Add is_deleted and updated_at columns to products table for soft delete support",
    type: "typescript",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(products)").all() as {
        name: string;
      }[];
      const colNames = new Set(cols.map((c) => c.name));

      if (!colNames.has("is_deleted")) {
        db.exec(
          "ALTER TABLE products ADD COLUMN is_deleted BOOLEAN DEFAULT 0;",
        );
      }
      if (!colNames.has("updated_at")) {
        db.exec(
          "ALTER TABLE products ADD COLUMN updated_at DATETIME DEFAULT NULL;",
        );
      }
    },
    down(db) {
      // Table rebuild required to remove columns in SQLite
      const cols = db.prepare("PRAGMA table_info(products)").all() as {
        name: string;
      }[];
      const remainingCols = cols
        .map((c) => c.name)
        .filter((name) => name !== "is_deleted" && name !== "updated_at")
        .join(", ");

      db.exec(`
        CREATE TABLE products_v43_rb AS SELECT ${remainingCols} FROM products;
        DROP TABLE products;
        ALTER TABLE products_v43_rb RENAME TO products;
        CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
        CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
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
 * Get pending migrations (includes any gaps — versions not in schema_migrations)
 */
export function getPendingMigrations(db: Database.Database): Migration[] {
  ensureMigrationsTable(db);
  const applied = new Set(
    (
      db.prepare("SELECT version FROM schema_migrations").all() as {
        version: number;
      }[]
    ).map((r) => r.version),
  );
  return MIGRATIONS.filter((m) => !applied.has(m.version)).sort(
    (a, b) => a.version - b.version,
  );
}

/**
 * Run all pending migrations (fills gaps too — not just versions above MAX)
 */
export function runMigrations(db: Database.Database): void {
  ensureMigrationsTable(db);

  const applied = new Set(
    (
      db.prepare("SELECT version FROM schema_migrations").all() as {
        version: number;
      }[]
    ).map((r) => r.version),
  );
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) {
    console.log(
      "[MIGRATIONS] Database is up to date (version " +
        getCurrentVersion(db) +
        ")",
    );
    return;
  }

  console.log(`[MIGRATIONS] Running ${pending.length} migration(s)...`);

  // Disable FK constraints during migrations — required for table rebuilds
  // (e.g. DROP TABLE + RENAME) that would otherwise trigger FK violations.
  // PRAGMA foreign_keys cannot be changed inside a transaction, so we set
  // it here, outside individual migration transactions.
  db.pragma("foreign_keys = OFF");

  try {
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
  } finally {
    // Always re-enable FK constraints, even if a migration fails
    db.pragma("foreign_keys = ON");
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
