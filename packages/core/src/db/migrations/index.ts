/**
 * Database Migration System
 *
 * Provides a centralized, version-tracked migration system for LiraTek.
 * Supports both TypeScript and SQL migrations.
 */

import type Database from "better-sqlite3";
import { addSenderReceiverFieldsMigration } from "./add_sender_receiver_fields.js";
import {
  deriveDaysCostLbp,
  deriveSellDaysLbp,
  TELECOM_CREDIT_COST_RATE_LBP,
  TELECOM_DAYS_SELL_PRICE_LBP,
} from "../../utils/telecomCredit.js";

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
          ('iPick',  'ipec_katch', 'iPick',  1),
          ('Katsh', 'ipec_katch', 'Katsh', 1),
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
          provider TEXT CHECK(provider IN ('OMT','WHISH','BOB','OTHER','iPick','Katsh','WISH_APP','OMT_APP')) NOT NULL,
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
          provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'iPick', 'Katsh', 'WISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,
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
          provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'iPick', 'Katsh', 'WISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,
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
          provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'iPick', 'Katsh', 'WISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,
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
  {
    version: 44,
    name: "add_refunded_quantity_to_sale_items",
    description:
      "Add refunded_quantity column to sale_items for partial item refunds",
    type: "typescript",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(sale_items)").all() as {
        name: string;
      }[];
      const colNames = new Set(cols.map((c) => c.name));

      if (!colNames.has("refunded_quantity")) {
        db.exec(
          "ALTER TABLE sale_items ADD COLUMN refunded_quantity INTEGER DEFAULT 0;",
        );
      }
    },
    down(db) {
      const cols = db.prepare("PRAGMA table_info(sale_items)").all() as {
        name: string;
      }[];
      const remainingCols = cols
        .map((c) => c.name)
        .filter((name) => name !== "refunded_quantity")
        .join(", ");

      db.exec(`
        CREATE TABLE sale_items_v44_rb AS SELECT ${remainingCols} FROM sale_items;
        DROP TABLE sale_items;
        ALTER TABLE sale_items_v44_rb RENAME TO sale_items;
        CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
        CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
      `);
    },
  },
  {
    version: 45,
    name: "remove_reports_transactions_modules",
    description: "Remove redundant Reports and Transactions modules",
    type: "typescript",
    up(db) {
      // Remove modules
      db.exec(`DELETE FROM modules WHERE key IN ('reports', 'transactions')`);

      // Remove from currency_modules junction
      db.exec(
        `DELETE FROM currency_modules WHERE module_key IN ('reports', 'transactions')`,
      );

      console.log("Removed Reports and Transactions modules");
    },
    down(db) {
      // Re-add modules (if needed for rollback)
      db.exec(`
        INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
        VALUES 
          ('reports', 'Reports', 'BarChart2', '/reports', 14, 1, 1, 0),
          ('transactions', 'Transactions', 'ClipboardList', '/transactions', 15, 1, 1, 0)
      `);

      // Re-add currency modules
      db.exec(`
        INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
        VALUES 
          ('USD', 'reports'), ('USD', 'transactions'),
          ('LBP', 'reports'), ('LBP', 'transactions')
      `);

      console.log("Restored Reports and Transactions modules");
    },
  },
  addSenderReceiverFieldsMigration,
  {
    version: 47,
    name: "add_loto_module",
    description:
      "Add Loto module: tables, settings, supplier, and module entry",
    type: "typescript",
    up(db) {
      // Create loto_tickets table
      db.exec(`
        CREATE TABLE IF NOT EXISTS loto_tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_number TEXT,
          sale_amount REAL NOT NULL,
          commission_rate REAL DEFAULT 0.0445,
          commission_amount REAL NOT NULL,
          is_winner INTEGER DEFAULT 0,
          prize_amount REAL DEFAULT 0,
          prize_paid_date TEXT,
          sale_date TEXT NOT NULL,
          payment_method TEXT,
          currency TEXT DEFAULT 'LBP',
          note TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_loto_tickets_sale_date ON loto_tickets(sale_date);
        CREATE INDEX IF NOT EXISTS idx_loto_tickets_is_winner ON loto_tickets(is_winner);
      `);

      // Create loto_settings table
      db.exec(`
        CREATE TABLE IF NOT EXISTS loto_settings (
          key_name TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          description TEXT,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert default settings
      db.exec(`
        INSERT OR IGNORE INTO loto_settings (key_name, value, description)
        VALUES 
          ('commission_rate', '0.0445', 'Commission rate (4.45%)'),
          ('monthly_fee_amount', '1400000', 'Monthly machine fee in LBP'),
          ('auto_record_monthly_fee', '1', 'Enable/disable auto-recording of monthly fee')
      `);

      // Create loto_monthly_fees table
      db.exec(`
        CREATE TABLE IF NOT EXISTS loto_monthly_fees (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fee_amount REAL NOT NULL,
          fee_month TEXT NOT NULL,
          fee_year INTEGER NOT NULL,
          recorded_date TEXT NOT NULL,
          is_paid INTEGER DEFAULT 0,
          paid_date TEXT,
          note TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add Loto supplier
      db.exec(`
        INSERT OR IGNORE INTO suppliers (name, provider, is_active, is_system)
        VALUES ('Loto Liban', 'LOTO', 1, 1)
      `);

      // Add Loto module
      db.exec(`
        INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
        VALUES ('loto', 'Loto', 'Ticket', '/loto', 16, 0)
      `);

      // Add currency-modules for Loto
      db.exec(`
        INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
        VALUES ('USD', 'loto'), ('LBP', 'loto')
      `);

      // Add currency-drawers for Loto
      db.exec(`
        INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
        VALUES ('USD', 'Loto'), ('LBP', 'Loto')
      `);

      console.log("Migration v47: Loto module added");
    },
    down(db) {
      // Drop tables
      db.exec(`DROP TABLE IF EXISTS loto_monthly_fees`);
      db.exec(`DROP TABLE IF EXISTS loto_settings`);
      db.exec(`DROP TABLE IF EXISTS loto_tickets`);

      // Remove supplier
      db.exec(
        `DELETE FROM suppliers WHERE name = 'Loto Liban' AND provider = 'LOTO'`,
      );

      // Remove module
      db.exec(`DELETE FROM modules WHERE key = 'loto'`);

      console.log("Migration v47 rolled back: Loto module removed");
    },
  },
  // Migration v48: Update currency_drawers from IPEC/Katch to iPick/Katsh
  {
    version: 48,
    name: "update_provider_drawer_names",
    description: "Update currency_drawers from IPEC/Katch to iPick/Katsh",
    type: "typescript",
    up(db) {
      // Update currency_drawers table
      db.exec(`
        UPDATE currency_drawers SET drawer_name = 'iPick' WHERE drawer_name = 'IPEC'
      `);
      db.exec(`
        UPDATE currency_drawers SET drawer_name = 'Katsh' WHERE drawer_name = 'Katch'
      `);

      console.log(
        "Migration v48: currency_drawers updated (IPEC→iPick, Katch→Katsh)",
      );
    },
    down(db) {
      // Rollback currency_drawers table
      db.exec(`
        UPDATE currency_drawers SET drawer_name = 'IPEC' WHERE drawer_name = 'iPick'
      `);
      db.exec(`
        UPDATE currency_drawers SET drawer_name = 'Katch' WHERE drawer_name = 'Katsh'
      `);

      console.log("Migration v48 rolled back: currency_drawers reverted");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v49 — Reorder modules + ensure drawer names updated
  // NOTE: Original v48 was duplicated (update_provider_drawer_names AND
  //       reorder_modules_loto_services_profits both had version 48).
  //       Existing DBs applied the reorder as v48 but skipped the drawer rename.
  //       This v49 combines both: drawer rename (idempotent) + module reorder.
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 49,
    name: "reorder_modules_loto_services_profits_v49",
    description:
      "Reorder modules to: Loto, Services, Profits + ensure IPEC/Katch drawer renames applied",
    type: "typescript",
    up(db) {
      // --- Ensure drawer name updates from skipped v48 are applied (idempotent) ---
      db.exec(`
        UPDATE currency_drawers SET drawer_name = 'iPick' WHERE drawer_name = 'IPEC';
      `);
      db.exec(`
        UPDATE currency_drawers SET drawer_name = 'Katsh' WHERE drawer_name = 'Katch';
      `);

      // --- Update sort_order for loto, custom_services, and profits ---
      db.exec(`
        UPDATE modules SET sort_order = 13 WHERE key = 'loto';
      `);
      db.exec(`
        UPDATE modules SET sort_order = 14 WHERE key = 'custom_services';
      `);
      db.exec(`
        UPDATE modules SET sort_order = 15 WHERE key = 'profits';
      `);

      console.log(
        "Migration v49: Drawer names updated + modules reordered (Loto, Services, Profits)",
      );
    },
    down(db) {
      // Revert module order
      db.exec(`
        UPDATE modules SET sort_order = 16 WHERE key = 'loto';
      `);
      db.exec(`
        UPDATE modules SET sort_order = 13 WHERE key = 'custom_services';
      `);
      db.exec(`
        UPDATE modules SET sort_order = 14 WHERE key = 'profits';
      `);

      // Revert drawer names
      db.exec(`
        UPDATE currency_drawers SET drawer_name = 'IPEC' WHERE drawer_name = 'iPick';
      `);
      db.exec(`
        UPDATE currency_drawers SET drawer_name = 'Katch' WHERE drawer_name = 'Katsh';
      `);

      console.log(
        "Migration v49 rolled back: Modules reverted + drawer names reverted",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v50 — Add loto_checkpoints table for scheduled checkpoint tracking
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 50,
    name: "add_loto_checkpoints_table",
    description:
      "Add loto_checkpoints table to track scheduled checkpoints for Loto module",
    type: "typescript",
    up(db) {
      // Create loto_checkpoints table
      db.exec(`
        CREATE TABLE IF NOT EXISTS loto_checkpoints (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          checkpoint_date TEXT NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          total_sales REAL NOT NULL DEFAULT 0,
          total_commission REAL NOT NULL DEFAULT 0,
          total_tickets INTEGER NOT NULL DEFAULT 0,
          total_prizes REAL NOT NULL DEFAULT 0,
          is_settled INTEGER NOT NULL DEFAULT 0,
          settled_at TEXT,
          settlement_id INTEGER,
          note TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes for efficient querying
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_loto_checkpoints_date ON loto_checkpoints(checkpoint_date);
        CREATE INDEX IF NOT EXISTS idx_loto_checkpoints_is_settled ON loto_checkpoints(is_settled);
        CREATE INDEX IF NOT EXISTS idx_loto_checkpoints_period ON loto_checkpoints(period_start, period_end);
      `);

      console.log("Migration v50: loto_checkpoints table added");
    },
    down(db) {
      // Drop loto_checkpoints table
      db.exec(`DROP TABLE IF EXISTS loto_checkpoints`);

      console.log("Migration v50 rolled back: loto_checkpoints table removed");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v51 — Add loto_cash_prizes table for cash prize tracking
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 51,
    name: "add_loto_cash_prizes_table",
    description:
      "Add loto_cash_prizes table to track cash prizes for Loto module",
    type: "typescript",
    up(db) {
      // Create loto_cash_prizes table
      db.exec(`
        CREATE TABLE IF NOT EXISTS loto_cash_prizes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_number TEXT,
          prize_amount REAL NOT NULL,
          customer_name TEXT,
          prize_date TEXT NOT NULL,
          is_reimbursed INTEGER NOT NULL DEFAULT 0,
          reimbursed_date TEXT,
          reimbursed_in_settlement_id INTEGER,
          note TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes for efficient querying
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_loto_cash_prizes_date ON loto_cash_prizes(prize_date);
        CREATE INDEX IF NOT EXISTS idx_loto_cash_prizes_reimbursed ON loto_cash_prizes(is_reimbursed);
      `);

      console.log("Migration v51: loto_cash_prizes table added");
    },
    down(db) {
      // Drop loto_cash_prizes table
      db.exec(`DROP TABLE IF EXISTS loto_cash_prizes`);

      console.log("Migration v51 rolled back: loto_cash_prizes table removed");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v52 — Add loto_settlements table for settlement history
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 52,
    name: "add_loto_settlements_table",
    description:
      "Add loto_settlements table to track settlement events for Loto module",
    type: "typescript",
    up(db) {
      // Create loto_settlements table
      db.exec(`
        CREATE TABLE IF NOT EXISTS loto_settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          settlement_date TEXT NOT NULL,
          checkpoint_ids TEXT NOT NULL,
          total_sales REAL NOT NULL DEFAULT 0,
          total_commission REAL NOT NULL DEFAULT 0,
          total_cash_prizes REAL NOT NULL DEFAULT 0,
          net_settlement REAL NOT NULL,
          note TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create index for efficient querying
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_loto_settlements_date ON loto_settlements(settlement_date);
      `);

      console.log("Migration v52: loto_settlements table added");
    },
    down(db) {
      // Drop loto_settlements table
      db.exec(`DROP TABLE IF EXISTS loto_settlements`);

      console.log("Migration v52 rolled back: loto_settlements table removed");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v53 — Create mobile_service_items table for dynamic catalog management
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 53,
    name: "create_mobile_service_items",
    description:
      "Create mobile_service_items table to replace hardcoded mobileServices.ts catalog. " +
      "Stores provider/category/subcategory/item with LBP cost/sell prices.",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_service_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          category TEXT NOT NULL,
          subcategory TEXT NOT NULL,
          label TEXT NOT NULL,
          cost_lbp REAL NOT NULL DEFAULT 0,
          sell_lbp REAL NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(provider, category, subcategory, label)
        )
      `);

      // Indexes for common query patterns
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_msi_provider ON mobile_service_items(provider);
        CREATE INDEX IF NOT EXISTS idx_msi_provider_category ON mobile_service_items(provider, category);
        CREATE INDEX IF NOT EXISTS idx_msi_active ON mobile_service_items(is_active);
      `);

      console.log("Migration v53: mobile_service_items table created");
    },
    down(db) {
      db.exec(`DROP TABLE IF EXISTS mobile_service_items`);
      console.log(
        "Migration v53 rolled back: mobile_service_items table removed",
      );
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // v54 — Audit Log
  // ───────────────────────────────────────────────────────────────────────────
  {
    version: 54,
    name: "create_audit_log",
    description:
      "Create audit_log table to track all user mutations across the system — " +
      "who did what, when, with before/after snapshots for full accountability.",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
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
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
      `);

      console.log("Migration v54: audit_log table created");
    },
    down(db) {
      db.exec(`DROP TABLE IF EXISTS audit_log`);
      console.log("Migration v54 rolled back: audit_log table removed");
    },
  },

  // =========================================================================
  // v55 — Remove stale LOGIN transaction records
  // =========================================================================
  {
    version: 55,
    name: "remove_login_transactions",
    description:
      "Delete LOGIN/LOGOUT rows from the transactions table — these were " +
      "incorrectly written by the old logActivity() helper and are not financial data.",
    type: "typescript",
    up(db) {
      // Safety net: create loto_settlements if missing (v52 was marked applied
      // in create_db.sql seed but the CREATE TABLE was accidentally omitted)
      db.exec(`
        CREATE TABLE IF NOT EXISTS loto_settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          settlement_date TEXT NOT NULL,
          checkpoint_ids TEXT NOT NULL,
          total_sales REAL NOT NULL DEFAULT 0,
          total_commission REAL NOT NULL DEFAULT 0,
          total_cash_prizes REAL NOT NULL DEFAULT 0,
          net_settlement REAL NOT NULL,
          note TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const result = db
        .prepare(`DELETE FROM transactions WHERE type IN ('LOGIN', 'LOGOUT')`)
        .run();
      console.log(
        `Migration v55: removed ${result.changes} LOGIN/LOGOUT transaction rows`,
      );
    },
    down(_db) {
      // Non-reversible — the records were junk data
      console.log("Migration v55 rolled back (no-op, data was junk)");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v56 — Add CASH_PRIZE to supplier_ledger entry_type CHECK constraint
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 56,
    name: "add_cash_prize_entry_type",
    description:
      "Add CASH_PRIZE to supplier_ledger entry_type CHECK constraint for loto cash prize payouts",
    type: "typescript",
    up(db) {
      // SQLite cannot ALTER CHECK constraints — must recreate the table
      db.exec(`
        CREATE TABLE supplier_ledger_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE')),
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

        INSERT INTO supplier_ledger_new SELECT * FROM supplier_ledger;

        DROP TABLE supplier_ledger;

        ALTER TABLE supplier_ledger_new RENAME TO supplier_ledger;

        CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
      `);

      console.log(
        "Migration v56: Added CASH_PRIZE to supplier_ledger entry_type",
      );
    },
    down(db) {
      // Remove any CASH_PRIZE entries first, then recreate with old constraint
      db.exec(`
        DELETE FROM supplier_ledger WHERE entry_type = 'CASH_PRIZE';

        CREATE TABLE supplier_ledger_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT')),
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

        INSERT INTO supplier_ledger_old SELECT * FROM supplier_ledger;

        DROP TABLE supplier_ledger;

        ALTER TABLE supplier_ledger_old RENAME TO supplier_ledger;

        CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
      `);

      console.log(
        "Migration v56 rolled back: CASH_PRIZE removed from supplier_ledger",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v57 — Link cash prizes to checkpoints
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 57,
    name: "link_cash_prizes_to_checkpoints",
    description:
      "Add checkpoint_id FK to loto_cash_prizes; add total_cash_prizes columns to loto_checkpoints",
    type: "typescript",
    up(db) {
      // 1. Add columns
      db.exec(`
        ALTER TABLE loto_cash_prizes ADD COLUMN checkpoint_id INTEGER REFERENCES loto_checkpoints(id);
        ALTER TABLE loto_checkpoints ADD COLUMN total_cash_prizes REAL NOT NULL DEFAULT 0;
        ALTER TABLE loto_checkpoints ADD COLUMN total_cash_prizes_count INTEGER NOT NULL DEFAULT 0;

        CREATE INDEX IF NOT EXISTS idx_loto_cash_prizes_checkpoint ON loto_cash_prizes(checkpoint_id);
      `);

      // 2. Backfill: assign existing cash prizes to checkpoints by date range
      db.exec(`
        UPDATE loto_cash_prizes SET checkpoint_id = (
          SELECT c.id FROM loto_checkpoints c
          WHERE date(loto_cash_prizes.prize_date) BETWEEN date(c.period_start) AND date(c.period_end)
          ORDER BY c.checkpoint_date DESC LIMIT 1
        ) WHERE checkpoint_id IS NULL;
      `);

      // 3. Backfill checkpoint totals from assigned cash prizes
      db.exec(`
        UPDATE loto_checkpoints SET 
          total_cash_prizes = COALESCE((SELECT SUM(prize_amount) FROM loto_cash_prizes WHERE checkpoint_id = loto_checkpoints.id), 0),
          total_cash_prizes_count = COALESCE((SELECT COUNT(*) FROM loto_cash_prizes WHERE checkpoint_id = loto_checkpoints.id), 0);
      `);

      console.log("Migration v57: Linked cash prizes to checkpoints");
    },
    down(db) {
      // SQLite doesn't support DROP COLUMN before 3.35.0 — recreate tables
      // For simplicity, just clear the backfilled data
      db.exec(`
        UPDATE loto_cash_prizes SET checkpoint_id = NULL;
        UPDATE loto_checkpoints SET total_cash_prizes = 0, total_cash_prizes_count = 0;
      `);
      console.log(
        "Migration v57 rolled back: cleared checkpoint_id and totals",
      );
    },
  },

  // =========================================================================
  // v58 – Add checkpoint_id to loto_tickets (mirrors cash prizes pattern)
  // =========================================================================
  {
    version: 58,
    name: "add_checkpoint_id_to_loto_tickets",
    description:
      "Add checkpoint_id FK to loto_tickets so uncheckpointed tickets are tracked by NULL checkpoint_id instead of date ranges",
    type: "typescript",
    up(db) {
      // 1. Add checkpoint_id column
      db.exec(`
        ALTER TABLE loto_tickets ADD COLUMN checkpoint_id INTEGER REFERENCES loto_checkpoints(id);
        CREATE INDEX IF NOT EXISTS idx_loto_tickets_checkpoint ON loto_tickets(checkpoint_id);
      `);

      // 2. Backfill: assign existing tickets to checkpoints by date range
      db.exec(`
        UPDATE loto_tickets SET checkpoint_id = (
          SELECT c.id FROM loto_checkpoints c
          WHERE date(loto_tickets.sale_date) BETWEEN date(c.period_start) AND date(c.period_end)
          ORDER BY c.checkpoint_date DESC LIMIT 1
        ) WHERE checkpoint_id IS NULL;
      `);

      console.log(
        "Migration v58: Added checkpoint_id to loto_tickets and backfilled",
      );
    },
    down(db) {
      db.exec(`UPDATE loto_tickets SET checkpoint_id = NULL;`);
      console.log("Migration v58 rolled back: cleared checkpoint_id");
    },
  },
  {
    version: 59,
    name: "replace_delta_with_buy_sell_rates",
    description:
      "Replace delta column with buy_rate and sell_rate in exchange_rates for independent rate control",
    type: "typescript",
    up(db) {
      // Add new columns
      db.exec(`
        ALTER TABLE exchange_rates ADD COLUMN buy_rate REAL;
        ALTER TABLE exchange_rates ADD COLUMN sell_rate REAL;
      `);

      // Backfill: buy_rate = market - delta, sell_rate = market + delta
      db.exec(`
        UPDATE exchange_rates SET
          buy_rate = market_rate - delta,
          sell_rate = market_rate + delta;
      `);

      // Make NOT NULL now that data is backfilled
      // SQLite doesn't support ALTER COLUMN, so we recreate the table
      db.exec(`
        CREATE TABLE exchange_rates_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          to_code     TEXT    NOT NULL UNIQUE,
          market_rate REAL    NOT NULL,
          buy_rate    REAL    NOT NULL,
          sell_rate   REAL    NOT NULL,
          is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
          updated_at  TEXT    DEFAULT (datetime('now'))
        );

        INSERT INTO exchange_rates_new (id, to_code, market_rate, buy_rate, sell_rate, is_stronger, updated_at)
        SELECT id, to_code, market_rate, buy_rate, sell_rate, is_stronger, updated_at
        FROM exchange_rates;

        DROP TABLE exchange_rates;
        ALTER TABLE exchange_rates_new RENAME TO exchange_rates;
      `);

      console.log(
        "Migration v59: Replaced delta with buy_rate/sell_rate in exchange_rates",
      );
    },
    down(db) {
      // Recreate with delta column
      db.exec(`
        CREATE TABLE exchange_rates_old (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          to_code     TEXT    NOT NULL UNIQUE,
          market_rate REAL    NOT NULL,
          delta       REAL    NOT NULL DEFAULT 0,
          is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
          updated_at  TEXT    DEFAULT (datetime('now'))
        );

        INSERT INTO exchange_rates_old (id, to_code, market_rate, delta, is_stronger, updated_at)
        SELECT id, to_code, (sell_rate - buy_rate) / 2.0, is_stronger, updated_at
        FROM exchange_rates;

        DROP TABLE exchange_rates;
        ALTER TABLE exchange_rates_old RENAME TO exchange_rates;
      `);

      console.log("Migration v59 rolled back: restored delta column");
    },
  },
  {
    version: 60,
    name: "add_client_name_phone_to_transactions",
    description:
      "Add client_name and client_phone columns to transactions so session-only customers (not saved in clients table) are tracked for profits-by-client reporting",
    type: "typescript",
    up(db) {
      // Check if columns already exist (may have been added in a prior dev run)
      const cols = db.prepare("PRAGMA table_info(transactions)").all() as {
        name: string;
      }[];
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has("client_name")) {
        db.exec(`ALTER TABLE transactions ADD COLUMN client_name TEXT;`);
      }
      if (!colNames.has("client_phone")) {
        db.exec(`ALTER TABLE transactions ADD COLUMN client_phone TEXT;`);
      }

      // Backfill from existing clients table where client_id is set
      db.exec(`
        UPDATE transactions
        SET client_name = (SELECT c.full_name FROM clients c WHERE c.id = transactions.client_id),
            client_phone = (SELECT c.phone_number FROM clients c WHERE c.id = transactions.client_id)
        WHERE client_id IS NOT NULL;
      `);

      console.log(
        "Migration v60: Added client_name and client_phone to transactions",
      );
    },
    down(db) {
      // SQLite doesn't support DROP COLUMN before 3.35.0, but we can leave them
      // as they are nullable and harmless
      db.exec(`
        UPDATE transactions SET client_name = NULL, client_phone = NULL;
      `);

      console.log(
        "Migration v60 rolled back: cleared client_name and client_phone",
      );
    },
  },
  {
    version: 61,
    name: "add_checkout_columns_to_customer_sessions",
    description:
      "Add checkout_at, checkout_total, checkout_currency columns to customer_sessions for batch checkout (LIRA-014)",
    type: "typescript",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(customer_sessions)").all() as {
        name: string;
      }[];
      const colNames = new Set(cols.map((c) => c.name));

      if (!colNames.has("checkout_at")) {
        db.exec(`ALTER TABLE customer_sessions ADD COLUMN checkout_at TEXT;`);
      }
      if (!colNames.has("checkout_total")) {
        db.exec(
          `ALTER TABLE customer_sessions ADD COLUMN checkout_total REAL;`,
        );
      }
      if (!colNames.has("checkout_currency")) {
        db.exec(
          `ALTER TABLE customer_sessions ADD COLUMN checkout_currency TEXT DEFAULT 'USD';`,
        );
      }

      console.log("Migration v61: Added checkout columns to customer_sessions");
    },
    down(db) {
      db.exec(`
        UPDATE customer_sessions
        SET checkout_at = NULL, checkout_total = NULL, checkout_currency = 'USD';
      `);
      console.log("Migration v61 rolled back: cleared checkout columns");
    },
  },
  {
    version: 62,
    name: "add_session_cart_items",
    description:
      "Add session_cart_items table for persisting cart items tied to a customer session",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_cart_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          item_id TEXT NOT NULL,
          module TEXT NOT NULL,
          label TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'USD',
          form_data TEXT NOT NULL DEFAULT '{}',
          ipc_channel TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_session_cart_items_session ON session_cart_items(session_id);
      `);

      console.log("Migration v62: Added session_cart_items table");
    },
    down(db) {
      db.exec(`DROP TABLE IF EXISTS session_cart_items;`);
      console.log("Migration v62 rolled back: dropped session_cart_items");
    },
  },
  {
    version: 63,
    name: "add_user_id_to_sessions_and_cart",
    description:
      "Add user_id column to customer_sessions and session_cart_items for multi-PC user tracking",
    type: "typescript",
    up(db) {
      // Check if columns already exist (create_db.sql may have created them)
      const sessionCols = db.pragma("table_info(customer_sessions)") as {
        name: string;
      }[];
      const cartCols = db.pragma("table_info(session_cart_items)") as {
        name: string;
      }[];

      const sessionHasUserId = sessionCols.some((c) => c.name === "user_id");
      const cartHasUserId = cartCols.some((c) => c.name === "user_id");

      if (!sessionHasUserId) {
        db.exec(
          `ALTER TABLE customer_sessions ADD COLUMN user_id INTEGER REFERENCES users(id);`,
        );
      }
      if (!cartHasUserId) {
        db.exec(
          `ALTER TABLE session_cart_items ADD COLUMN user_id INTEGER REFERENCES users(id);`,
        );
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_customer_sessions_user ON customer_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_session_cart_items_user ON session_cart_items(user_id);
      `);
      console.log(
        "Migration v63: Added user_id to customer_sessions and session_cart_items",
      );
    },
    down(db) {
      // SQLite doesn't support DROP COLUMN before 3.35.0, so recreate tables
      // For simplicity, just drop the indexes
      db.exec(`
        DROP INDEX IF EXISTS idx_customer_sessions_user;
        DROP INDEX IF EXISTS idx_session_cart_items_user;
      `);
      console.log("Migration v63 rolled back: dropped user_id indexes");
    },
  },
  {
    version: 64,
    name: "add_customer_sessions_module",
    description: "Add customer_sessions module to modules table",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.prepare(
        `
        INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
        VALUES ('customer_sessions', 'Sessions', 'UserCheck', '/customer-sessions', 14, 1, 0, 0)
      `,
      ).run();
      console.log("Migration v64: Added customer_sessions module");
    },
    down(db: Database.Database) {
      db.prepare(`DELETE FROM modules WHERE key = 'customer_sessions'`).run();
      console.log(
        "Migration v64 rolled back: removed customer_sessions module",
      );
    },
  },
  {
    version: 65,
    name: "session_checkout_currency_split_and_profit",
    description:
      "Split checkout_total into USD/LBP and add profit columns to customer_sessions",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db.pragma("table_info(customer_sessions)") as {
        name: string;
      }[];
      const colNames = new Set(cols.map((c) => c.name));

      const toAdd = [
        { col: "checkout_total_usd", def: "REAL NOT NULL DEFAULT 0" },
        { col: "checkout_total_lbp", def: "REAL NOT NULL DEFAULT 0" },
        { col: "checkout_profit_usd", def: "REAL NOT NULL DEFAULT 0" },
        { col: "checkout_profit_lbp", def: "REAL NOT NULL DEFAULT 0" },
      ];
      for (const { col, def } of toAdd) {
        if (!colNames.has(col)) {
          db.exec(`ALTER TABLE customer_sessions ADD COLUMN ${col} ${def};`);
        }
      }
      // Back-fill existing rows from the old checkout_total + checkout_currency
      db.exec(`
        UPDATE customer_sessions
        SET checkout_total_usd = CASE WHEN checkout_currency != 'LBP' THEN COALESCE(checkout_total, 0) ELSE 0 END,
            checkout_total_lbp = CASE WHEN checkout_currency  = 'LBP' THEN COALESCE(checkout_total, 0) ELSE 0 END
        WHERE checkout_total IS NOT NULL;
      `);
      console.log(
        "Migration v65: Added split checkout totals and profit columns",
      );
    },
    down(db: Database.Database) {
      // SQLite < 3.35 can't DROP COLUMN; just leave the columns
      console.log("Migration v65 rolled back (columns remain)");
    },
  },
  {
    version: 66,
    name: "add_drawer_topups_table",
    description:
      "Create drawer_topups table for tracking cash top-ups to drawers",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS drawer_topups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          amount_usd REAL DEFAULT 0,
          amount_lbp REAL DEFAULT 0,
          notes TEXT,
          created_by INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("Migration v66: Created drawer_topups table");
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS drawer_topups`);
      console.log("Migration v66 rolled back: dropped drawer_topups table");
    },
  },
  {
    version: 67,
    name: "add_source_drawer_to_drawer_topups",
    description:
      "Add source_drawer column to drawer_topups for drawer-to-drawer transfers",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        ALTER TABLE drawer_topups ADD COLUMN source_drawer TEXT DEFAULT NULL
      `);
      console.log("Migration v67: Added source_drawer column to drawer_topups");
    },
    down(db: Database.Database) {
      // SQLite doesn't support DROP COLUMN before 3.35.0, rebuild table
      db.exec(`
        CREATE TABLE drawer_topups_backup AS SELECT id, amount_usd, amount_lbp, notes, created_by, created_at, updated_at FROM drawer_topups;
        DROP TABLE drawer_topups;
        CREATE TABLE drawer_topups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          amount_usd REAL DEFAULT 0,
          amount_lbp REAL DEFAULT 0,
          notes TEXT,
          created_by INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO drawer_topups SELECT * FROM drawer_topups_backup;
        DROP TABLE drawer_topups_backup;
      `);
      console.log(
        "Migration v67 rolled back: removed source_drawer from drawer_topups",
      );
    },
  },
  {
    version: 68,
    name: "add_is_refunded_to_source_tables",
    description:
      "Add is_refunded and refunded_at columns to all module source tables for refund/void propagation",
    type: "typescript" as const,
    up(db: Database.Database) {
      const tables = [
        "recharges",
        "financial_services",
        "exchange_transactions",
        "custom_services",
        "maintenance",
        "expenses",
        "loto_tickets",
        "debt_ledger",
      ];
      for (const table of tables) {
        db.exec(`
          ALTER TABLE ${table} ADD COLUMN is_refunded INTEGER DEFAULT 0;
        `);
        db.exec(`
          ALTER TABLE ${table} ADD COLUMN refunded_at TEXT DEFAULT NULL;
        `);
      }
      console.log(
        "Migration v68: Added is_refunded + refunded_at to all source tables",
      );
    },
    down(db: Database.Database) {
      // SQLite < 3.35 can't DROP COLUMN; leave columns in place
      console.log("Migration v68 rolled back (columns remain)");
    },
  },
  {
    version: 69,
    name: "add_edited_by_edited_at_to_source_tables",
    description:
      "Add edited_by and edited_at columns to all module source tables for metadata editing support",
    type: "typescript" as const,
    up(db: Database.Database) {
      const tables = [
        "sales",
        "recharges",
        "financial_services",
        "exchange_transactions",
        "custom_services",
        "maintenance",
        "expenses",
        "loto_tickets",
        "debt_ledger",
      ];
      for (const table of tables) {
        db.exec(`
          ALTER TABLE ${table} ADD COLUMN edited_by TEXT DEFAULT NULL;
        `);
        db.exec(`
          ALTER TABLE ${table} ADD COLUMN edited_at TEXT DEFAULT NULL;
        `);
      }
      console.log(
        "Migration v69: Added edited_by + edited_at to all source tables",
      );
    },
    down(_db: Database.Database) {
      // SQLite < 3.35 can't DROP COLUMN; leave columns in place
      console.log("Migration v69 rolled back (columns remain)");
    },
  },
  {
    version: 70,
    name: "add_note_to_expenses",
    description:
      "Add note column to expenses table for metadata editing support",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`ALTER TABLE expenses ADD COLUMN note TEXT DEFAULT NULL;`);
      console.log("Migration v70: Added note column to expenses table");
    },
    down(_db: Database.Database) {
      console.log("Migration v70 rolled back (column remains)");
    },
  },
  {
    version: 71,
    name: "add_profit_columns_to_transactions_and_session_transactions",
    description:
      "Add profit_usd and profit_lbp columns to transactions and customer_session_transactions tables " +
      "so that profit is tracked per-transaction at the point of creation.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // 1. Add profit columns to unified transactions ledger
      db.exec(`
        ALTER TABLE transactions ADD COLUMN profit_usd REAL NOT NULL DEFAULT 0;
        ALTER TABLE transactions ADD COLUMN profit_lbp REAL NOT NULL DEFAULT 0;
      `);

      // 2. Add profit columns to customer_session_transactions
      db.exec(`
        ALTER TABLE customer_session_transactions ADD COLUMN profit_usd REAL NOT NULL DEFAULT 0;
        ALTER TABLE customer_session_transactions ADD COLUMN profit_lbp REAL NOT NULL DEFAULT 0;
      `);

      // 3. Backfill exchange transactions profit into unified ledger
      db.exec(`
        UPDATE transactions
        SET profit_usd = COALESCE((
          SELECT COALESCE(et.leg1_profit_usd, 0) + COALESCE(et.leg2_profit_usd, 0)
          FROM exchange_transactions et
          WHERE et.id = transactions.source_id
        ), 0)
        WHERE source_table = 'exchange_transactions';
      `);

      // 4. Backfill customer_session_transactions profit from exchange_transactions
      db.exec(`
        UPDATE customer_session_transactions
        SET profit_usd = COALESCE((
          SELECT COALESCE(et.leg1_profit_usd, 0) + COALESCE(et.leg2_profit_usd, 0)
          FROM exchange_transactions et
          WHERE et.id = customer_session_transactions.transaction_id
        ), 0)
        WHERE transaction_type = 'exchange';
      `);

      // 5. Backfill sale profits into unified ledger
      db.exec(`
        UPDATE transactions
        SET profit_usd = COALESCE((
          SELECT SUM((si.sold_price_usd - si.cost_price_snapshot_usd) * si.quantity)
          FROM sale_items si
          WHERE si.sale_id = transactions.source_id AND si.is_refunded = 0
        ), 0)
        WHERE source_table = 'sales';
      `);

      // 6. Backfill financial_services commissions into unified ledger
      db.exec(`
        UPDATE transactions
        SET profit_usd = COALESCE((
          SELECT CASE WHEN fs.currency = 'USD' THEN fs.commission ELSE 0 END
          FROM financial_services fs WHERE fs.id = transactions.source_id
        ), 0),
        profit_lbp = COALESCE((
          SELECT CASE WHEN fs.currency = 'LBP' THEN fs.commission ELSE 0 END
          FROM financial_services fs WHERE fs.id = transactions.source_id
        ), 0)
        WHERE source_table = 'financial_services';
      `);

      // 7. Backfill recharge commissions into unified ledger
      db.exec(`
        UPDATE transactions
        SET profit_lbp = COALESCE((
          SELECT CASE WHEN r.currency_code = 'LBP' THEN (r.price - r.cost) ELSE 0 END
          FROM recharges r WHERE r.id = transactions.source_id
        ), 0),
        profit_usd = COALESCE((
          SELECT CASE WHEN r.currency_code != 'LBP' THEN (r.price - r.cost) ELSE 0 END
          FROM recharges r WHERE r.id = transactions.source_id
        ), 0)
        WHERE source_table = 'recharges';
      `);

      console.log(
        "Migration v71: Added profit_usd/profit_lbp to transactions and customer_session_transactions with backfill",
      );
    },
    down(db: Database.Database) {
      // SQLite doesn't support DROP COLUMN before 3.35, so just leave columns
      console.log("Migration v71 rolled back (columns remain)");
    },
  },
  {
    version: 72,
    name: "add_default_price_to_client_to_recharges",
    description:
      "Add default_price_to_client column to recharges for margin alert / theft detection",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db.prepare("PRAGMA table_info(recharges)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "default_price_to_client")) {
        db.exec(
          "ALTER TABLE recharges ADD COLUMN default_price_to_client REAL DEFAULT NULL;",
        );
      }
      console.log("Migration v72: Added default_price_to_client to recharges");
    },
    down(_db: Database.Database) {
      console.log("Migration v72 rolled back (column remains)");
    },
  },
  {
    version: 73,
    name: "add_category_to_custom_services",
    description:
      "Add category column to custom_services for tagging services (e.g. Digital Account, Repair)",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db.prepare("PRAGMA table_info(custom_services)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "category")) {
        db.exec(
          "ALTER TABLE custom_services ADD COLUMN category TEXT DEFAULT NULL;",
        );
      }
      console.log("Migration v73: Added category column to custom_services");
    },
    down(_db: Database.Database) {
      console.log("Migration v73 rolled back (column remains)");
    },
  },
  {
    version: 74,
    name: "create_service_presets_table",
    description:
      "Create service_presets table for reusable service templates (digital accounts, repairs, etc.)",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_presets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'digital_account',
          cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
          cost_lbp DECIMAL(15,2) NOT NULL DEFAULT 0,
          price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
          price_lbp DECIMAL(15,2) NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_service_presets_category ON service_presets(category);
        CREATE INDEX IF NOT EXISTS idx_service_presets_active ON service_presets(is_active, sort_order);
      `);
      console.log("Migration v74: Created service_presets table");
    },
    down(db: Database.Database) {
      db.exec("DROP TABLE IF EXISTS service_presets;");
      console.log("Migration v74 rolled back: Dropped service_presets table");
    },
  },
  {
    version: 75,
    name: "seed_customer_account_payment_method",
    description:
      "Seed CUSTOMER_ACCOUNT payment method for customer credit system (shop owes customer)",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        INSERT OR IGNORE INTO payment_methods (code, label, drawer_name, affects_drawer, sort_order, is_system, is_active)
        VALUES ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 5, 1, 1);
      `);
      console.log("Migration v75: Seeded CUSTOMER_ACCOUNT payment method");
    },
    down(db: Database.Database) {
      db.exec(`DELETE FROM payment_methods WHERE code = 'CUSTOMER_ACCOUNT';`);
      console.log("Migration v75 rolled back: Removed CUSTOMER_ACCOUNT");
    },
  },
  {
    version: 76,
    name: "rename_debt_to_customer_account",
    description:
      "Rename DEBT payment method label to 'Customer Account' and deactivate separate CUSTOMER_ACCOUNT entry",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Rename DEBT label
      db.exec(
        `UPDATE payment_methods SET label = 'Customer Account' WHERE code = 'DEBT';`,
      );
      // Deactivate the separate CUSTOMER_ACCOUNT entry (DEBT now serves this purpose)
      db.exec(
        `UPDATE payment_methods SET is_active = 0 WHERE code = 'CUSTOMER_ACCOUNT';`,
      );
      console.log(
        "Migration v76: Renamed DEBT to 'Customer Account', deactivated CUSTOMER_ACCOUNT",
      );
    },
    down(db: Database.Database) {
      db.exec(`UPDATE payment_methods SET label = 'Debt' WHERE code = 'DEBT';`);
      db.exec(
        `UPDATE payment_methods SET is_active = 1 WHERE code = 'CUSTOMER_ACCOUNT';`,
      );
      console.log("Migration v76 rolled back");
    },
  },
  {
    version: 77,
    name: "create_partners_system",
    description:
      "Create partners and partner_ledger tables, add partner_id to financial_services",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS partners (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          phone TEXT,
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS partner_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          partner_id INTEGER NOT NULL REFERENCES partners(id),
          transaction_type TEXT NOT NULL CHECK(transaction_type IN ('OMT_SEND', 'OMT_RECEIVE', 'WHISH_SEND', 'WHISH_RECEIVE', 'CUSTOM_SERVICE', 'SETTLEMENT', 'ADJUSTMENT')),
          reference_table TEXT,
          reference_id INTEGER,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'USD',
          direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
          notes TEXT,
          user_id INTEGER REFERENCES users(id),
          settlement_method TEXT CHECK(settlement_method IN ('CASH', 'OMT', 'WHISH', 'BINANCE', 'CLIENT_ACCOUNT')),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_partner_ledger_partner_id ON partner_ledger(partner_id);
        CREATE INDEX IF NOT EXISTS idx_partner_ledger_created_at ON partner_ledger(created_at);
      `);

      // Add partner_id to financial_services
      const columns = db.pragma("table_info(financial_services)") as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === "partner_id")) {
        db.exec(
          `ALTER TABLE financial_services ADD COLUMN partner_id INTEGER REFERENCES partners(id);`,
        );
      }

      console.log("Migration v77: Created partners system tables");
    },
    down(db: Database.Database) {
      db.exec(`
        ALTER TABLE financial_services DROP COLUMN partner_id;
        DROP TABLE IF EXISTS partner_ledger;
        DROP TABLE IF EXISTS partners;
      `);
      console.log("Migration v77 rolled back");
    },
  },
  {
    version: 78,
    name: "deactivate_whish_supplier",
    description:
      "LIRA-045: OMT-base shops don't own Whish System — partner ledger replaces supplier ledger",
    type: "typescript" as const,
    up(db: Database.Database) {
      // LIRA-045: OMT-base shops don't own Whish System — partner ledger replaces supplier ledger
      db.prepare(
        `UPDATE suppliers SET is_active = 0 WHERE provider = 'WHISH'`,
      ).run();
      console.log("Migration v78: Deactivated WHISH supplier");
    },
    down(db: Database.Database) {
      db.prepare(
        `UPDATE suppliers SET is_active = 1 WHERE provider = 'WHISH'`,
      ).run();
      console.log("Migration v78 rolled back");
    },
  },
  {
    version: 79,
    name: "add_partner_system_association",
    description:
      "LIRA-045: Partners can be associated with a system (e.g. WHISH) to access that system's transactions",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db.prepare("PRAGMA table_info(partners)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "system_association")) {
        db.exec(
          `ALTER TABLE partners ADD COLUMN system_association TEXT DEFAULT NULL`,
        );
      }
      console.log("Migration v79: Added system_association column to partners");
    },
    down(db: Database.Database) {
      db.exec(`ALTER TABLE partners DROP COLUMN system_association`);
      console.log("Migration v79 rolled back");
    },
  },
  {
    version: 80,
    name: "add_shop_base_system_setting",
    description:
      "LIRA-046: Add shop_base_system setting (OMT or WHISH) — defaults to OMT for existing shops",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        INSERT OR IGNORE INTO system_settings (key_name, value)
        VALUES ('shop_base_system', 'OMT');
      `);
      console.log(
        "Migration v80: Added shop_base_system setting (default OMT)",
      );
    },
    down(db: Database.Database) {
      db.exec(
        `DELETE FROM system_settings WHERE key_name = 'shop_base_system';`,
      );
      console.log("Migration v80 rolled back");
    },
  },
  {
    version: 81,
    name: "add_expenses_created_at_updated_at",
    description:
      "Add missing created_at and updated_at columns to expenses table",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Check if columns already exist (idempotent)
      const cols = db.prepare("PRAGMA table_info(expenses)").all() as {
        name: string;
      }[];
      const colNames = cols.map((c) => c.name);
      // SQLite rejects ADD COLUMN with a non-constant default ("Cannot add a
      // column with non-constant default") — add defaultless, then backfill.
      // ExpenseRepository stamps created_at explicitly on INSERT either way.
      if (!colNames.includes("created_at")) {
        db.exec(`ALTER TABLE expenses ADD COLUMN created_at DATETIME;`);
        db.exec(`UPDATE expenses SET created_at = CURRENT_TIMESTAMP;`);
      }
      if (!colNames.includes("updated_at")) {
        db.exec(`ALTER TABLE expenses ADD COLUMN updated_at DATETIME;`);
        db.exec(
          `UPDATE expenses SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP);`,
        );
      }
      console.log("Migration v81: Added created_at/updated_at to expenses");
    },
    down(db: Database.Database) {
      // SQLite doesn't support DROP COLUMN before 3.35 — no-op
      console.log("Migration v81 rolled back (no-op for SQLite)");
    },
  },
  {
    version: 82,
    name: "add_partners_and_audit_modules",
    description:
      "Add partners (toggleable) and audit (system) modules to the modules table",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Partners: toggleable module like debts
      db.prepare(
        `INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
         VALUES ('partners', 'Partners', 'Handshake', '/partners', 15, 1, 0, 0)`,
      ).run();

      // Audit & Transactions: system module, admin only, always visible
      db.prepare(
        `INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
         VALUES ('audit', 'Audit & Transactions', 'Shield', '/audit', 97, 1, 1, 1)`,
      ).run();

      console.log("Migration v82: Added partners and audit modules");
    },
    down(db: Database.Database) {
      db.prepare(
        `DELETE FROM modules WHERE key IN ('partners', 'audit')`,
      ).run();
      console.log("Migration v82 rolled back");
    },
  },
  {
    version: 83,
    name: "add_partner_mode_and_transaction_types",
    description:
      "Add partner_mode to financial_services and new FOR_ and THROUGH_ transaction types to partner_ledger",
    type: "typescript" as const,
    up(db: Database.Database) {
      // 1. Add partner_mode to financial_services if it doesn't exist
      const fsCols = db
        .prepare("PRAGMA table_info(financial_services)")
        .all() as { name: string }[];
      if (!fsCols.some((c) => c.name === "partner_mode")) {
        db.exec(
          `ALTER TABLE financial_services ADD COLUMN partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))`,
        );
        // Backfill existing partner transactions
        db.exec(
          `UPDATE financial_services SET partner_mode = 'THROUGH' WHERE partner_id IS NOT NULL`,
        );
      }

      // 2. Rebuild partner_ledger to update the transaction_type CHECK constraint
      db.exec(`
        CREATE TABLE IF NOT EXISTS partner_ledger_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            partner_id INTEGER NOT NULL REFERENCES partners(id),
            transaction_type TEXT NOT NULL CHECK(transaction_type IN ('OMT_SEND', 'OMT_RECEIVE', 'WHISH_SEND', 'WHISH_RECEIVE', 'THROUGH_OMT_SEND', 'THROUGH_OMT_RECEIVE', 'THROUGH_WHISH_SEND', 'THROUGH_WHISH_RECEIVE', 'FOR_OMT_SEND', 'FOR_OMT_RECEIVE', 'FOR_WHISH_SEND', 'FOR_WHISH_RECEIVE', 'CUSTOM_SERVICE', 'SETTLEMENT', 'ADJUSTMENT')),
            reference_table TEXT,
            reference_id INTEGER,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
            notes TEXT,
            user_id INTEGER REFERENCES users(id),
            settlement_method TEXT CHECK(settlement_method IN ('CASH', 'OMT', 'WHISH', 'BINANCE', 'CLIENT_ACCOUNT')),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);

      db.exec(`
        INSERT INTO partner_ledger_new (id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at)
        SELECT id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at
        FROM partner_ledger;
      `);

      db.exec(`DROP TABLE partner_ledger;`);
      db.exec(`ALTER TABLE partner_ledger_new RENAME TO partner_ledger;`);

      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_partner_ledger_partner_id ON partner_ledger(partner_id);`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_partner_ledger_created_at ON partner_ledger(created_at);`,
      );
    },
    down(db: Database.Database) {
      console.log("Migration v83 rolled back (no-op for SQLite)");
    },
  },
  {
    version: 84,
    name: "add_suppliers_module",
    description: "Register suppliers as a standalone sidebar module",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        INSERT INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
        VALUES ('suppliers', 'Suppliers', 'Truck', '/suppliers', 17, 1, 0, 0)
        ON CONFLICT(key) DO UPDATE SET
          icon = 'Truck',
          route = '/suppliers',
          admin_only = 0,
          is_enabled = 1
      `);
      console.log("Migration v84: Suppliers module registered");
    },
    down(db: Database.Database) {
      db.exec(`DELETE FROM modules WHERE key = 'suppliers'`);
    },
  },
  {
    version: 85,
    name: "heal_expenses_note_column",
    description:
      "Heal expenses.note column for fresh installs done after v70 shipped — create_db.sql was missing the column while marking v70 as applied, so v70's ALTER TABLE never ran on those DBs.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db.prepare("PRAGMA table_info(expenses)").all() as {
        name: string;
      }[];
      const colNames = cols.map((c) => c.name);
      if (!colNames.includes("note")) {
        db.exec(`ALTER TABLE expenses ADD COLUMN note TEXT DEFAULT NULL;`);
        console.log("Migration v85: Added note column to expenses table");
      } else {
        console.log("Migration v85: note column already exists, skipping");
      }
    },
    down(_db: Database.Database) {
      console.log("Migration v85 rolled back (no-op for SQLite)");
    },
  },
  {
    version: 86,
    name: "consolidate_customer_account_code",
    description:
      "Consolidate DEBT and CUSTOMER_ACCOUNT payment method codes into a single CUSTOMER_ACCOUNT code",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Remove the inactive duplicate first (code is UNIQUE)
      db.exec(`DELETE FROM payment_methods WHERE code = 'CUSTOMER_ACCOUNT'`);
      // Rename the active DEBT entry
      db.exec(`
        UPDATE payment_methods
        SET code = 'CUSTOMER_ACCOUNT', label = 'Customer Account', is_system = 1
        WHERE code = 'DEBT'
      `);
      // Migrate stored method codes in all tables
      db.exec(
        `UPDATE payments SET method = 'CUSTOMER_ACCOUNT' WHERE method = 'DEBT'`,
      );
      db.exec(
        `UPDATE financial_services SET paid_by = 'CUSTOMER_ACCOUNT' WHERE paid_by = 'DEBT'`,
      );
      db.exec(
        `UPDATE recharges SET paid_by = 'CUSTOMER_ACCOUNT' WHERE paid_by = 'DEBT'`,
      );
      db.exec(
        `UPDATE maintenance SET paid_by = 'CUSTOMER_ACCOUNT' WHERE paid_by = 'DEBT'`,
      );
      db.exec(
        `UPDATE custom_services SET paid_by = 'CUSTOMER_ACCOUNT' WHERE paid_by = 'DEBT'`,
      );
      db.exec(
        `UPDATE expenses SET paid_by_method = 'CUSTOMER_ACCOUNT' WHERE paid_by_method = 'DEBT'`,
      );
      console.log("Migration v86: DEBT renamed to CUSTOMER_ACCOUNT");
    },
    down(db: Database.Database) {
      db.exec(`
        UPDATE payment_methods
        SET code = 'DEBT', label = 'Customer Account', is_system = 0
        WHERE code = 'CUSTOMER_ACCOUNT'
      `);
      db.exec(
        `UPDATE payments SET method = 'DEBT' WHERE method = 'CUSTOMER_ACCOUNT'`,
      );
      db.exec(
        `UPDATE financial_services SET paid_by = 'DEBT' WHERE paid_by = 'CUSTOMER_ACCOUNT'`,
      );
      db.exec(
        `UPDATE recharges SET paid_by = 'DEBT' WHERE paid_by = 'CUSTOMER_ACCOUNT'`,
      );
      db.exec(
        `UPDATE maintenance SET paid_by = 'DEBT' WHERE paid_by = 'CUSTOMER_ACCOUNT'`,
      );
      db.exec(
        `UPDATE custom_services SET paid_by = 'DEBT' WHERE paid_by = 'CUSTOMER_ACCOUNT'`,
      );
      db.exec(
        `UPDATE expenses SET paid_by_method = 'DEBT' WHERE paid_by_method = 'CUSTOMER_ACCOUNT'`,
      );
    },
  },
  {
    version: 87,
    name: "add_paid_amount_currency_to_financial_services",
    description:
      "Track what the customer actually paid (amount + currency) alongside the service-denominated amount/currency. Needed for CUSTOMER_ACCOUNT payments where the payment currency may differ from the transaction currency.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db
        .prepare("PRAGMA table_info(financial_services)")
        .all() as { name: string }[];
      const names = cols.map((c) => c.name);
      if (!names.includes("paid_amount")) {
        db.exec(
          `ALTER TABLE financial_services ADD COLUMN paid_amount REAL DEFAULT NULL`,
        );
      }
      if (!names.includes("paid_currency")) {
        db.exec(
          `ALTER TABLE financial_services ADD COLUMN paid_currency TEXT DEFAULT NULL`,
        );
      }
      console.log(
        "Migration v87: financial_services now tracks paid_amount + paid_currency",
      );
    },
    down(_db: Database.Database) {
      // SQLite doesn't support DROP COLUMN until 3.35 — leave the columns in place.
      console.log("Migration v87 rolled back (no-op on legacy SQLite)");
    },
  },
  {
    version: 88,
    name: "fix_katsh_supplier_provider_name",
    description:
      "Correct the Katsh supplier provider field from 'KATCH' to 'Katsh' so it matches the provider value sent by the frontend and used in FinancialServiceRepository lookups.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Fix supplier provider name
      db.prepare(
        `UPDATE suppliers SET provider = 'Katsh' WHERE provider = 'KATCH'`,
      ).run();
      // Remove stale 'Katch' seed rows (real balance rows already use 'Katsh')
      db.prepare(
        `DELETE FROM drawer_balances WHERE drawer_name = 'Katch'`,
      ).run();
      db.prepare(
        `DELETE FROM currency_drawers WHERE drawer_name = 'Katch'`,
      ).run();
      // Ensure canonical 'Katsh' rows exist
      db.prepare(
        `INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'USD', 0)`,
      ).run();
      db.prepare(
        `INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'LBP', 0)`,
      ).run();
      db.prepare(
        `INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('USD', 'Katsh')`,
      ).run();
      db.prepare(
        `INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('LBP', 'Katsh')`,
      ).run();
      console.log(
        "Migration v88: stale 'Katch' drawer rows removed, supplier provider fixed",
      );
    },
    down(db: Database.Database) {
      db.prepare(
        `UPDATE suppliers SET provider = 'KATCH' WHERE provider = 'Katsh'`,
      ).run();
      console.log("Migration v88 rolled back");
    },
  },
  {
    version: 89,
    name: "add_vouchers_module",
    description:
      "Create vouchers (gift card) table, register vouchers module, add GIFT_CARD payment method (no drawer impact, like CUSTOMER_ACCOUNT)",
    type: "typescript" as const,
    up(db: Database.Database) {
      // 1. Vouchers table
      db.exec(`
        CREATE TABLE IF NOT EXISTS vouchers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          client_id INTEGER NOT NULL,
          client_name TEXT NOT NULL,
          client_phone TEXT,
          amount DECIMAL(10, 2) NOT NULL,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          expiry_date TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'expired', 'cancelled')),
          redeemed_at TEXT,
          redeemed_by INTEGER,
          redeemed_in_transaction TEXT,
          redeemed_transaction_id INTEGER,
          cancelled_at TEXT,
          cancelled_by INTEGER,
          note TEXT,
          created_by INTEGER NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
          FOREIGN KEY (redeemed_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code)`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vouchers_client_id ON vouchers(client_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_vouchers_created_at ON vouchers(created_at)`,
      );

      // 2. Register module (after custom_services at sort_order 12)
      db.prepare(
        `INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
         VALUES ('vouchers', 'Vouchers', 'Gift', '/vouchers', 18, 1, 0, 0)`,
      ).run();

      // 3. Currency support (USD only)
      db.prepare(
        `INSERT OR IGNORE INTO currency_modules (currency_code, module_key) VALUES ('USD', 'vouchers')`,
      ).run();

      // 4. GIFT_CARD payment method — no drawer impact, system method (like CUSTOMER_ACCOUNT)
      db.prepare(
        `INSERT OR IGNORE INTO payment_methods (code, label, drawer_name, affects_drawer, sort_order, is_system, is_active)
         VALUES ('GIFT_CARD', 'Gift Card / Voucher', 'General', 0, 5, 1, 1)`,
      ).run();

      console.log(
        "Migration v89: vouchers module + GIFT_CARD payment method added",
      );
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS vouchers`);
      db.prepare(`DELETE FROM modules WHERE key = 'vouchers'`).run();
      db.prepare(
        `DELETE FROM currency_modules WHERE module_key = 'vouchers'`,
      ).run();
      db.prepare(`DELETE FROM payment_methods WHERE code = 'GIFT_CARD'`).run();
      console.log("Migration v89 rolled back");
    },
  },
  {
    version: 90,
    name: "heal_unredeemed_gift_card_credit",
    description:
      "One-time data heal: a gift-card payment recorded the charge but never redeemed the voucher (deposited its value). Deposit the face value to the owner's account and mark the voucher redeemed. No-op on databases without the affected voucher.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // The vouchers table only exists from v89 onward; guard for safety.
      const hasVouchers = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='vouchers'`,
        )
        .get();
      if (!hasVouchers) return;

      // Heal any voucher that was charged-against but left pending. We can only
      // reliably identify the specific affected voucher by code on this install.
      const code = "GIFT-XR2U-SCUF";
      const voucher = db
        .prepare(
          `SELECT id, client_id, amount, created_by, status FROM vouchers WHERE code = ?`,
        )
        .get(code) as
        | {
            id: number;
            client_id: number;
            amount: number;
            created_by: number;
            status: string;
          }
        | undefined;

      if (!voucher || voucher.status !== "pending") return;

      // Deposit the full face value as customer-account credit (negative = credit).
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, created_at)
         VALUES (?, 'CREDIT_DEPOSIT', ?, 0, ?, ?, CURRENT_TIMESTAMP)`,
      ).run(
        voucher.client_id,
        -Math.abs(voucher.amount),
        `Voucher redeemed ${code}`,
        voucher.created_by,
      );

      // Mark the voucher redeemed.
      db.prepare(
        `UPDATE vouchers
         SET status = 'redeemed', redeemed_at = CURRENT_TIMESTAMP,
             redeemed_by = ?, redeemed_in_transaction = 'financial_service',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`,
      ).run(voucher.created_by, voucher.id);

      console.log(`Migration v90: healed gift-card credit for ${code}`);
    },
    down() {
      // Data heal — not reversible.
      console.log("Migration v90 rolled back (no-op)");
    },
  },
  {
    version: 91,
    name: "per_drawer_checkpoint_index",
    description:
      "Add index on daily_closings(drawer_name, id DESC) to support efficient per-drawer last-checkpoint queries",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_daily_closings_drawer_id
         ON daily_closings(drawer_name, id DESC)`,
      );
      console.log("Migration v91: per-drawer checkpoint index added");
    },
    down(db: Database.Database) {
      db.exec(`DROP INDEX IF EXISTS idx_daily_closings_drawer_id`);
      console.log("Migration v91 rolled back");
    },
  },
  {
    version: 92,
    name: "maintenance_lbp_pricing",
    description:
      "Add LBP cost/price/final-amount columns and a currency column to maintenance so repair jobs can be priced natively in USD or LBP",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db.prepare("PRAGMA table_info(maintenance)").all() as {
        name: string;
      }[];
      const has = (name: string) => cols.some((c) => c.name === name);

      if (!has("cost_lbp")) {
        db.exec(
          `ALTER TABLE maintenance ADD COLUMN cost_lbp DECIMAL(15, 2) DEFAULT 0;`,
        );
      }
      if (!has("price_lbp")) {
        db.exec(
          `ALTER TABLE maintenance ADD COLUMN price_lbp DECIMAL(15, 2) DEFAULT 0;`,
        );
      }
      if (!has("final_amount_lbp")) {
        db.exec(
          `ALTER TABLE maintenance ADD COLUMN final_amount_lbp DECIMAL(15, 2) DEFAULT 0;`,
        );
      }
      if (!has("currency")) {
        db.exec(
          `ALTER TABLE maintenance ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';`,
        );
      }
      console.log("Migration v92: maintenance LBP pricing columns added");
    },
    down(db: Database.Database) {
      // SQLite cannot easily drop columns; leave columns in place on rollback.
      console.log(
        "Migration v92 rolled back (columns retained — SQLite limitation)",
      );
    },
  },
  {
    version: 93,
    name: "binance_drawer_usdt_currency",
    description:
      "Switch the Binance drawer from USD to USDT. The Binance account holds crypto (USDT), so its drawer balance and currency_drawers mapping must track USDT, not USD. Merges any stray USDT balance created before the routing fix.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // 0. Ensure the USDT currency exists (FK target for currency_drawers).
      //    Fresh installs seed it via create_db.sql, but existing DBs upgrading
      //    from older versions may not have it yet.
      db.prepare(
        `INSERT OR IGNORE INTO currencies (code, name, symbol, decimal_places, is_active)
         VALUES ('USDT', 'Tether USD', 'USDT', 2, 0)`,
      ).run();

      // 1. drawer_balances: fold any existing 'USD' Binance balance into 'USDT'.
      //    The buggy SEND/RECEIVE path may already have created a ('Binance','USDT')
      //    row, so add the USD balance onto it rather than blindly renaming.
      db.prepare(
        `INSERT INTO drawer_balances (drawer_name, currency_code, balance)
         VALUES ('Binance', 'USDT', 0)
         ON CONFLICT(drawer_name, currency_code) DO NOTHING`,
      ).run();

      db.prepare(
        `UPDATE drawer_balances
            SET balance = balance + COALESCE(
                  (SELECT balance FROM drawer_balances
                    WHERE drawer_name = 'Binance' AND currency_code = 'USD'), 0),
                updated_at = CURRENT_TIMESTAMP
          WHERE drawer_name = 'Binance' AND currency_code = 'USDT'`,
      ).run();

      db.prepare(
        `DELETE FROM drawer_balances
          WHERE drawer_name = 'Binance' AND currency_code = 'USD'`,
      ).run();

      // 2. currency_drawers: map the Binance drawer to USDT instead of USD.
      db.prepare(
        `INSERT INTO currency_drawers (currency_code, drawer_name)
         VALUES ('USDT', 'Binance')
         ON CONFLICT(currency_code, drawer_name) DO NOTHING`,
      ).run();

      db.prepare(
        `DELETE FROM currency_drawers
          WHERE currency_code = 'USD' AND drawer_name = 'Binance'`,
      ).run();

      console.log("Migration v93: Binance drawer switched to USDT");
    },
    down(db: Database.Database) {
      // Reverse: fold USDT balance back into USD and restore the USD mapping.
      db.prepare(
        `INSERT INTO drawer_balances (drawer_name, currency_code, balance)
         VALUES ('Binance', 'USD', 0)
         ON CONFLICT(drawer_name, currency_code) DO NOTHING`,
      ).run();

      db.prepare(
        `UPDATE drawer_balances
            SET balance = balance + COALESCE(
                  (SELECT balance FROM drawer_balances
                    WHERE drawer_name = 'Binance' AND currency_code = 'USDT'), 0),
                updated_at = CURRENT_TIMESTAMP
          WHERE drawer_name = 'Binance' AND currency_code = 'USD'`,
      ).run();

      db.prepare(
        `DELETE FROM drawer_balances
          WHERE drawer_name = 'Binance' AND currency_code = 'USDT'`,
      ).run();

      db.prepare(
        `INSERT INTO currency_drawers (currency_code, drawer_name)
         VALUES ('USD', 'Binance')
         ON CONFLICT(currency_code, drawer_name) DO NOTHING`,
      ).run();

      db.prepare(
        `DELETE FROM currency_drawers
          WHERE currency_code = 'USDT' AND drawer_name = 'Binance'`,
      ).run();

      console.log("Migration v93 rolled back: Binance drawer reverted to USD");
    },
  },

  // ===========================================================================
  // v94 – Add client_id / client_name to loto_tickets (CUSTOMER_ACCOUNT support)
  // ===========================================================================
  {
    version: 94,
    name: "loto_tickets_add_client_fields",
    description:
      "Add client_id (FK → clients) and client_name columns to loto_tickets so CUSTOMER_ACCOUNT payment can be linked to a client record",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        ALTER TABLE loto_tickets ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
        ALTER TABLE loto_tickets ADD COLUMN client_name TEXT;
        CREATE INDEX IF NOT EXISTS idx_loto_tickets_client_id ON loto_tickets(client_id);
      `);
      console.log(
        "Migration v94: added client_id and client_name to loto_tickets",
      );
    },
    down(db: Database.Database) {
      // SQLite does not support DROP COLUMN before v3.35; recreate the table
      db.exec(`
        CREATE TABLE loto_tickets_v93 AS SELECT
          id, ticket_number, sale_amount, commission_rate, commission_amount,
          is_winner, prize_amount, prize_paid_date, sale_date, payment_method,
          currency, note, checkpoint_id, is_refunded, edited_by, edited_at,
          created_at, updated_at
        FROM loto_tickets;
        DROP TABLE loto_tickets;
        ALTER TABLE loto_tickets_v93 RENAME TO loto_tickets;
      `);
      console.log(
        "Migration v94 rolled back: removed client_id and client_name from loto_tickets",
      );
    },
  },
  {
    version: 96,
    name: "rename_supplier_katch_to_katsh",
    description:
      "Rename the 'Katch' supplier display name to 'Katsh' to match the canonical drawer name.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.prepare(
        `UPDATE suppliers SET name = 'Katsh' WHERE name = 'Katch'`,
      ).run();
      console.log("Migration v96: supplier name Katch → Katsh");
    },
    down(db: Database.Database) {
      db.prepare(
        `UPDATE suppliers SET name = 'Katch' WHERE name = 'Katsh' AND provider = 'Katsh'`,
      ).run();
      console.log("Migration v96 rolled back: supplier name Katsh → Katch");
    },
  },
  {
    version: 95,
    name: "usdt_currency_activate",
    description:
      "Activate the USDT currency (is_active=1) so the Binance drawer appears in the closing checkpoint and currency lists. USDT was previously seeded as inactive because it was only needed as a FK anchor; now that Binance is a live operational drawer it must be visible.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.prepare(
        `UPDATE currencies SET is_active = 1 WHERE code = 'USDT'`,
      ).run();
      console.log("Migration v95: USDT currency activated");
    },
    down(db: Database.Database) {
      db.prepare(
        `UPDATE currencies SET is_active = 0 WHERE code = 'USDT'`,
      ).run();
      console.log("Migration v95 rolled back: USDT currency deactivated");
    },
  },
  {
    version: 97,
    name: "widen_recharges_carrier_constraint",
    description:
      "Drop the restrictive CHECK(carrier IN ('MTC','Alfa')) on recharges. The recharges table is the unified top-up log for ALL providers — topUpApp (OMT_APP/WHISH_APP), topUpFromSupplier (Katsh/iPick), and the new Whish App partner/client top-ups all write carrier=provider, which the old constraint rejected with SQLITE_CONSTRAINT_CHECK. Recreates the table without the carrier CHECK, preserving all rows (and their ids, so unified-transaction source_id refs stay valid) and indexes.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // SQLite can't ALTER a CHECK constraint — recreate the table.
      db.exec(`
        CREATE TABLE recharges_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          carrier TEXT NOT NULL,
          recharge_type TEXT CHECK(recharge_type IN ('CREDIT_TRANSFER', 'VOUCHER', 'DAYS', 'TOP_UP')) NOT NULL DEFAULT 'CREDIT_TRANSFER',
          amount DECIMAL(10, 2) NOT NULL,
          cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
          price DECIMAL(10, 2) NOT NULL DEFAULT 0,
          default_price_to_client REAL DEFAULT NULL,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          paid_by TEXT DEFAULT 'CASH',
          phone_number TEXT,
          client_id INTEGER,
          client_name TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER DEFAULT 1,
          edited_by TEXT DEFAULT NULL,
          edited_at TEXT DEFAULT NULL,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );

        INSERT INTO recharges_new (
          id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        )
        SELECT
          id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        FROM recharges;

        DROP TABLE recharges;
        ALTER TABLE recharges_new RENAME TO recharges;

        CREATE INDEX IF NOT EXISTS idx_recharges_carrier ON recharges(carrier);
        CREATE INDEX IF NOT EXISTS idx_recharges_created_at ON recharges(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
        CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
      `);
      console.log(
        "Migration v97: removed MTC/Alfa-only CHECK on recharges.carrier",
      );
    },
    down(db: Database.Database) {
      // Restore the restrictive constraint. Will throw if non-MTC/Alfa rows
      // exist (expected — you can't roll back after recording other carriers).
      db.exec(`
        CREATE TABLE recharges_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          carrier TEXT CHECK(carrier IN ('MTC', 'Alfa')) NOT NULL,
          recharge_type TEXT CHECK(recharge_type IN ('CREDIT_TRANSFER', 'VOUCHER', 'DAYS', 'TOP_UP')) NOT NULL DEFAULT 'CREDIT_TRANSFER',
          amount DECIMAL(10, 2) NOT NULL,
          cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
          price DECIMAL(10, 2) NOT NULL DEFAULT 0,
          default_price_to_client REAL DEFAULT NULL,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          paid_by TEXT DEFAULT 'CASH',
          phone_number TEXT,
          client_id INTEGER,
          client_name TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER DEFAULT 1,
          edited_by TEXT DEFAULT NULL,
          edited_at TEXT DEFAULT NULL,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );

        INSERT INTO recharges_old (
          id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        )
        SELECT
          id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        FROM recharges;

        DROP TABLE recharges;
        ALTER TABLE recharges_old RENAME TO recharges;

        CREATE INDEX IF NOT EXISTS idx_recharges_carrier ON recharges(carrier);
        CREATE INDEX IF NOT EXISTS idx_recharges_created_at ON recharges(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
        CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
      `);
      console.log("Migration v97 rolled back: restored MTC/Alfa-only CHECK");
    },
  },
  {
    version: 98,
    name: "add_whish_topup_partner_ledger_type",
    description:
      "Add 'WHISH_TOPUP' to the partner_ledger.transaction_type CHECK so Whish App top-ups funded by a partner (LIRA-057) can be recorded. Recreates the table (SQLite can't ALTER a CHECK), preserving all rows + indexes — mirrors migration v83.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS partner_ledger_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            partner_id INTEGER NOT NULL REFERENCES partners(id),
            transaction_type TEXT NOT NULL CHECK(transaction_type IN ('OMT_SEND', 'OMT_RECEIVE', 'WHISH_SEND', 'WHISH_RECEIVE', 'THROUGH_OMT_SEND', 'THROUGH_OMT_RECEIVE', 'THROUGH_WHISH_SEND', 'THROUGH_WHISH_RECEIVE', 'FOR_OMT_SEND', 'FOR_OMT_RECEIVE', 'FOR_WHISH_SEND', 'FOR_WHISH_RECEIVE', 'WHISH_TOPUP', 'CUSTOM_SERVICE', 'SETTLEMENT', 'ADJUSTMENT')),
            reference_table TEXT,
            reference_id INTEGER,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
            notes TEXT,
            user_id INTEGER REFERENCES users(id),
            settlement_method TEXT CHECK(settlement_method IN ('CASH', 'OMT', 'WHISH', 'BINANCE', 'CLIENT_ACCOUNT')),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO partner_ledger_new (id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at)
        SELECT id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at
        FROM partner_ledger;

        DROP TABLE partner_ledger;
        ALTER TABLE partner_ledger_new RENAME TO partner_ledger;

        CREATE INDEX IF NOT EXISTS idx_partner_ledger_partner_id ON partner_ledger(partner_id);
        CREATE INDEX IF NOT EXISTS idx_partner_ledger_created_at ON partner_ledger(created_at);
      `);
      console.log(
        "Migration v98: added 'WHISH_TOPUP' to partner_ledger.transaction_type",
      );
    },
    down(db: Database.Database) {
      console.log("Migration v98 rolled back (no-op for SQLite)");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v99 — Add SALE_COST to supplier_ledger entry_type CHECK constraint (LIRA-061)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 99,
    name: "add_sale_cost_entry_type",
    description:
      "Add 'SALE_COST' to the supplier_ledger.entry_type CHECK so cost/price-flow SEND sales (Katsh / iPick / Whish App / OMT App) book a settleable sale-cost instead of a manual TOP_UP (LIRA-061). SQLite can't ALTER a CHECK, so the table is recreated preserving all rows + indexes — mirrors migration v56.",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE supplier_ledger_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE')),
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

        INSERT INTO supplier_ledger_new SELECT * FROM supplier_ledger;

        DROP TABLE supplier_ledger;

        ALTER TABLE supplier_ledger_new RENAME TO supplier_ledger;

        CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
      `);

      console.log(
        "Migration v99: Added SALE_COST to supplier_ledger entry_type",
      );
    },
    down(db) {
      // Relabel SALE_COST rows back to TOP_UP (their pre-LIRA-061 label, which keeps
      // the same balance sign), then recreate the table with the prior constraint.
      db.exec(`
        UPDATE supplier_ledger SET entry_type = 'TOP_UP' WHERE entry_type = 'SALE_COST';

        CREATE TABLE supplier_ledger_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE')),
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

        INSERT INTO supplier_ledger_old SELECT * FROM supplier_ledger;

        DROP TABLE supplier_ledger;

        ALTER TABLE supplier_ledger_old RENAME TO supplier_ledger;

        CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
      `);

      console.log(
        "Migration v99 rolled back: SALE_COST removed from supplier_ledger",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v100 — Add session_id to payments so a customer-session basket owns ONE payment
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 100,
    name: "add_session_id_to_payments",
    description:
      "Add a nullable session_id to payments so a customer-session 'basket' can own ONE customer-facing payment for its many transactions (basket payment). A payment row belongs to EITHER a transaction (transaction_id) OR a session basket (session_id), never both.",
    type: "typescript",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(payments)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "session_id")) {
        // NOTE: SQLite does NOT enforce an inline REFERENCES clause added via
        // ALTER TABLE ADD COLUMN — on upgraded DBs this column has no active FK,
        // so the ON DELETE SET NULL is a no-op here (fresh installs DO enforce it
        // via create_db.sql). To keep both paths identical, session deletion
        // nulls payments.session_id explicitly (CustomerSessionRepository
        // .deleteSession). The clause is kept for documentation / fresh-install parity.
        db.exec(
          "ALTER TABLE payments ADD COLUMN session_id INTEGER REFERENCES customer_sessions(id) ON DELETE SET NULL;",
        );
      }
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_payments_session_id ON payments(session_id);",
      );
      console.log("Migration v100: Added session_id to payments + index");
    },
    down(db) {
      // SQLite ADD COLUMN is treated one-way in this codebase (see v71/v72/v73);
      // just drop the index, leave the column.
      db.exec("DROP INDEX IF EXISTS idx_payments_session_id;");
      console.log("Migration v100 rolled back (session_id column remains)");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v101 — Backfill historical custom_services + maintenance profit into the
  //        unified transactions ledger (completes what v71 did for the other types)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 101,
    name: "backfill_custom_maintenance_profit_into_transactions",
    description:
      "Complete migration v71's per-transaction profit backfill for the two source types it skipped — custom_services and maintenance — so the Profits page can read profit uniformly from transactions.profit_usd/profit_lbp without losing historical profit.",
    type: "typescript",
    up(db) {
      // Backfill ONLY rows that are still unstamped (profit 0/NULL) AND whose
      // source row still exists. This avoids two failure modes of an
      // unconditional UPDATE: (a) clobbering a value correctly stamped at
      // create-time back to 0, and (b) fabricating 0 for a row whose source was
      // deleted. It is also safe to re-run.
      // custom_services.profit_usd/profit_lbp are generated (price - cost).
      db.exec(`
        UPDATE transactions
        SET profit_usd = COALESCE((
              SELECT cs.profit_usd FROM custom_services cs WHERE cs.id = transactions.source_id
            ), 0),
            profit_lbp = COALESCE((
              SELECT cs.profit_lbp FROM custom_services cs WHERE cs.id = transactions.source_id
            ), 0)
        WHERE source_table = 'custom_services'
          AND COALESCE(profit_usd, 0) = 0
          AND COALESCE(profit_lbp, 0) = 0
          AND EXISTS (SELECT 1 FROM custom_services cs WHERE cs.id = transactions.source_id);
      `);

      // maintenance profit lives in the job's currency (USD or LBP). Refunded
      // jobs earned nothing, so they are excluded (EXISTS guard) and left at 0.
      db.exec(`
        UPDATE transactions
        SET profit_usd = COALESCE((
              SELECT CASE WHEN m.currency = 'LBP' THEN 0
                          ELSE (m.final_amount_usd - m.cost_usd) END
              FROM maintenance m WHERE m.id = transactions.source_id
            ), 0),
            profit_lbp = COALESCE((
              SELECT CASE WHEN m.currency = 'LBP'
                          THEN (m.final_amount_lbp - m.cost_lbp) ELSE 0 END
              FROM maintenance m WHERE m.id = transactions.source_id
            ), 0)
        WHERE source_table = 'maintenance'
          AND COALESCE(profit_usd, 0) = 0
          AND COALESCE(profit_lbp, 0) = 0
          AND EXISTS (
            SELECT 1 FROM maintenance m
            WHERE m.id = transactions.source_id AND m.is_refunded = 0
          );
      `);

      console.log(
        "Migration v101: Backfilled custom_services + maintenance profit into transactions",
      );
    },
    down(_db) {
      // No-op: zeroing could clobber rows correctly stamped at create-time
      // (matches v71's non-destructive rollback convention).
      console.log("Migration v101 rolled back (no-op; profit values retained)");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v102 — Remove supplier-ledger pollution from the SECONDARY OMT/WHISH system
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 102,
    name: "remove_secondary_system_supplier_ledger_pollution",
    description:
      "Only the shop's primary (base) system owes its provider directly; the secondary OMT/WHISH system runs via a partner (tracked in partner_ledger). Auto-recorded SALE_COST/TOP_UP supplier_ledger entries for the non-base legacy provider wrongly inflated the suppliers/settlement page — remove ONLY those auto cost/top-up rows. Manual PAYMENT/SETTLEMENT/ADJUSTMENT entries represent real cash movements and are preserved.",
    type: "typescript",
    up(db) {
      const baseRow = db
        .prepare(
          "SELECT value FROM system_settings WHERE key_name = 'shop_base_system'",
        )
        .get() as { value?: string } | undefined;
      const base = baseRow?.value === "WHISH" ? "WHISH" : "OMT";
      const secondary = base === "WHISH" ? "OMT" : "WHISH";
      // Scope the purge to the auto-generated pollution types only. SALE_COST
      // (post-v99) and TOP_UP are the entry types the now-guarded secondary-system
      // auto-recorder used to write. Restricting by entry_type guarantees we never
      // delete a real cash entry (PAYMENT/SETTLEMENT/ADJUSTMENT/CASH_PRIZE/
      // SUPPLIER_PAYS_US) — important because this migration is irreversible.
      const res = db
        .prepare(
          `DELETE FROM supplier_ledger
           WHERE note LIKE 'Auto:%'
             AND entry_type IN ('TOP_UP', 'SALE_COST')
             AND supplier_id IN (SELECT id FROM suppliers WHERE provider = ?)`,
        )
        .run(secondary);
      console.log(
        `Migration v102: Removed ${res.changes} secondary-system (${secondary}) auto SALE_COST/TOP_UP supplier_ledger entries`,
      );
    },
    down(_db) {
      // Irreversible cleanup — the removed rows were erroneous auto-entries.
      console.log(
        "Migration v102 rolled back (no-op; removed rows not restored)",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v103 — Add SUPPLIER_PAYS_US to supplier_ledger.entry_type (supplier pays us)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 103,
    name: "add_supplier_pays_us_entry_type",
    description:
      "Add 'SUPPLIER_PAYS_US' to the supplier_ledger.entry_type CHECK so the shop can record a supplier paying us back (e.g. settling an overpayment): a positive ledger entry (mirrors PAYMENT) with cash credited to the payment-method drawer (LIRA-059). SQLite can't ALTER a CHECK, so the table is recreated preserving all rows + indexes — mirrors migration v99.",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE supplier_ledger_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US')),
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

        INSERT INTO supplier_ledger_new SELECT * FROM supplier_ledger;

        DROP TABLE supplier_ledger;

        ALTER TABLE supplier_ledger_new RENAME TO supplier_ledger;

        CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
      `);

      console.log(
        "Migration v103: Added SUPPLIER_PAYS_US to supplier_ledger entry_type",
      );
    },
    down(db) {
      // Relabel SUPPLIER_PAYS_US rows to ADJUSTMENT (same amount/sign), then
      // recreate the table with the prior constraint (the v99 CHECK set).
      db.exec(`
        UPDATE supplier_ledger SET entry_type = 'ADJUSTMENT' WHERE entry_type = 'SUPPLIER_PAYS_US';

        CREATE TABLE supplier_ledger_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE')),
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

        INSERT INTO supplier_ledger_old SELECT * FROM supplier_ledger;

        DROP TABLE supplier_ledger;

        ALTER TABLE supplier_ledger_old RENAME TO supplier_ledger;

        CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
      `);

      console.log(
        "Migration v103 rolled back: SUPPLIER_PAYS_US removed from supplier_ledger",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v104 — Add updated_at to sales (was missing; SalesRepository.markSalePaid and
  //        the session-basket back-fill write it, so a session sale checkout failed
  //        with "no such column: updated_at" on DBs created before this).
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 104,
    name: "add_updated_at_to_sales",
    description:
      "Add the missing updated_at column to sales (schema standard requires created_at + updated_at). SalesRepository.markSalePaid — used by the session-basket settlement back-fill — writes updated_at; without the column a session basket containing a POS sale fails at checkout.",
    type: "typescript",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(sales)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "updated_at")) {
        // SQLite rejects ADD COLUMN with a non-constant default ("Cannot add
        // a column with non-constant default") — this exact statement bricked
        // production DBs at v103 (fresh installs never hit it: create_db.sql
        // already has the column, so the guard skipped). Add defaultless,
        // backfill, and let SalesRepository stamp updated_at on INSERT/UPDATE.
        db.exec("ALTER TABLE sales ADD COLUMN updated_at DATETIME;");
        db.exec(
          "UPDATE sales SET updated_at = COALESCE(edited_at, created_at);",
        );
      }
      console.log("Migration v104: Added updated_at to sales");
    },
    down(_db) {
      // SQLite ADD COLUMN is treated one-way in this codebase (see v71/v100);
      // leave the column in place on rollback.
      console.log("Migration v104 rolled back (updated_at column remains)");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v105 — Rename the 'WISH_APP' provider typo to 'WHISH_APP' (the brand is "Whish").
  //        financial_services.provider had a CHECK allowing only 'WISH_APP', while
  //        the seeded supplier, recharges.carrier and the 'Whish_App' drawer all use
  //        the 'WHISH' spelling. The mismatch silently dropped the SALE_COST
  //        supplier-ledger write for Whish App SEND (getByProvider('WISH_APP') never
  //        matched the 'WHISH_APP' supplier). This aligns the value everywhere.
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 105,
    name: "rename_wish_app_to_whish_app",
    description:
      "Normalize the Whish App provider value from the 'WISH_APP' typo to 'WHISH_APP'. Recreates financial_services so its provider CHECK accepts 'WHISH_APP' (schema-faithful: copies the table's OWN live CREATE statement, only widening the CHECK), then migrates financial_services.provider + mobile_service_items.provider + transactions.metadata_json. Fixes Whish App SEND no longer booking a settleable SALE_COST supplier entry.",
    type: "typescript",
    up(db) {
      const tbl = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='financial_services'",
        )
        .get() as { sql?: string } | undefined;

      if (tbl?.sql && !tbl.sql.includes("'WHISH_APP'")) {
        // Live CHECK still only allows 'WISH_APP'. SQLite can't ALTER a CHECK, so
        // recreate the table from its OWN current CREATE statement (preserving
        // every column/constraint/order exactly), widening ONLY the provider CHECK
        // to also permit 'WHISH_APP'. Capture index DDL first (dropped with table).
        const idx = db
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='financial_services' AND sql IS NOT NULL",
          )
          .all() as { sql: string }[];

        const newTableSql = tbl.sql
          .replace("financial_services", "financial_services_new") // first occ = the table name
          .replace("'WISH_APP'", "'WISH_APP', 'WHISH_APP'");

        db.exec(newTableSql);
        db.exec(
          "INSERT INTO financial_services_new SELECT * FROM financial_services;",
        );
        db.exec(
          "UPDATE financial_services_new SET provider = 'WHISH_APP' WHERE provider = 'WISH_APP';",
        );
        db.exec("DROP TABLE financial_services;");
        db.exec(
          "ALTER TABLE financial_services_new RENAME TO financial_services;",
        );
        for (const r of idx) db.exec(r.sql);
      } else {
        // Fresh install (create_db.sql already uses 'WHISH_APP') or already migrated
        // — just normalize any residual data.
        db.exec(
          "UPDATE financial_services SET provider = 'WHISH_APP' WHERE provider = 'WISH_APP';",
        );
      }

      // Non-CHECK-constrained tables that may hold the old value. The LIKE/REPLACE
      // can't touch 'WHISH_APP' rows since 'WISH_APP' is not a substring of it.
      db.exec(
        "UPDATE mobile_service_items SET provider = 'WHISH_APP' WHERE provider = 'WISH_APP';",
      );
      db.exec(
        "UPDATE transactions SET metadata_json = REPLACE(metadata_json, 'WISH_APP', 'WHISH_APP') WHERE metadata_json LIKE '%WISH_APP%';",
      );

      console.log("Migration v105: Renamed WISH_APP provider to WHISH_APP");
    },
    down(db) {
      // Reverse the data relabel. The widened CHECK still permits 'WISH_APP', so no
      // table recreate is needed on rollback.
      db.exec(
        "UPDATE financial_services SET provider = 'WISH_APP' WHERE provider = 'WHISH_APP';",
      );
      db.exec(
        "UPDATE mobile_service_items SET provider = 'WISH_APP' WHERE provider = 'WHISH_APP';",
      );
      db.exec(
        "UPDATE transactions SET metadata_json = REPLACE(metadata_json, 'WHISH_APP', 'WISH_APP') WHERE metadata_json LIKE '%WHISH_APP%';",
      );
      console.log(
        "Migration v105 rolled back: WHISH_APP relabeled to WISH_APP",
      );
    },
  },
  {
    version: 106,
    name: "add_bill_to_financial_service_type",
    description:
      "Add BILL to financial_services.service_type CHECK constraint for iPick/Katsh bill processing. Recreates financial_services (post-v105: provider data is already 'WHISH_APP', so the rebuilt CHECK uses the corrected spelling).",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE financial_services_v106 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'iPick', 'Katsh', 'WHISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,
          service_type TEXT CHECK(service_type IN ('SEND', 'RECEIVE', 'BILL')) NOT NULL,
          amount DECIMAL(10, 2) NOT NULL,
          currency TEXT DEFAULT 'USD' NOT NULL,
          commission DECIMAL(10, 2) DEFAULT 0,
          cost DECIMAL(10, 2) DEFAULT 0,
          price DECIMAL(10, 2) DEFAULT 0,
          paid_by TEXT DEFAULT 'CASH',
          paid_amount REAL DEFAULT NULL,
          paid_currency TEXT DEFAULT NULL,
          client_id INTEGER REFERENCES clients(id),
          client_name TEXT,
          reference_number TEXT,
          phone_number TEXT,
          omt_service_type TEXT CHECK(omt_service_type IN ('INTRA', 'WESTERN_UNION', 'CASH_TO_BUSINESS', 'CASH_TO_GOV', 'OMT_WALLET', 'OMT_CARD', 'OGERO_MECANIQUE', 'ONLINE_BROKERAGE')),
          omt_fee DECIMAL(10, 2) DEFAULT 0,
          whish_fee DECIMAL(10, 2) DEFAULT 0,
          profit_rate DECIMAL(6, 5) DEFAULT NULL,
          pay_fee INTEGER DEFAULT 0,
          payment_method_fee DECIMAL(10, 2) DEFAULT 0,
          payment_method_fee_rate DECIMAL(6, 5) DEFAULT NULL,
          item_key TEXT,
          note TEXT,
          sender_name TEXT,
          sender_phone TEXT,
          receiver_name TEXT,
          receiver_phone TEXT,
          sender_client_id INTEGER REFERENCES clients(id),
          receiver_client_id INTEGER REFERENCES clients(id),
          is_settled INTEGER NOT NULL DEFAULT 1,
          settled_at TEXT,
          settlement_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER,
          edited_by TEXT DEFAULT NULL,
          edited_at TEXT DEFAULT NULL,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          partner_id INTEGER REFERENCES partners(id),
          partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))
        );
      `);

      db.exec(`
        INSERT INTO financial_services_v106
        SELECT
          id, provider, service_type, amount, currency, commission, cost, price,
          paid_by, paid_amount, paid_currency, client_id, client_name, reference_number,
          phone_number, omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee,
          payment_method_fee, payment_method_fee_rate, item_key, note,
          sender_name, sender_phone, receiver_name, receiver_phone,
          sender_client_id, receiver_client_id, is_settled, settled_at, settlement_id,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at,
          partner_id, partner_mode
        FROM financial_services;
      `);

      db.exec(`
        DROP TABLE financial_services;
        ALTER TABLE financial_services_v106 RENAME TO financial_services;
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_financial_services_is_settled ON financial_services(is_settled);
        CREATE INDEX IF NOT EXISTS idx_financial_services_provider_settled ON financial_services(provider, is_settled);
        CREATE INDEX IF NOT EXISTS idx_financial_services_provider_type_created_at ON financial_services(provider, service_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_financial_services_created_at ON financial_services(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_financial_services_paid_by ON financial_services(paid_by);
        CREATE INDEX IF NOT EXISTS idx_financial_services_client_id ON financial_services(client_id);
      `);

      console.log(
        "Migration v106: Added BILL to financial_services.service_type CHECK",
      );
    },
    down(db) {
      db.exec(`DELETE FROM financial_services WHERE service_type = 'BILL';`);
      console.log(
        "Migration v106 rolled back (BILL rows removed; CHECK not downgraded — SQLite limitation)",
      );
    },
  },
  {
    version: 107,
    name: "fix_loto_liban_is_system",
    description:
      "Set is_system = 1 for Loto Liban supplier so it appears under Companies, not Products.",
    type: "typescript",
    up(db) {
      db.exec(`UPDATE suppliers SET is_system = 1 WHERE provider = 'LOTO'`);
    },
    down(db) {
      db.exec(`UPDATE suppliers SET is_system = 0 WHERE provider = 'LOTO'`);
    },
  },
  {
    version: 108,
    name: "link_product_suppliers_to_suppliers",
    description:
      "Add supplier_id FK to product_suppliers so each inventory supplier has a ledger entry in suppliers (is_system=0). Backfills existing rows.",
    type: "typescript",
    up(db) {
      // Add the column
      db.exec(
        `ALTER TABLE product_suppliers ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)`,
      );

      // Backfill: for every existing product_supplier, find-or-create a suppliers row
      const rows = db
        .prepare(`SELECT id, name FROM product_suppliers`)
        .all() as { id: number; name: string }[];
      const findSupplier = db.prepare(
        `SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND is_system = 0 LIMIT 1`,
      );
      const insertSupplier = db.prepare(
        `INSERT INTO suppliers (name, is_active, is_system, created_at) VALUES (?, 1, 0, CURRENT_TIMESTAMP)`,
      );
      const linkRow = db.prepare(
        `UPDATE product_suppliers SET supplier_id = ? WHERE id = ?`,
      );

      for (const row of rows) {
        const existing = findSupplier.get(row.name) as
          | { id: number }
          | undefined;
        const supplierId = existing
          ? existing.id
          : Number(insertSupplier.run(row.name).lastInsertRowid);
        linkRow.run(supplierId, row.id);
      }

      console.log(
        `Migration v108: linked ${rows.length} product_suppliers to suppliers`,
      );
    },
    down(db) {
      // Remove supplier_id column by rebuilding the table (SQLite limitation)
      db.exec(`
        CREATE TABLE product_suppliers_v108_bak (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO product_suppliers_v108_bak SELECT id, name, sort_order, is_active, created_at FROM product_suppliers;
        DROP TABLE product_suppliers;
        ALTER TABLE product_suppliers_v108_bak RENAME TO product_suppliers;
      `);
    },
  },
  {
    version: 109,
    name: "add_supplier_purchases",
    description:
      "Track delivery batches from product suppliers for FIFO payment coverage.",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS supplier_purchases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
          total_usd REAL NOT NULL CHECK(total_usd > 0),
          paid_usd  REAL NOT NULL DEFAULT 0,
          note      TEXT,
          created_by INTEGER REFERENCES users(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_supplier_purchases_supplier_id ON supplier_purchases(supplier_id);
        CREATE INDEX idx_supplier_purchases_created_at  ON supplier_purchases(created_at);
      `);
      console.log("Migration v109: supplier_purchases table created");
    },
    down(db) {
      db.exec(`DROP TABLE IF EXISTS supplier_purchases;`);
    },
  },
  {
    version: 110,
    name: "supplier_ledger_is_auto",
    description:
      "Add is_auto flag to supplier_ledger to distinguish auto-entries from manual Pay/Receive entries",
    type: "typescript",
    up(db) {
      db.exec(
        `ALTER TABLE supplier_ledger ADD COLUMN is_auto INTEGER NOT NULL DEFAULT 0`,
      );
      db.exec(
        `UPDATE supplier_ledger SET is_auto = 1 WHERE note LIKE 'Auto:%'`,
      );
      console.log("Migration v110: added is_auto to supplier_ledger");
    },
    down(db) {
      // SQLite doesn't support DROP COLUMN natively before 3.35 — data loss acceptable on rollback
      db.exec(
        `CREATE TABLE supplier_ledger_backup AS SELECT id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, created_at FROM supplier_ledger`,
      );
      db.exec(`DROP TABLE supplier_ledger`);
      db.exec(`ALTER TABLE supplier_ledger_backup RENAME TO supplier_ledger`);
      console.log(
        "Migration v110 rolled back: removed is_auto from supplier_ledger",
      );
    },
  },
  {
    version: 111,
    name: "add_hold_money",
    description:
      "Add hold_money table for holding cash on behalf of clients until collection",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS hold_money (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_name TEXT NOT NULL,
          usd_amount REAL NOT NULL DEFAULT 0,
          lbp_amount REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'collected')),
          notes TEXT,
          created_by INTEGER REFERENCES users(id),
          collected_by INTEGER REFERENCES users(id),
          collected_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`CREATE INDEX idx_hold_money_status ON hold_money(status)`);
      db.exec(
        `CREATE INDEX idx_hold_money_created_at ON hold_money(created_at)`,
      );
      console.log("Migration v111: hold_money table created");
    },
    down(db) {
      db.exec(`DROP TABLE IF EXISTS hold_money`);
    },
  },
  {
    version: 112,
    name: "add_phone_to_hold_money",
    description:
      "Add optional phone_number to hold_money (customer contact for collection)",
    type: "typescript",
    up(db) {
      db.exec(`ALTER TABLE hold_money ADD COLUMN phone_number TEXT`);
      console.log("Migration v112: added phone_number to hold_money");
    },
    down(db) {
      // SQLite < 3.35 has no DROP COLUMN — rebuild without phone_number.
      db.exec(`
        CREATE TABLE hold_money_v112_bak (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_name TEXT NOT NULL,
          usd_amount REAL NOT NULL DEFAULT 0,
          lbp_amount REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'collected')),
          notes TEXT,
          created_by INTEGER REFERENCES users(id),
          collected_by INTEGER REFERENCES users(id),
          collected_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO hold_money_v112_bak
          (id, client_name, usd_amount, lbp_amount, status, notes, created_by, collected_by, collected_at, created_at, updated_at)
          SELECT id, client_name, usd_amount, lbp_amount, status, notes, created_by, collected_by, collected_at, created_at, updated_at FROM hold_money;
        DROP TABLE hold_money;
        ALTER TABLE hold_money_v112_bak RENAME TO hold_money;
        CREATE INDEX idx_hold_money_status ON hold_money(status);
        CREATE INDEX idx_hold_money_created_at ON hold_money(created_at);
      `);
    },
  },
  {
    version: 113,
    name: "normalize_staff_role",
    description:
      "Migrate legacy non-admin roles (e.g. cashier) to 'staff' so stored roles match the authorization layer (admin/staff)",
    type: "typescript",
    up(db) {
      const res = db
        .prepare(
          `UPDATE users SET role = 'staff' WHERE role NOT IN ('admin', 'staff')`,
        )
        .run();
      console.log(
        `Migration v113: normalized ${res.changes} user role(s) to 'staff'`,
      );
    },
    down() {
      // Irreversible: original non-standard role names are not recoverable.
    },
  },
  {
    version: 114,
    name: "allow_alfa_gift_recharge_type",
    description:
      "Add 'ALFA_GIFT' to the recharges.recharge_type CHECK. Alfa gift-card sales record into the recharges table with recharge_type='ALFA_GIFT', which the old CHECK(recharge_type IN ('CREDIT_TRANSFER','VOUCHER','DAYS','TOP_UP')) rejected with SQLITE_CONSTRAINT_CHECK. Recreates the table (SQLite can't ALTER a CHECK), preserving all rows + ids + indexes — mirrors migration v97.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS recharges_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          carrier TEXT NOT NULL,
          recharge_type TEXT CHECK(recharge_type IN ('CREDIT_TRANSFER', 'VOUCHER', 'DAYS', 'TOP_UP', 'ALFA_GIFT')) NOT NULL DEFAULT 'CREDIT_TRANSFER',
          amount DECIMAL(10, 2) NOT NULL,
          cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
          price DECIMAL(10, 2) NOT NULL DEFAULT 0,
          default_price_to_client REAL DEFAULT NULL,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          paid_by TEXT DEFAULT 'CASH',
          phone_number TEXT,
          client_id INTEGER,
          client_name TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER DEFAULT 1,
          edited_by TEXT DEFAULT NULL,
          edited_at TEXT DEFAULT NULL,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );

        INSERT INTO recharges_new (
          id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        )
        SELECT
          id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        FROM recharges;

        DROP TABLE recharges;
        ALTER TABLE recharges_new RENAME TO recharges;

        CREATE INDEX IF NOT EXISTS idx_recharges_carrier ON recharges(carrier);
        CREATE INDEX IF NOT EXISTS idx_recharges_created_at ON recharges(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
        CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
      `);
      console.log(
        "Migration v114: added 'ALFA_GIFT' to recharges.recharge_type CHECK",
      );
    },
    down(db: Database.Database) {
      // Restore the pre-ALFA_GIFT CHECK. Throws if ALFA_GIFT rows exist
      // (expected — you can't roll back after recording gift sales).
      db.exec(`
        CREATE TABLE recharges_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          carrier TEXT NOT NULL,
          recharge_type TEXT CHECK(recharge_type IN ('CREDIT_TRANSFER', 'VOUCHER', 'DAYS', 'TOP_UP')) NOT NULL DEFAULT 'CREDIT_TRANSFER',
          amount DECIMAL(10, 2) NOT NULL,
          cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
          price DECIMAL(10, 2) NOT NULL DEFAULT 0,
          default_price_to_client REAL DEFAULT NULL,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          paid_by TEXT DEFAULT 'CASH',
          phone_number TEXT,
          client_id INTEGER,
          client_name TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER DEFAULT 1,
          edited_by TEXT DEFAULT NULL,
          edited_at TEXT DEFAULT NULL,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );

        INSERT INTO recharges_old (
          id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        )
        SELECT
          id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        FROM recharges;

        DROP TABLE recharges;
        ALTER TABLE recharges_old RENAME TO recharges;

        CREATE INDEX IF NOT EXISTS idx_recharges_carrier ON recharges(carrier);
        CREATE INDEX IF NOT EXISTS idx_recharges_created_at ON recharges(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
        CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
      `);
      console.log(
        "Migration v114 rolled back: removed 'ALFA_GIFT' from recharges.recharge_type CHECK",
      );
    },
  },
  {
    version: 115,
    name: "prepaid_units_supplier_debt_booked",
    description:
      "C5 prepaid-units redesign: supplier debt is booked ONCE at top-up time (TOP_UP ledger entry) and sales only draw down the provider drawer — no per-sale SALE_COST ledger entry. Adds financial_services.supplier_debt_booked to mark LEGACY cost-flow SEND rows that DID book a per-sale SALE_COST (backfilled to 1); only those stay individually settleable in the Settle tab. New sales default to 0 — settling them would write a SETTLEMENT with no offsetting SALE_COST and corrupt the supplier balance.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        ALTER TABLE financial_services
          ADD COLUMN supplier_debt_booked INTEGER NOT NULL DEFAULT 0;

        UPDATE financial_services
           SET supplier_debt_booked = 1
         WHERE service_type = 'SEND'
           AND cost > 0;
      `);
      console.log(
        "Migration v115: prepaid-units — supplier_debt_booked added; legacy cost-flow SENDs backfilled",
      );
    },
    down(db: Database.Database) {
      db.exec(
        `ALTER TABLE financial_services DROP COLUMN supplier_debt_booked;`,
      );
      console.log("Migration v115 rolled back: supplier_debt_booked dropped");
    },
  },
  {
    version: 116,
    name: "normalize_iso_created_at",
    description:
      "A6: supplier settlement/cashflow paths stamped created_at with JS toISOString() ('2026-07-02T20:55:08.710Z') while every other writer uses CURRENT_TIMESTAMP ('2026-07-02 20:55:19'). Since 'T' > ' ' in string ordering, ISO rows sort as permanently-newest for their whole day in every ORDER BY created_at DESC list — settlement rows pinned to the top of the transactions table. The writers now use datetime('now'); this normalizes the historical rows (both are UTC, so trimming to 'YYYY-MM-DD HH:MM:SS' preserves chronology).",
    type: "typescript" as const,
    up(db: Database.Database) {
      const norm = (table: string, column: string) =>
        db
          .prepare(
            `UPDATE ${table}
                SET ${column} = REPLACE(SUBSTR(${column}, 1, 19), 'T', ' ')
              WHERE ${column} LIKE '____-__-__T%'`,
          )
          .run().changes;
      const t = norm("transactions", "created_at");
      const l = norm("supplier_ledger", "created_at");
      const f = norm("financial_services", "settled_at");
      console.log(
        `Migration v116: normalized ISO timestamps — transactions:${t}, supplier_ledger:${l}, financial_services.settled_at:${f}`,
      );
    },
    down() {
      // Irreversible by design: the sub-second precision the ISO strings
      // carried is gone, and the normalized format is the correct one.
    },
  },
  {
    version: 117,
    name: "rename_mtc_cards_to_face_value",
    description:
      "A1: MTC prepaid recharge cards under Katsh and WHISH_APP were labeled by their USD sell price (e.g. '8.65') instead of the face value printed on the card (e.g. '7.58'). Rename existing mobile_service_items rows to the card face values (owner-provided card photos, 2026-07-03). Costs/sells unchanged; historical transactions keep the item labels they were sold under. Alfa pending owner-provided face values.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const RENAMES: Array<[string, string]> = [
        ["1.35", "1"],
        ["2.10", "1.67"],
        ["4.45", "3.79"],
        ["5.24", "4.5"],
        ["8.65", "7.58"],
        ["11.32", "10"],
        ["17.06", "15.15"],
        ["25.47", "22.73"],
        ["86", "77.28"],
      ];
      const stmt = db.prepare(
        `UPDATE mobile_service_items SET label = ?, updated_at = CURRENT_TIMESTAMP
          WHERE provider IN ('Katsh', 'WHISH_APP')
            AND category = 'mtc'
            AND subcategory = 'Prepaid'
            AND label = ?`,
      );
      let changed = 0;
      for (const [oldLabel, newLabel] of RENAMES) {
        changed += stmt.run(newLabel, oldLabel).changes;
      }
      console.log(
        `Migration v117: renamed ${changed} MTC prepaid card items to face values`,
      );
    },
    down(db: Database.Database) {
      const RENAMES: Array<[string, string]> = [
        ["1", "1.35"],
        ["1.67", "2.10"],
        ["3.79", "4.45"],
        ["4.5", "5.24"],
        ["7.58", "8.65"],
        ["10", "11.32"],
        ["15.15", "17.06"],
        ["22.73", "25.47"],
        ["77.28", "86"],
      ];
      const stmt = db.prepare(
        `UPDATE mobile_service_items SET label = ?, updated_at = CURRENT_TIMESTAMP
          WHERE provider IN ('Katsh', 'WHISH_APP')
            AND category = 'mtc'
            AND subcategory = 'Prepaid'
            AND label = ?`,
      );
      for (const [oldLabel, newLabel] of RENAMES) {
        stmt.run(newLabel, oldLabel);
      }
      console.log("Migration v117 rolled back: MTC card labels restored");
    },
  },
  {
    version: 118,
    name: "rename_alfa_cards_to_face_value",
    description:
      "A1 (alfa half): ALFA prepaid recharge cards under Katsh and WHISH_APP renamed from their USD sell price (e.g. '8.65') to the face value printed on the card (e.g. '7.58') — owner-provided card photos, 2026-07-03. Costs/sells unchanged; history keeps the labels items were sold under.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const RENAMES: Array<[string, string]> = [
        ["3.6", "3.03"],
        ["5.24", "4.5"],
        ["8.65", "7.58"],
        ["11.32", "10"],
        ["17.06", "15.15"],
        ["25.47", "22.73"],
        ["86", "77.28"],
      ];
      const stmt = db.prepare(
        `UPDATE mobile_service_items SET label = ?, updated_at = CURRENT_TIMESTAMP
          WHERE provider IN ('Katsh', 'WHISH_APP')
            AND category = 'alfa'
            AND subcategory = 'Prepaid'
            AND label = ?`,
      );
      let changed = 0;
      for (const [oldLabel, newLabel] of RENAMES) {
        changed += stmt.run(newLabel, oldLabel).changes;
      }
      console.log(
        `Migration v118: renamed ${changed} ALFA prepaid card items to face values`,
      );
    },
    down(db: Database.Database) {
      const RENAMES: Array<[string, string]> = [
        ["3.03", "3.6"],
        ["4.5", "5.24"],
        ["7.58", "8.65"],
        ["10", "11.32"],
        ["15.15", "17.06"],
        ["22.73", "25.47"],
        ["77.28", "86"],
      ];
      const stmt = db.prepare(
        `UPDATE mobile_service_items SET label = ?, updated_at = CURRENT_TIMESTAMP
          WHERE provider IN ('Katsh', 'WHISH_APP')
            AND category = 'alfa'
            AND subcategory = 'Prepaid'
            AND label = ?`,
      );
      for (const [oldLabel, newLabel] of RENAMES) {
        stmt.run(newLabel, oldLabel);
      }
      console.log("Migration v118 rolled back: ALFA card labels restored");
    },
  },
  {
    version: 119,
    name: "flip_loto_supplier_ledger_sign",
    description:
      "B6b: Loto booked its supplier_ledger rows with an INVERTED sign convention — ticket sales (shop owes Loto) as NEGATIVE 'PAYMENT' rows and cash prizes (Loto owes shop) as POSITIVE 'CASH_PRIZE' rows — so the Suppliers page (which sums ledger rows, >0 = 'You owe') read Loto backwards vs every other supplier. Normalizes historical rows to the standard convention: ticket rows relabeled TOP_UP and negated; cash-prize rows negated. SETTLEMENT rows are already standard-oriented and deliberately untouched. Scoped by the exact note prefixes the Loto repos have always written, so legitimate manual Loto PAYMENT settlements (also stored negative, by addLedgerEntry) are NOT re-flipped.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Sign guards (amount_lbp < 0 / > 0) make both UPDATEs idempotent: only
      // legacy inverted rows match. Post-fix rows (TOP_UP tickets, NEGATIVE
      // cash prizes) share the same note prefixes, so without the guards a
      // re-run would double-negate every new CASH_PRIZE row.
      // Ticket-sale liability rows: relabel PAYMENT -> TOP_UP and flip sign.
      const tickets = db
        .prepare(
          `UPDATE supplier_ledger
            SET entry_type = 'TOP_UP', amount_lbp = -amount_lbp, amount_usd = -amount_usd
            WHERE supplier_id IN (SELECT id FROM suppliers WHERE provider = 'LOTO')
              AND entry_type = 'PAYMENT'
              AND amount_lbp < 0
              AND note LIKE 'Ticket sale: we owe LOTO%'`,
        )
        .run().changes;
      // Cash-prize receivable rows: flip sign only.
      const prizes = db
        .prepare(
          `UPDATE supplier_ledger
            SET amount_lbp = -amount_lbp, amount_usd = -amount_usd
            WHERE supplier_id IN (SELECT id FROM suppliers WHERE provider = 'LOTO')
              AND entry_type = 'CASH_PRIZE'
              AND amount_lbp > 0
              AND note LIKE 'Cash prize payout: LOTO owes us%'`,
        )
        .run().changes;
      console.log(
        `Migration v119: flipped ${tickets} loto ticket rows (PAYMENT->TOP_UP) and ${prizes} cash-prize rows to the standard supplier-ledger sign convention`,
      );
    },
    down(db: Database.Database) {
      db.prepare(
        `UPDATE supplier_ledger
          SET entry_type = 'PAYMENT', amount_lbp = -amount_lbp, amount_usd = -amount_usd
          WHERE supplier_id IN (SELECT id FROM suppliers WHERE provider = 'LOTO')
            AND entry_type = 'TOP_UP'
            AND amount_lbp > 0
            AND note LIKE 'Ticket sale: we owe LOTO%'`,
      ).run();
      db.prepare(
        `UPDATE supplier_ledger
          SET amount_lbp = -amount_lbp, amount_usd = -amount_usd
          WHERE supplier_id IN (SELECT id FROM suppliers WHERE provider = 'LOTO')
            AND entry_type = 'CASH_PRIZE'
            AND amount_lbp < 0
            AND note LIKE 'Cash prize payout: LOTO owes us%'`,
      ).run();
      console.log(
        "Migration v119 rolled back: loto supplier_ledger rows restored to the legacy inverted sign",
      );
    },
  },
  {
    version: 120,
    name: "add_supplier_ledger_refund_flag",
    description:
      "Voiding/refunding a SUPPLIER_PAYMENT transaction reversed the cash drawer but left its supplier_ledger row counting toward the supplier balance forever. Adds is_refunded/refunded_at so TransactionRepository can soft-void the ledger row (flag-the-original — a compensating row cannot net the sign-bucketed FIFO settle pools) and every balance/pool aggregate excludes flagged rows. NO backfill: rows stranded by pre-fix voids may have been manually corrected with ADJUSTMENT entries, so auto-flagging them could double-correct — review any suspect supplier balance by hand instead.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(
        `ALTER TABLE supplier_ledger ADD COLUMN is_refunded INTEGER NOT NULL DEFAULT 0`,
      );
      db.exec(`ALTER TABLE supplier_ledger ADD COLUMN refunded_at DATETIME`);
      console.log(
        "Migration v120: supplier_ledger soft-void columns added (is_refunded, refunded_at)",
      );
    },
    down(db: Database.Database) {
      db.exec(`ALTER TABLE supplier_ledger DROP COLUMN refunded_at`);
      db.exec(`ALTER TABLE supplier_ledger DROP COLUMN is_refunded`);
      console.log(
        "Migration v120 rolled back: supplier_ledger soft-void columns removed",
      );
    },
  },
  {
    version: 121,
    name: "add_session_id_to_debt_ledger",
    description:
      "A session-basket CUSTOMER_ACCOUNT charge writes ONE debt_ledger row for the whole basket (transaction_id is NULL — it isn't any single item). With no FK back to the basket, the Debts page could only show the free-text note, not the itemized purchases. Adds debt_ledger.session_id so the 'Session Debt' row can join to customer_session_transactions and list what was actually bought.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(
        `ALTER TABLE debt_ledger ADD COLUMN session_id INTEGER REFERENCES customer_sessions(id) ON DELETE SET NULL`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_debt_ledger_session_id ON debt_ledger(session_id)`,
      );
      console.log(
        "Migration v121: debt_ledger.session_id added (links 'Session Debt' rows back to their basket)",
      );
    },
    down(db: Database.Database) {
      db.exec(`DROP INDEX IF EXISTS idx_debt_ledger_session_id`);
      db.exec(`ALTER TABLE debt_ledger DROP COLUMN session_id`);
      console.log("Migration v121 rolled back: debt_ledger.session_id removed");
    },
  },
  {
    version: 122,
    name: "rename_debts_module_to_accounts",
    description:
      "The Debts page lists both debtors and creditors, so 'Debts' undersold half of what it shows. Renames the module's sidebar/home-grid label to 'Accounts' to match the in-page title.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`UPDATE modules SET label = 'Accounts' WHERE key = 'debts'`);
      console.log("Migration v122: 'debts' module label renamed to 'Accounts'");
    },
    down(db: Database.Database) {
      db.exec(`UPDATE modules SET label = 'Debts' WHERE key = 'debts'`);
      console.log(
        "Migration v122 rolled back: 'debts' module label restored to 'Debts'",
      );
    },
  },
  {
    version: 123,
    name: "add_multi_tenancy",
    description:
      "Multi-tenant foundation (WP0). Adds the `tenants` table and a `tenant_id` column to all 49 tenant-owned tables, backfilling everything to tenant 1 ('Default'). Desktop stays single-tenant (fixed tenant 1 at boot); web multi-tenancy (query-layer scoping, JWT tenant context, provisioning, impersonation) lands in later work packages — this migration only lays the schema foundation. 19 tables whose UNIQUE/PK constraints would otherwise collide across tenants (clients.phone_number, suppliers.name, products.barcode, product_categories.name, product_suppliers.name, partners.name, payment_methods.code, vouchers.code, system_settings.key_name, currencies.code, exchange_rates.to_code, modules.key, loto_settings.key_name, drawer_balances, currency_modules, currency_drawers, item_costs, voucher_images, mobile_service_items) are rebuilt with tenant-scoped constraints via the standard SQLite 12-step table rebuild (new table -> copy -> drop -> rename -> recreate indexes). modules.key's primary key change cascades into composite foreign keys on currency_modules and suppliers.module_key. users.username stays GLOBALLY unique (no tenant hint at login yet); sessions.token (random-unique) and daily_closing_amounts' UNIQUE (which already includes the globally-unique closing_id) don't need rebuilding, just the added column. audit_log also gains impersonator_id for future impersonation auditing (WP6).",
    type: "typescript" as const,
    up(db: Database.Database) {
      // -----------------------------------------------------------------
      // 1. Tenants table + Default tenant seed
      // -----------------------------------------------------------------
      db.exec(`
        CREATE TABLE IF NOT EXISTS tenants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
          contact_name TEXT,
          contact_phone TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(
        `INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (1, 'Default', 'default', 'active')`,
      );

      // -----------------------------------------------------------------
      // 2. Plain ALTER + backfill (constraints don't collide across tenants)
      // -----------------------------------------------------------------
      const alterOnlyTables = [
        "transactions",
        "sales",
        "sale_items",
        "debt_ledger",
        "customer_sessions",
        "customer_session_transactions",
        "session_cart_items",
        "supplier_ledger",
        "supplier_purchases",
        "maintenance",
        "expenses",
        "recharges",
        "exchange_transactions",
        "financial_services",
        "partner_ledger",
        "custom_services",
        "payments",
        "drawer_topups",
        "daily_closings",
        "daily_closing_amounts",
        "loto_tickets",
        "loto_monthly_fees",
        "loto_checkpoints",
        "loto_cash_prizes",
        "loto_settlements",
        "hold_money",
        "audit_log",
        "users",
        "sessions",
        "service_presets",
      ];
      for (const table of alterOnlyTables) {
        db.exec(
          `ALTER TABLE ${table} ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)`,
        );
        db.exec(`UPDATE ${table} SET tenant_id = 1`);
      }

      // audit_log also gains impersonator_id (WP6 impersonation auditing)
      db.exec(
        `ALTER TABLE audit_log ADD COLUMN impersonator_id INTEGER REFERENCES users(id)`,
      );

      // High-volume tenant_id indexes on the ALTER-only tables (14 of the 15
      // total — `clients` is rebuilt below and gets its index there)
      const alterOnlyIndexedTables = [
        "transactions",
        "sales",
        "sale_items",
        "payments",
        "debt_ledger",
        "financial_services",
        "recharges",
        "exchange_transactions",
        "expenses",
        "audit_log",
        "loto_tickets",
        "customer_sessions",
        "custom_services",
        "maintenance",
      ];
      for (const table of alterOnlyIndexedTables) {
        db.exec(`CREATE INDEX idx_${table}_tenant_id ON ${table}(tenant_id)`);
      }

      // -----------------------------------------------------------------
      // 3. Table rebuilds — composite UNIQUE/PK constraints need tenant_id.
      //    Order: currencies + modules first (FK targets), then the
      //    junction/child tables that reference them, then the remaining
      //    independent rebuilds.
      // -----------------------------------------------------------------

      // currencies: code UNIQUE -> UNIQUE(tenant_id, code)
      db.exec(`
        CREATE TABLE currencies_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          symbol TEXT NOT NULL DEFAULT '',
          decimal_places INTEGER NOT NULL DEFAULT 2,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, code)
        )
      `);
      db.exec(`
        INSERT INTO currencies_new (id, tenant_id, code, name, symbol, decimal_places, is_active, created_at)
        SELECT id, 1, code, name, symbol, decimal_places, is_active, created_at FROM currencies
      `);
      db.exec(`DROP TABLE currencies`);
      db.exec(`ALTER TABLE currencies_new RENAME TO currencies`);

      // modules: key TEXT PRIMARY KEY -> PRIMARY KEY (tenant_id, key)
      db.exec(`
        CREATE TABLE modules_new (
          tenant_id   INTEGER REFERENCES tenants(id),
          key         TEXT NOT NULL,
          label       TEXT NOT NULL,
          icon        TEXT NOT NULL DEFAULT '',
          route       TEXT NOT NULL,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          is_enabled  INTEGER NOT NULL DEFAULT 1,
          admin_only  INTEGER NOT NULL DEFAULT 0,
          is_system   INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (tenant_id, key)
        )
      `);
      db.exec(`
        INSERT INTO modules_new (tenant_id, key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
        SELECT 1, key, label, icon, route, sort_order, is_enabled, admin_only, is_system FROM modules
      `);
      db.exec(`DROP TABLE modules`);
      db.exec(`ALTER TABLE modules_new RENAME TO modules`);

      // currency_modules: composite FKs now need tenant_id too
      db.exec(`
        CREATE TABLE currency_modules_new (
          tenant_id     INTEGER REFERENCES tenants(id),
          currency_code TEXT NOT NULL,
          module_key    TEXT NOT NULL,
          PRIMARY KEY (tenant_id, currency_code, module_key),
          FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code) ON DELETE CASCADE,
          FOREIGN KEY (tenant_id, module_key)    REFERENCES modules(tenant_id, key)     ON DELETE CASCADE
        )
      `);
      db.exec(`
        INSERT INTO currency_modules_new (tenant_id, currency_code, module_key)
        SELECT 1, currency_code, module_key FROM currency_modules
      `);
      db.exec(`DROP TABLE currency_modules`);
      db.exec(`ALTER TABLE currency_modules_new RENAME TO currency_modules`);

      // currency_drawers: same treatment (FK to currencies only)
      db.exec(`
        CREATE TABLE currency_drawers_new (
          tenant_id     INTEGER REFERENCES tenants(id),
          currency_code TEXT NOT NULL,
          drawer_name   TEXT NOT NULL,
          PRIMARY KEY (tenant_id, currency_code, drawer_name),
          FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code) ON DELETE CASCADE
        )
      `);
      db.exec(`
        INSERT INTO currency_drawers_new (tenant_id, currency_code, drawer_name)
        SELECT 1, currency_code, drawer_name FROM currency_drawers
      `);
      db.exec(`DROP TABLE currency_drawers`);
      db.exec(`ALTER TABLE currency_drawers_new RENAME TO currency_drawers`);

      // suppliers: name UNIQUE -> UNIQUE(tenant_id, name); module_key's FK
      // becomes composite because modules' PK is now (tenant_id, key)
      db.exec(`
        CREATE TABLE suppliers_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          name TEXT NOT NULL,
          contact_name TEXT,
          phone TEXT,
          note TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          module_key TEXT DEFAULT NULL,
          provider TEXT DEFAULT NULL,
          is_system INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, name),
          FOREIGN KEY (tenant_id, module_key) REFERENCES modules(tenant_id, key) ON DELETE SET NULL
        )
      `);
      db.exec(`
        INSERT INTO suppliers_new (id, tenant_id, name, contact_name, phone, note, is_active, module_key, provider, is_system, created_at)
        SELECT id, 1, name, contact_name, phone, note, is_active, module_key, provider, is_system, created_at FROM suppliers
      `);
      db.exec(`DROP TABLE suppliers`);
      db.exec(`ALTER TABLE suppliers_new RENAME TO suppliers`);

      // clients: phone_number UNIQUE -> UNIQUE(tenant_id, phone_number)
      db.exec(`
        CREATE TABLE clients_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          full_name TEXT NOT NULL,
          phone_number TEXT,
          notes TEXT,
          whatsapp_opt_in BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, phone_number)
        )
      `);
      db.exec(`
        INSERT INTO clients_new (id, tenant_id, full_name, phone_number, notes, whatsapp_opt_in, created_at)
        SELECT id, 1, full_name, phone_number, notes, whatsapp_opt_in, created_at FROM clients
      `);
      db.exec(`DROP TABLE clients`);
      db.exec(`ALTER TABLE clients_new RENAME TO clients`);
      db.exec(
        `CREATE INDEX idx_clients_full_name ON clients(full_name COLLATE NOCASE)`,
      );
      db.exec(`CREATE INDEX idx_clients_tenant_id ON clients(tenant_id)`);

      // products: barcode UNIQUE -> UNIQUE(tenant_id, barcode)
      db.exec(`
        CREATE TABLE products_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          barcode TEXT,
          name TEXT NOT NULL,
          item_type TEXT NOT NULL,
          category TEXT DEFAULT 'General',
          category_id INTEGER DEFAULT NULL REFERENCES product_categories(id) ON DELETE SET NULL,
          description TEXT,
          supplier TEXT DEFAULT NULL,
          supplier_id INTEGER DEFAULT NULL,
          unit TEXT DEFAULT NULL,
          cost_price_usd DECIMAL(10, 2) DEFAULT 0,
          selling_price_usd DECIMAL(10, 2) DEFAULT 0,
          min_stock_level INTEGER DEFAULT 5,
          stock_quantity INTEGER DEFAULT 0,
          imei TEXT,
          color TEXT,
          image_url TEXT,
          warranty_expiry DATE,
          status TEXT DEFAULT 'Active',
          is_active BOOLEAN DEFAULT 1,
          is_deleted BOOLEAN DEFAULT 0,
          updated_at DATETIME DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, barcode)
        )
      `);
      db.exec(`
        INSERT INTO products_new (id, tenant_id, barcode, name, item_type, category, category_id, description, supplier, supplier_id, unit, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity, imei, color, image_url, warranty_expiry, status, is_active, is_deleted, updated_at, created_at)
        SELECT id, 1, barcode, name, item_type, category, category_id, description, supplier, supplier_id, unit, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity, imei, color, image_url, warranty_expiry, status, is_active, is_deleted, updated_at, created_at FROM products
      `);
      db.exec(`DROP TABLE products`);
      db.exec(`ALTER TABLE products_new RENAME TO products`);
      db.exec(`CREATE INDEX idx_products_barcode ON products(barcode)`);
      db.exec(`CREATE INDEX idx_products_is_active ON products(is_active)`);
      db.exec(`CREATE INDEX idx_products_category ON products(category)`);
      db.exec(`CREATE INDEX idx_products_status ON products(status)`);
      db.exec(
        `CREATE INDEX idx_products_active_category ON products(is_active, category)`,
      );
      db.exec(
        `CREATE INDEX idx_products_active_status ON products(is_active, status)`,
      );

      // product_categories: name UNIQUE COLLATE NOCASE -> UNIQUE(tenant_id, name)
      db.exec(`
        CREATE TABLE product_categories_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          name TEXT NOT NULL COLLATE NOCASE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, name)
        )
      `);
      db.exec(`
        INSERT INTO product_categories_new (id, tenant_id, name, sort_order, is_active, created_at)
        SELECT id, 1, name, sort_order, is_active, created_at FROM product_categories
      `);
      db.exec(`DROP TABLE product_categories`);
      db.exec(
        `ALTER TABLE product_categories_new RENAME TO product_categories`,
      );

      // product_suppliers: name UNIQUE COLLATE NOCASE -> UNIQUE(tenant_id, name)
      db.exec(`
        CREATE TABLE product_suppliers_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          name TEXT NOT NULL COLLATE NOCASE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          supplier_id INTEGER REFERENCES suppliers(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, name)
        )
      `);
      db.exec(`
        INSERT INTO product_suppliers_new (id, tenant_id, name, sort_order, is_active, supplier_id, created_at)
        SELECT id, 1, name, sort_order, is_active, supplier_id, created_at FROM product_suppliers
      `);
      db.exec(`DROP TABLE product_suppliers`);
      db.exec(`ALTER TABLE product_suppliers_new RENAME TO product_suppliers`);

      // partners: name UNIQUE -> UNIQUE(tenant_id, name)
      db.exec(`
        CREATE TABLE partners_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          name TEXT NOT NULL,
          phone TEXT,
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          system_association TEXT DEFAULT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, name)
        )
      `);
      db.exec(`
        INSERT INTO partners_new (id, tenant_id, name, phone, notes, is_active, system_association, created_at, updated_at)
        SELECT id, 1, name, phone, notes, is_active, system_association, created_at, updated_at FROM partners
      `);
      db.exec(`DROP TABLE partners`);
      db.exec(`ALTER TABLE partners_new RENAME TO partners`);

      // payment_methods: code UNIQUE -> UNIQUE(tenant_id, code)
      db.exec(`
        CREATE TABLE payment_methods_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id      INTEGER REFERENCES tenants(id),
          code           TEXT NOT NULL,
          label          TEXT NOT NULL,
          drawer_name    TEXT NOT NULL,
          affects_drawer INTEGER NOT NULL DEFAULT 1,
          sort_order     INTEGER NOT NULL DEFAULT 0,
          is_active      INTEGER NOT NULL DEFAULT 1,
          is_system      INTEGER NOT NULL DEFAULT 0,
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, code)
        )
      `);
      db.exec(`
        INSERT INTO payment_methods_new (id, tenant_id, code, label, drawer_name, affects_drawer, sort_order, is_active, is_system, created_at)
        SELECT id, 1, code, label, drawer_name, affects_drawer, sort_order, is_active, is_system, created_at FROM payment_methods
      `);
      db.exec(`DROP TABLE payment_methods`);
      db.exec(`ALTER TABLE payment_methods_new RENAME TO payment_methods`);

      // vouchers: code UNIQUE -> UNIQUE(tenant_id, code)
      db.exec(`
        CREATE TABLE vouchers_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          code TEXT NOT NULL,
          client_id INTEGER NOT NULL,
          client_name TEXT NOT NULL,
          client_phone TEXT,
          amount DECIMAL(10, 2) NOT NULL,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          expiry_date TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'expired', 'cancelled')),
          redeemed_at TEXT,
          redeemed_by INTEGER,
          redeemed_in_transaction TEXT,
          redeemed_transaction_id INTEGER,
          cancelled_at TEXT,
          cancelled_by INTEGER,
          note TEXT,
          created_by INTEGER NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
          FOREIGN KEY (redeemed_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE (tenant_id, code)
        )
      `);
      db.exec(`
        INSERT INTO vouchers_new (id, tenant_id, code, client_id, client_name, client_phone, amount, currency_code, expiry_date, status, redeemed_at, redeemed_by, redeemed_in_transaction, redeemed_transaction_id, cancelled_at, cancelled_by, note, created_by, created_at, updated_at)
        SELECT id, 1, code, client_id, client_name, client_phone, amount, currency_code, expiry_date, status, redeemed_at, redeemed_by, redeemed_in_transaction, redeemed_transaction_id, cancelled_at, cancelled_by, note, created_by, created_at, updated_at FROM vouchers
      `);
      db.exec(`DROP TABLE vouchers`);
      db.exec(`ALTER TABLE vouchers_new RENAME TO vouchers`);
      db.exec(`CREATE INDEX idx_vouchers_code ON vouchers(code)`);
      db.exec(`CREATE INDEX idx_vouchers_client_id ON vouchers(client_id)`);
      db.exec(`CREATE INDEX idx_vouchers_status ON vouchers(status)`);
      db.exec(`CREATE INDEX idx_vouchers_created_at ON vouchers(created_at)`);

      // system_settings: key_name UNIQUE -> UNIQUE(tenant_id, key_name)
      db.exec(`
        CREATE TABLE system_settings_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          key_name TEXT NOT NULL,
          value TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, key_name)
        )
      `);
      db.exec(`
        INSERT INTO system_settings_new (id, tenant_id, key_name, value, created_at, updated_at)
        SELECT id, 1, key_name, value, created_at, updated_at FROM system_settings
      `);
      db.exec(`DROP TABLE system_settings`);
      db.exec(`ALTER TABLE system_settings_new RENAME TO system_settings`);

      // exchange_rates: to_code UNIQUE -> UNIQUE(tenant_id, to_code)
      db.exec(`
        CREATE TABLE exchange_rates_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id   INTEGER REFERENCES tenants(id),
          to_code     TEXT    NOT NULL,
          market_rate REAL    NOT NULL,
          buy_rate    REAL    NOT NULL,
          sell_rate   REAL    NOT NULL,
          is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
          updated_at  TEXT    DEFAULT (datetime('now')),
          UNIQUE (tenant_id, to_code)
        )
      `);
      db.exec(`
        INSERT INTO exchange_rates_new (id, tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger, updated_at)
        SELECT id, 1, to_code, market_rate, buy_rate, sell_rate, is_stronger, updated_at FROM exchange_rates
      `);
      db.exec(`DROP TABLE exchange_rates`);
      db.exec(`ALTER TABLE exchange_rates_new RENAME TO exchange_rates`);

      // item_costs: UNIQUE(provider, category, item_key, currency) -> + tenant_id
      db.exec(`
        CREATE TABLE item_costs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          provider TEXT NOT NULL,
          category TEXT NOT NULL,
          item_key TEXT NOT NULL,
          cost DECIMAL(10, 2) NOT NULL,
          currency TEXT DEFAULT 'USD' NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, provider, category, item_key, currency)
        )
      `);
      db.exec(`
        INSERT INTO item_costs_new (id, tenant_id, provider, category, item_key, cost, currency, updated_at)
        SELECT id, 1, provider, category, item_key, cost, currency, updated_at FROM item_costs
      `);
      db.exec(`DROP TABLE item_costs`);
      db.exec(`ALTER TABLE item_costs_new RENAME TO item_costs`);

      // voucher_images: UNIQUE(provider, category, item_key) -> + tenant_id
      // (each tenant maintains its own image catalog)
      db.exec(`
        CREATE TABLE voucher_images_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          provider TEXT NOT NULL,
          category TEXT NOT NULL,
          item_key TEXT NOT NULL,
          image_path TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, provider, category, item_key)
        )
      `);
      db.exec(`
        INSERT INTO voucher_images_new (id, tenant_id, provider, category, item_key, image_path, created_at)
        SELECT id, 1, provider, category, item_key, image_path, created_at FROM voucher_images
      `);
      db.exec(`DROP TABLE voucher_images`);
      db.exec(`ALTER TABLE voucher_images_new RENAME TO voucher_images`);

      // mobile_service_items: UNIQUE(provider, category, subcategory, label) -> + tenant_id
      // (each tenant maintains its own catalog)
      db.exec(`
        CREATE TABLE mobile_service_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          provider TEXT NOT NULL,
          category TEXT NOT NULL,
          subcategory TEXT NOT NULL,
          label TEXT NOT NULL,
          cost_lbp REAL NOT NULL DEFAULT 0,
          sell_lbp REAL NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, provider, category, subcategory, label)
        )
      `);
      db.exec(`
        INSERT INTO mobile_service_items_new (id, tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, created_at, updated_at)
        SELECT id, 1, provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, created_at, updated_at FROM mobile_service_items
      `);
      db.exec(`DROP TABLE mobile_service_items`);
      db.exec(
        `ALTER TABLE mobile_service_items_new RENAME TO mobile_service_items`,
      );
      db.exec(
        `CREATE INDEX idx_msi_provider ON mobile_service_items(provider)`,
      );
      db.exec(
        `CREATE INDEX idx_msi_provider_category ON mobile_service_items(provider, category)`,
      );
      db.exec(`CREATE INDEX idx_msi_active ON mobile_service_items(is_active)`);

      // loto_settings: key_name TEXT PRIMARY KEY -> PRIMARY KEY (tenant_id, key_name)
      db.exec(`
        CREATE TABLE loto_settings_new (
          tenant_id INTEGER REFERENCES tenants(id),
          key_name TEXT NOT NULL,
          value TEXT NOT NULL,
          description TEXT,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (tenant_id, key_name)
        )
      `);
      db.exec(`
        INSERT INTO loto_settings_new (tenant_id, key_name, value, description, updated_at)
        SELECT 1, key_name, value, description, updated_at FROM loto_settings
      `);
      db.exec(`DROP TABLE loto_settings`);
      db.exec(`ALTER TABLE loto_settings_new RENAME TO loto_settings`);

      // drawer_balances: PRIMARY KEY (drawer_name, currency_code) -> + tenant_id
      db.exec(`
        CREATE TABLE drawer_balances_new (
          tenant_id INTEGER REFERENCES tenants(id),
          drawer_name TEXT NOT NULL,
          currency_code TEXT NOT NULL,
          balance REAL NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (tenant_id, drawer_name, currency_code)
        )
      `);
      db.exec(`
        INSERT INTO drawer_balances_new (tenant_id, drawer_name, currency_code, balance, updated_at)
        SELECT 1, drawer_name, currency_code, balance, updated_at FROM drawer_balances
      `);
      db.exec(`DROP TABLE drawer_balances`);
      db.exec(`ALTER TABLE drawer_balances_new RENAME TO drawer_balances`);
      db.exec(
        `CREATE INDEX idx_drawer_balances_drawer ON drawer_balances(drawer_name)`,
      );

      // -----------------------------------------------------------------
      // 4. Self-guard: fail loudly if the rebuild left any FK dangling.
      //    (foreign_keys enforcement is OFF during the migration batch, so
      //    this is the only thing that would catch a broken composite FK.)
      // -----------------------------------------------------------------
      const fkViolations = db.pragma("foreign_key_check") as unknown[];
      if (fkViolations.length > 0) {
        throw new Error(
          `Migration v123: foreign_key_check found ${fkViolations.length} violation(s) after rebuild: ${JSON.stringify(fkViolations)}`,
        );
      }

      console.log(
        "Migration v123: multi-tenancy foundation added (tenants table; tenant_id backfilled to 1 on 49 tables; 19 tables rebuilt with tenant-scoped constraints)",
      );
    },
    down(db: Database.Database) {
      // -----------------------------------------------------------------
      // 1. Revert rebuilt tables — children referencing modules/currencies
      //    first, then modules/currencies themselves, then the rest.
      // -----------------------------------------------------------------

      // suppliers -> drop tenant_id, restore name UNIQUE + simple FK
      db.exec(`
        CREATE TABLE suppliers_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          contact_name TEXT,
          phone TEXT,
          note TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          module_key TEXT DEFAULT NULL REFERENCES modules(key) ON DELETE SET NULL,
          provider TEXT DEFAULT NULL,
          is_system INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO suppliers_old (id, name, contact_name, phone, note, is_active, module_key, provider, is_system, created_at)
        SELECT id, name, contact_name, phone, note, is_active, module_key, provider, is_system, created_at FROM suppliers
      `);
      db.exec(`DROP TABLE suppliers`);
      db.exec(`ALTER TABLE suppliers_old RENAME TO suppliers`);

      // currency_drawers -> restore simple composite PK + FK
      db.exec(`
        CREATE TABLE currency_drawers_old (
          currency_code TEXT NOT NULL,
          drawer_name   TEXT NOT NULL,
          PRIMARY KEY (currency_code, drawer_name),
          FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE CASCADE
        )
      `);
      db.exec(`
        INSERT INTO currency_drawers_old (currency_code, drawer_name)
        SELECT currency_code, drawer_name FROM currency_drawers
      `);
      db.exec(`DROP TABLE currency_drawers`);
      db.exec(`ALTER TABLE currency_drawers_old RENAME TO currency_drawers`);

      // currency_modules -> restore simple composite PK + FKs
      db.exec(`
        CREATE TABLE currency_modules_old (
          currency_code TEXT NOT NULL,
          module_key    TEXT NOT NULL,
          PRIMARY KEY (currency_code, module_key),
          FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE CASCADE,
          FOREIGN KEY (module_key)    REFERENCES modules(key)     ON DELETE CASCADE
        )
      `);
      db.exec(`
        INSERT INTO currency_modules_old (currency_code, module_key)
        SELECT currency_code, module_key FROM currency_modules
      `);
      db.exec(`DROP TABLE currency_modules`);
      db.exec(`ALTER TABLE currency_modules_old RENAME TO currency_modules`);

      // modules -> restore key TEXT PRIMARY KEY
      db.exec(`
        CREATE TABLE modules_old (
          key         TEXT PRIMARY KEY,
          label       TEXT NOT NULL,
          icon        TEXT NOT NULL DEFAULT '',
          route       TEXT NOT NULL,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          is_enabled  INTEGER NOT NULL DEFAULT 1,
          admin_only  INTEGER NOT NULL DEFAULT 0,
          is_system   INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.exec(`
        INSERT INTO modules_old (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
        SELECT key, label, icon, route, sort_order, is_enabled, admin_only, is_system FROM modules
      `);
      db.exec(`DROP TABLE modules`);
      db.exec(`ALTER TABLE modules_old RENAME TO modules`);

      // currencies -> restore code UNIQUE
      db.exec(`
        CREATE TABLE currencies_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          symbol TEXT NOT NULL DEFAULT '',
          decimal_places INTEGER NOT NULL DEFAULT 2,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO currencies_old (id, code, name, symbol, decimal_places, is_active, created_at)
        SELECT id, code, name, symbol, decimal_places, is_active, created_at FROM currencies
      `);
      db.exec(`DROP TABLE currencies`);
      db.exec(`ALTER TABLE currencies_old RENAME TO currencies`);

      // clients -> restore phone_number UNIQUE
      db.exec(`
        CREATE TABLE clients_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          phone_number TEXT UNIQUE,
          notes TEXT,
          whatsapp_opt_in BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO clients_old (id, full_name, phone_number, notes, whatsapp_opt_in, created_at)
        SELECT id, full_name, phone_number, notes, whatsapp_opt_in, created_at FROM clients
      `);
      db.exec(`DROP TABLE clients`);
      db.exec(`ALTER TABLE clients_old RENAME TO clients`);
      db.exec(
        `CREATE INDEX idx_clients_full_name ON clients(full_name COLLATE NOCASE)`,
      );

      // products -> restore barcode UNIQUE
      db.exec(`
        CREATE TABLE products_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          barcode TEXT UNIQUE,
          name TEXT NOT NULL,
          item_type TEXT NOT NULL,
          category TEXT DEFAULT 'General',
          category_id INTEGER DEFAULT NULL REFERENCES product_categories(id) ON DELETE SET NULL,
          description TEXT,
          supplier TEXT DEFAULT NULL,
          supplier_id INTEGER DEFAULT NULL,
          unit TEXT DEFAULT NULL,
          cost_price_usd DECIMAL(10, 2) DEFAULT 0,
          selling_price_usd DECIMAL(10, 2) DEFAULT 0,
          min_stock_level INTEGER DEFAULT 5,
          stock_quantity INTEGER DEFAULT 0,
          imei TEXT,
          color TEXT,
          image_url TEXT,
          warranty_expiry DATE,
          status TEXT DEFAULT 'Active',
          is_active BOOLEAN DEFAULT 1,
          is_deleted BOOLEAN DEFAULT 0,
          updated_at DATETIME DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO products_old (id, barcode, name, item_type, category, category_id, description, supplier, supplier_id, unit, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity, imei, color, image_url, warranty_expiry, status, is_active, is_deleted, updated_at, created_at)
        SELECT id, barcode, name, item_type, category, category_id, description, supplier, supplier_id, unit, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity, imei, color, image_url, warranty_expiry, status, is_active, is_deleted, updated_at, created_at FROM products
      `);
      db.exec(`DROP TABLE products`);
      db.exec(`ALTER TABLE products_old RENAME TO products`);
      db.exec(`CREATE INDEX idx_products_barcode ON products(barcode)`);
      db.exec(`CREATE INDEX idx_products_is_active ON products(is_active)`);
      db.exec(`CREATE INDEX idx_products_category ON products(category)`);
      db.exec(`CREATE INDEX idx_products_status ON products(status)`);
      db.exec(
        `CREATE INDEX idx_products_active_category ON products(is_active, category)`,
      );
      db.exec(
        `CREATE INDEX idx_products_active_status ON products(is_active, status)`,
      );

      // product_categories -> restore name UNIQUE COLLATE NOCASE
      db.exec(`
        CREATE TABLE product_categories_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO product_categories_old (id, name, sort_order, is_active, created_at)
        SELECT id, name, sort_order, is_active, created_at FROM product_categories
      `);
      db.exec(`DROP TABLE product_categories`);
      db.exec(
        `ALTER TABLE product_categories_old RENAME TO product_categories`,
      );

      // product_suppliers -> restore name UNIQUE COLLATE NOCASE
      db.exec(`
        CREATE TABLE product_suppliers_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          supplier_id INTEGER REFERENCES suppliers(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO product_suppliers_old (id, name, sort_order, is_active, supplier_id, created_at)
        SELECT id, name, sort_order, is_active, supplier_id, created_at FROM product_suppliers
      `);
      db.exec(`DROP TABLE product_suppliers`);
      db.exec(`ALTER TABLE product_suppliers_old RENAME TO product_suppliers`);

      // partners -> restore name UNIQUE
      db.exec(`
        CREATE TABLE partners_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          phone TEXT,
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          system_association TEXT DEFAULT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO partners_old (id, name, phone, notes, is_active, system_association, created_at, updated_at)
        SELECT id, name, phone, notes, is_active, system_association, created_at, updated_at FROM partners
      `);
      db.exec(`DROP TABLE partners`);
      db.exec(`ALTER TABLE partners_old RENAME TO partners`);

      // payment_methods -> restore code UNIQUE
      db.exec(`
        CREATE TABLE payment_methods_old (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          code           TEXT NOT NULL UNIQUE,
          label          TEXT NOT NULL,
          drawer_name    TEXT NOT NULL,
          affects_drawer INTEGER NOT NULL DEFAULT 1,
          sort_order     INTEGER NOT NULL DEFAULT 0,
          is_active      INTEGER NOT NULL DEFAULT 1,
          is_system      INTEGER NOT NULL DEFAULT 0,
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO payment_methods_old (id, code, label, drawer_name, affects_drawer, sort_order, is_active, is_system, created_at)
        SELECT id, code, label, drawer_name, affects_drawer, sort_order, is_active, is_system, created_at FROM payment_methods
      `);
      db.exec(`DROP TABLE payment_methods`);
      db.exec(`ALTER TABLE payment_methods_old RENAME TO payment_methods`);

      // vouchers -> restore code UNIQUE
      db.exec(`
        CREATE TABLE vouchers_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          client_id INTEGER NOT NULL,
          client_name TEXT NOT NULL,
          client_phone TEXT,
          amount DECIMAL(10, 2) NOT NULL,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          expiry_date TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'expired', 'cancelled')),
          redeemed_at TEXT,
          redeemed_by INTEGER,
          redeemed_in_transaction TEXT,
          redeemed_transaction_id INTEGER,
          cancelled_at TEXT,
          cancelled_by INTEGER,
          note TEXT,
          created_by INTEGER NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
          FOREIGN KEY (redeemed_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
      db.exec(`
        INSERT INTO vouchers_old (id, code, client_id, client_name, client_phone, amount, currency_code, expiry_date, status, redeemed_at, redeemed_by, redeemed_in_transaction, redeemed_transaction_id, cancelled_at, cancelled_by, note, created_by, created_at, updated_at)
        SELECT id, code, client_id, client_name, client_phone, amount, currency_code, expiry_date, status, redeemed_at, redeemed_by, redeemed_in_transaction, redeemed_transaction_id, cancelled_at, cancelled_by, note, created_by, created_at, updated_at FROM vouchers
      `);
      db.exec(`DROP TABLE vouchers`);
      db.exec(`ALTER TABLE vouchers_old RENAME TO vouchers`);
      db.exec(`CREATE INDEX idx_vouchers_code ON vouchers(code)`);
      db.exec(`CREATE INDEX idx_vouchers_client_id ON vouchers(client_id)`);
      db.exec(`CREATE INDEX idx_vouchers_status ON vouchers(status)`);
      db.exec(`CREATE INDEX idx_vouchers_created_at ON vouchers(created_at)`);

      // system_settings -> restore key_name UNIQUE
      db.exec(`
        CREATE TABLE system_settings_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key_name TEXT UNIQUE NOT NULL,
          value TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO system_settings_old (id, key_name, value, created_at, updated_at)
        SELECT id, key_name, value, created_at, updated_at FROM system_settings
      `);
      db.exec(`DROP TABLE system_settings`);
      db.exec(`ALTER TABLE system_settings_old RENAME TO system_settings`);

      // exchange_rates -> restore to_code UNIQUE
      db.exec(`
        CREATE TABLE exchange_rates_old (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          to_code     TEXT    NOT NULL UNIQUE,
          market_rate REAL    NOT NULL,
          buy_rate    REAL    NOT NULL,
          sell_rate   REAL    NOT NULL,
          is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
          updated_at  TEXT    DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        INSERT INTO exchange_rates_old (id, to_code, market_rate, buy_rate, sell_rate, is_stronger, updated_at)
        SELECT id, to_code, market_rate, buy_rate, sell_rate, is_stronger, updated_at FROM exchange_rates
      `);
      db.exec(`DROP TABLE exchange_rates`);
      db.exec(`ALTER TABLE exchange_rates_old RENAME TO exchange_rates`);

      // item_costs -> restore original UNIQUE (no tenant_id)
      db.exec(`
        CREATE TABLE item_costs_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          category TEXT NOT NULL,
          item_key TEXT NOT NULL,
          cost DECIMAL(10, 2) NOT NULL,
          currency TEXT DEFAULT 'USD' NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(provider, category, item_key, currency)
        )
      `);
      db.exec(`
        INSERT INTO item_costs_old (id, provider, category, item_key, cost, currency, updated_at)
        SELECT id, provider, category, item_key, cost, currency, updated_at FROM item_costs
      `);
      db.exec(`DROP TABLE item_costs`);
      db.exec(`ALTER TABLE item_costs_old RENAME TO item_costs`);

      // voucher_images -> restore original UNIQUE (no tenant_id)
      db.exec(`
        CREATE TABLE voucher_images_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          category TEXT NOT NULL,
          item_key TEXT NOT NULL,
          image_path TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(provider, category, item_key)
        )
      `);
      db.exec(`
        INSERT INTO voucher_images_old (id, provider, category, item_key, image_path, created_at)
        SELECT id, provider, category, item_key, image_path, created_at FROM voucher_images
      `);
      db.exec(`DROP TABLE voucher_images`);
      db.exec(`ALTER TABLE voucher_images_old RENAME TO voucher_images`);

      // mobile_service_items -> restore original UNIQUE (no tenant_id)
      db.exec(`
        CREATE TABLE mobile_service_items_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          category TEXT NOT NULL,
          subcategory TEXT NOT NULL,
          label TEXT NOT NULL,
          cost_lbp REAL NOT NULL DEFAULT 0,
          sell_lbp REAL NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(provider, category, subcategory, label)
        )
      `);
      db.exec(`
        INSERT INTO mobile_service_items_old (id, provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, created_at, updated_at)
        SELECT id, provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, created_at, updated_at FROM mobile_service_items
      `);
      db.exec(`DROP TABLE mobile_service_items`);
      db.exec(
        `ALTER TABLE mobile_service_items_old RENAME TO mobile_service_items`,
      );
      db.exec(
        `CREATE INDEX idx_msi_provider ON mobile_service_items(provider)`,
      );
      db.exec(
        `CREATE INDEX idx_msi_provider_category ON mobile_service_items(provider, category)`,
      );
      db.exec(`CREATE INDEX idx_msi_active ON mobile_service_items(is_active)`);

      // loto_settings -> restore key_name TEXT PRIMARY KEY
      db.exec(`
        CREATE TABLE loto_settings_old (
          key_name TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          description TEXT,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO loto_settings_old (key_name, value, description, updated_at)
        SELECT key_name, value, description, updated_at FROM loto_settings
      `);
      db.exec(`DROP TABLE loto_settings`);
      db.exec(`ALTER TABLE loto_settings_old RENAME TO loto_settings`);

      // drawer_balances -> restore PRIMARY KEY (drawer_name, currency_code)
      db.exec(`
        CREATE TABLE drawer_balances_old (
          drawer_name TEXT NOT NULL,
          currency_code TEXT NOT NULL,
          balance REAL NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (drawer_name, currency_code)
        )
      `);
      db.exec(`
        INSERT INTO drawer_balances_old (drawer_name, currency_code, balance, updated_at)
        SELECT drawer_name, currency_code, balance, updated_at FROM drawer_balances
      `);
      db.exec(`DROP TABLE drawer_balances`);
      db.exec(`ALTER TABLE drawer_balances_old RENAME TO drawer_balances`);
      db.exec(
        `CREATE INDEX idx_drawer_balances_drawer ON drawer_balances(drawer_name)`,
      );

      // -----------------------------------------------------------------
      // 2. Drop tenant_id indexes, then tenant_id columns, on the
      //    ALTER-only tables (SQLite refuses to drop an indexed column).
      // -----------------------------------------------------------------
      const alterOnlyIndexedTables = [
        "transactions",
        "sales",
        "sale_items",
        "payments",
        "debt_ledger",
        "financial_services",
        "recharges",
        "exchange_transactions",
        "expenses",
        "audit_log",
        "loto_tickets",
        "customer_sessions",
        "custom_services",
        "maintenance",
      ];
      for (const table of alterOnlyIndexedTables) {
        db.exec(`DROP INDEX idx_${table}_tenant_id`);
      }

      // audit_log also loses impersonator_id
      db.exec(`ALTER TABLE audit_log DROP COLUMN impersonator_id`);

      const alterOnlyTables = [
        "transactions",
        "sales",
        "sale_items",
        "debt_ledger",
        "customer_sessions",
        "customer_session_transactions",
        "session_cart_items",
        "supplier_ledger",
        "supplier_purchases",
        "maintenance",
        "expenses",
        "recharges",
        "exchange_transactions",
        "financial_services",
        "partner_ledger",
        "custom_services",
        "payments",
        "drawer_topups",
        "daily_closings",
        "daily_closing_amounts",
        "loto_tickets",
        "loto_monthly_fees",
        "loto_checkpoints",
        "loto_cash_prizes",
        "loto_settlements",
        "hold_money",
        "audit_log",
        "users",
        "sessions",
        "service_presets",
      ];
      for (const table of alterOnlyTables) {
        db.exec(`ALTER TABLE ${table} DROP COLUMN tenant_id`);
      }

      // -----------------------------------------------------------------
      // 3. Drop the tenants table itself.
      // -----------------------------------------------------------------
      db.exec(`DROP TABLE IF EXISTS tenants`);

      console.log(
        "Migration v123 rolled back: multi-tenancy foundation removed (tenants table dropped, tenant_id removed from all 49 tables, rebuilt tables restored to their original constraints)",
      );
    },
  },
  {
    version: 124,
    name: "name_home_tenant_from_shop",
    description:
      "Cosmetic: rename the v123 backfill tenant (id 1, seeded as 'Default') to the shop's own name from system_settings.shop_name, so the admin panel shows e.g. 'CornerTech' instead of 'Default'. Guarded — fires ONLY when the tenant is still literally named 'Default' AND a non-empty shop_name exists; a no-op otherwise (already renamed by the operator, or no shop name recorded yet). Fresh installs name the tenant at setup:complete instead (the wizard writes shop_name after this migration has already run).",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        UPDATE tenants
        SET name = (
          SELECT value FROM system_settings
          WHERE key_name = 'shop_name' AND tenant_id = 1
        )
        WHERE id = 1
          AND name = 'Default'
          AND EXISTS (
            SELECT 1 FROM system_settings
            WHERE key_name = 'shop_name' AND tenant_id = 1
              AND value IS NOT NULL AND TRIM(value) <> ''
          )
      `);
      console.log(
        "Migration v124: home tenant (id 1) named from shop_name where it was still 'Default'",
      );
    },
    down(db: Database.Database) {
      // Cosmetic rename only — no schema to revert. Best-effort restore of the
      // generic 'Default' label on the home tenant.
      db.exec(`UPDATE tenants SET name = 'Default' WHERE id = 1`);
      console.log(
        "Migration v124 rolled back: home tenant name reset to 'Default'",
      );
    },
  },
  {
    version: 125,
    name: "add_allow_out_of_stock_sales_setting",
    description:
      "Add the per-shop 'allow_out_of_stock_sales' setting. Existing shops are set to '1' (allow) so the stock-oversell guard does not suddenly block shops that don't track stock; fresh installs default to '0' (enforce) via create_db.sql. Applied to every existing tenant.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const res = db
        .prepare(
          `INSERT OR IGNORE INTO system_settings (tenant_id, key_name, value)
           SELECT id, 'allow_out_of_stock_sales', '1' FROM tenants`,
        )
        .run();
      console.log(
        `Migration v125: allow_out_of_stock_sales='1' set for ${res.changes} existing tenant(s)`,
      );
    },
    down(db: Database.Database) {
      db.exec(
        `DELETE FROM system_settings WHERE key_name = 'allow_out_of_stock_sales'`,
      );
      console.log(
        "Migration v125 rolled back: allow_out_of_stock_sales removed",
      );
    },
  },
  {
    version: 126,
    name: "zero_sale_txn_amount_lbp_tender_dup",
    description:
      "Data repair: SALE unified-transaction rows stamped the LBP TENDER (payment_lbp) into amount_lbp alongside the sale's USD value in amount_usd, and item-REFUND rows stamped the refund's LBP conversion — so LBP-paid sales double-counted ('$5 + 450,000 LBP' in the audit view; revenue_lbp inflated in profit/session reports). The tender already lives in the payments legs. Zero amount_lbp on sales-sourced SALE/REFUND rows. Guarded on amount_usd != 0 so any legacy row whose only value is LBP is left untouched. Irreversible (the dropped LBP figure is redundant — it remains derivable from the payments legs), hence a no-op down().",
    type: "typescript" as const,
    up(db: Database.Database) {
      const res = db
        .prepare(
          `UPDATE transactions
           SET amount_lbp = 0
           WHERE source_table = 'sales'
             AND type IN ('SALE', 'REFUND')
             AND amount_lbp != 0
             AND amount_usd != 0`,
        )
        .run();
      console.log(
        `Migration v126: cleared duplicated LBP tender on ${res.changes} sales transaction row(s)`,
      );
    },
    down(_db: Database.Database) {
      // Data repair of redundant (double-counted) figures — nothing to restore;
      // the tender is still recorded in the payments legs.
      console.log("Migration v126 rolled back: no-op (data repair)");
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v127 — Drop the partner_ledger.transaction_type CHECK (PFT-1, schema-only)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 127,
    name: "drop_partner_ledger_type_check",
    description:
      "Drop the fixed enum CHECK on partner_ledger.transaction_type so future Partner-FOR-Transaction types (FOR_BINANCE_* etc.) can be inserted without another table rebuild. SQLite can't ALTER a CHECK, so the table is recreated preserving all rows + both indexes — mirrors migrations v83/v98. The direction and settlement_method CHECKs are unchanged. Schema-only: no new transaction_type values are written by this migration.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE partner_ledger_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER REFERENCES tenants(id),
            partner_id INTEGER NOT NULL REFERENCES partners(id),
            transaction_type TEXT NOT NULL,
            reference_table TEXT,
            reference_id INTEGER,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
            notes TEXT,
            user_id INTEGER REFERENCES users(id),
            settlement_method TEXT CHECK(settlement_method IN ('CASH', 'OMT', 'WHISH', 'BINANCE', 'CLIENT_ACCOUNT')),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO partner_ledger_new (id, tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at)
        SELECT id, tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at
        FROM partner_ledger;

        DROP TABLE partner_ledger;
        ALTER TABLE partner_ledger_new RENAME TO partner_ledger;

        CREATE INDEX IF NOT EXISTS idx_partner_ledger_partner_id ON partner_ledger(partner_id);
        CREATE INDEX IF NOT EXISTS idx_partner_ledger_created_at ON partner_ledger(created_at);
      `);
      console.log(
        "Migration v127: dropped transaction_type CHECK on partner_ledger",
      );
    },
    down(db: Database.Database) {
      db.exec(`
        CREATE TABLE partner_ledger_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER REFERENCES tenants(id),
            partner_id INTEGER NOT NULL REFERENCES partners(id),
            transaction_type TEXT NOT NULL CHECK(transaction_type IN ('OMT_SEND', 'OMT_RECEIVE', 'WHISH_SEND', 'WHISH_RECEIVE', 'THROUGH_OMT_SEND', 'THROUGH_OMT_RECEIVE', 'THROUGH_WHISH_SEND', 'THROUGH_WHISH_RECEIVE', 'FOR_OMT_SEND', 'FOR_OMT_RECEIVE', 'FOR_WHISH_SEND', 'FOR_WHISH_RECEIVE', 'WHISH_TOPUP', 'CUSTOM_SERVICE', 'SETTLEMENT', 'ADJUSTMENT')),
            reference_table TEXT,
            reference_id INTEGER,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
            notes TEXT,
            user_id INTEGER REFERENCES users(id),
            settlement_method TEXT CHECK(settlement_method IN ('CASH', 'OMT', 'WHISH', 'BINANCE', 'CLIENT_ACCOUNT')),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO partner_ledger_new (id, tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at)
        SELECT id, tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at
        FROM partner_ledger;

        DROP TABLE partner_ledger;
        ALTER TABLE partner_ledger_new RENAME TO partner_ledger;

        CREATE INDEX IF NOT EXISTS idx_partner_ledger_partner_id ON partner_ledger(partner_id);
        CREATE INDEX IF NOT EXISTS idx_partner_ledger_created_at ON partner_ledger(created_at);
      `);
      console.log(
        "Migration v127 rolled back: restored transaction_type CHECK on partner_ledger",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v128 — partner_ledger.covered_amount (PFT-6 settlement→profit recognition)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 128,
    name: "add_partner_ledger_covered_amount",
    description:
      "Add covered_amount (REAL, default 0) to partner_ledger. Settlements/manual adjustments apply FIFO coverage to the partner's opposite-direction FOR_% rows; profit queries treat a source transaction as realized only when its FOR_% rows are fully covered (owner decision: for-partner profit is real when the partner settles). Plain constant default — safe on live DBs; fresh installs get the column from create_db.sql.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db
        .prepare(`PRAGMA table_info(partner_ledger)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "covered_amount")) {
        db.exec(
          `ALTER TABLE partner_ledger ADD COLUMN covered_amount REAL NOT NULL DEFAULT 0`,
        );
      }
      console.log("Migration v128: partner_ledger.covered_amount added");
    },
    down(db: Database.Database) {
      const cols = db
        .prepare(`PRAGMA table_info(partner_ledger)`)
        .all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === "covered_amount")) {
        db.exec(`ALTER TABLE partner_ledger DROP COLUMN covered_amount`);
      }
      console.log(
        "Migration v128 rolled back: partner_ledger.covered_amount dropped",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v129 — debt_ledger.covered_usd/covered_lbp (DBT-1 client-account profit)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 129,
    name: "add_debt_ledger_covered_amounts",
    description:
      "Add covered_usd/covered_lbp (REAL, default 0) to debt_ledger. Repayments FIFO-cover the client's module-debt charge rows (Recharge/Service/Custom Service/Loto/Maintenance Debt) with whatever remains after sales absorb via _markSalesPaidFIFO; profit queries treat an account-charged service as realized only when its charge row is fully covered (owner decision 2026-07-14: client-account service profit waits until repaid, like products and partners). Plain constant defaults — safe on live DBs; fresh installs get the columns from create_db.sql.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db.prepare(`PRAGMA table_info(debt_ledger)`).all() as Array<{
        name: string;
      }>;
      if (!cols.some((c) => c.name === "covered_usd")) {
        db.exec(
          `ALTER TABLE debt_ledger ADD COLUMN covered_usd REAL NOT NULL DEFAULT 0`,
        );
      }
      if (!cols.some((c) => c.name === "covered_lbp")) {
        db.exec(
          `ALTER TABLE debt_ledger ADD COLUMN covered_lbp REAL NOT NULL DEFAULT 0`,
        );
      }
      console.log("Migration v129: debt_ledger.covered_usd/covered_lbp added");
    },
    down(db: Database.Database) {
      const cols = db.prepare(`PRAGMA table_info(debt_ledger)`).all() as Array<{
        name: string;
      }>;
      if (cols.some((c) => c.name === "covered_usd")) {
        db.exec(`ALTER TABLE debt_ledger DROP COLUMN covered_usd`);
      }
      if (cols.some((c) => c.name === "covered_lbp")) {
        db.exec(`ALTER TABLE debt_ledger DROP COLUMN covered_lbp`);
      }
      console.log(
        "Migration v129 rolled back: debt_ledger covered columns dropped",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v130 — backfill metadata.is_auto on historical SUPPLIER_PAYMENT rows (CQ-8)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 130,
    name: "backfill_supplier_payment_is_auto_metadata",
    description:
      "Data-only backfill: stamp top-level metadata_json.is_auto = true on historical SUPPLIER_PAYMENT transactions whose linked supplier_ledger row (source_table='supplier_ledger', source_id=ledger id) has is_auto=1. Feeds owner decision D2 (manual supplier payments visible on the Transactions page by default, auto-generated sibling rows stay behind the filter) — without this backfill, pre-CQ-8 auto rows would show up as if they were manual. Pure UPDATE, no ALTER — safe on both fresh and prod DBs; fresh installs have no historical rows to touch. Idempotent: json_set-ing the same key to the same value twice is a no-op the second time.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const result = db
        .prepare(
          `UPDATE transactions
           SET metadata_json = json_set(
             CASE
               WHEN metadata_json IS NULL THEN '{}'
               WHEN json_valid(metadata_json) = 0 THEN '{}'
               ELSE metadata_json
             END,
             '$.is_auto', json('true')
           )
           WHERE type = 'SUPPLIER_PAYMENT'
             AND source_table = 'supplier_ledger'
             AND EXISTS (
               SELECT 1 FROM supplier_ledger sl
               WHERE sl.id = transactions.source_id
                 AND sl.tenant_id = transactions.tenant_id
                 AND sl.is_auto = 1
             )`,
        )
        .run();
      console.log(
        `Migration v130: backfilled is_auto metadata on ${result.changes} historical SUPPLIER_PAYMENT transaction(s)`,
      );
    },
    down(db: Database.Database) {
      // Data-only backfill: no down migration. Removing the is_auto key would
      // be lossy-safe (it's re-derivable from supplier_ledger.is_auto by
      // re-running up()) but serves no purpose — nothing depends on the key
      // being ABSENT, only on it being present-and-true for auto rows.
      void db;
      console.log(
        "Migration v130: no-op rollback (data-only backfill, re-derivable from supplier_ledger.is_auto)",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v131 — Add 'DISCOUNT' to supplier_ledger.entry_type CHECK (CQ-10)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 131,
    name: "add_discount_entry_type_supplier_ledger",
    description:
      "Add 'DISCOUNT' to the supplier_ledger.entry_type CHECK so a supplier forgiving part of what the shop owes (CQ-10) posts a first-class ledger row instead of being crammed into ADJUSTMENT/PAYMENT. Unlike partner_ledger (v127, which DROPPED its CHECK in favor of free-form + TS-union/guard enforcement), supplier_ledger keeps a strict enum here — it's a small, stable, non-templated set of entry types (unlike partner's many composed FOR_%/THROUGH_% literals), so widening the CHECK preserves the existing strictness with the least change. SQLite can't ALTER a CHECK, so the table is recreated preserving all rows + the index — mirrors migrations v83/v98/v99/v127's 12-step rebuild pattern.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE supplier_ledger_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US', 'DISCOUNT')),
          amount_usd REAL NOT NULL DEFAULT 0,
          amount_lbp REAL NOT NULL DEFAULT 0,
          note TEXT,
          created_by INTEGER,
          transaction_id INTEGER,
          is_auto INTEGER NOT NULL DEFAULT 0,
          is_refunded INTEGER NOT NULL DEFAULT 0,
          refunded_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );

        INSERT INTO supplier_ledger_new (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, is_refunded, refunded_at, created_at)
        SELECT id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, is_refunded, refunded_at, created_at
        FROM supplier_ledger;

        DROP TABLE supplier_ledger;
        ALTER TABLE supplier_ledger_new RENAME TO supplier_ledger;

        CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
      `);
      console.log(
        "Migration v131: added 'DISCOUNT' to supplier_ledger.entry_type",
      );
    },
    down(db: Database.Database) {
      // Relabel DISCOUNT rows to ADJUSTMENT first (closest pre-existing
      // meaning: a manual balance correction) — the old CHECK would reject
      // them mid-rebuild otherwise, same pattern as v99's down().
      db.exec(`
        UPDATE supplier_ledger SET entry_type = 'ADJUSTMENT' WHERE entry_type = 'DISCOUNT';

        CREATE TABLE supplier_ledger_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          supplier_id INTEGER NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US')),
          amount_usd REAL NOT NULL DEFAULT 0,
          amount_lbp REAL NOT NULL DEFAULT 0,
          note TEXT,
          created_by INTEGER,
          transaction_id INTEGER,
          is_auto INTEGER NOT NULL DEFAULT 0,
          is_refunded INTEGER NOT NULL DEFAULT 0,
          refunded_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );

        INSERT INTO supplier_ledger_old (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, is_refunded, refunded_at, created_at)
        SELECT id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, is_refunded, refunded_at, created_at
        FROM supplier_ledger;

        DROP TABLE supplier_ledger;
        ALTER TABLE supplier_ledger_old RENAME TO supplier_ledger;

        CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
      `);
      console.log(
        "Migration v131 rolled back: removed 'DISCOUNT' from supplier_ledger.entry_type (relabeled existing rows to ADJUSTMENT)",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v132 — stock_adjustments audit trail (LIRA-077)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 132,
    name: "add_stock_adjustments_table",
    description:
      "Add stock_adjustments — the audit trail for manual stock corrections made via InventoryService.adjustStock (set-absolute) / adjustStockDelta (increment/decrement). Every row is written by ProductRepository in the SAME db transaction as the products.stock_quantity UPDATE (rule 13/20 discipline: a mid-failure can never leave one without the other). reason is NOT NULL — every manual correction must be justified. product_id CASCADEs (deleting a product drops its adjustment history with it); user_id SET NULLs (deleting a user keeps the historical row, just anonymizes who made it). New table — CREATE TABLE defaults are safe (no ALTER-with-CURRENT_TIMESTAMP prod-brick risk, v104 lesson).",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS stock_adjustments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          delta INTEGER NOT NULL,
          old_quantity INTEGER NOT NULL,
          new_quantity INTEGER NOT NULL,
          reason TEXT NOT NULL,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product_id ON stock_adjustments(product_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_stock_adjustments_created_at ON stock_adjustments(created_at)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_stock_adjustments_tenant_id ON stock_adjustments(tenant_id)`,
      );
      console.log(
        "Migration v132: stock_adjustments table created (LIRA-077 audit trail)",
      );
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS stock_adjustments`);
      console.log(
        "Migration v132 rolled back: stock_adjustments table dropped",
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v133 — delete phantom wallet-provider supplier ledger entries (Fix B)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 133,
    name: "delete_wallet_provider_phantom_ledger",
    description:
      "OMT_APP / WHISH_APP / BINANCE are prepaid wallets the shop owns balance in — a transfer consumes/grows the wallet drawer and creates NO supplier debt in either direction (owner-confirmed 2026-07-19). The auto supplier-ledger block nonetheless booked TOP_UP ('we owe them') on every SEND and PAYMENT ('they owe us') on every RECEIVE whenever a supplier row for the provider existed — which production seeds ('OMT App'/'Whish App'). Those phantom rows corrupted the app suppliers' balances and the page's Total Owed tiles. Deletes exactly the auto transfer rows (is_auto=1, entry_type TOP_UP/PAYMENT) for wallet-provider suppliers; manual entries (is_auto=0), BILL commissions (SUPPLIER_PAYS_US), and legacy cost-flow SALE_COST rows are untouched. Safe to delete rather than soft-flag: each row is 1:1 re-derivable from its financial_services transfer (down() reconstructs them).",
    type: "typescript" as const,
    up(db: Database.Database) {
      const res = db
        .prepare(
          `DELETE FROM supplier_ledger
            WHERE is_auto = 1
              AND entry_type IN ('TOP_UP', 'PAYMENT')
              AND supplier_id IN (
                SELECT id FROM suppliers
                 WHERE provider IN ('OMT_APP', 'WHISH_APP', 'BINANCE')
              )`,
        )
        .run();
      console.log(
        `Migration v133: deleted ${res.changes} phantom wallet-provider supplier ledger entries`,
      );
    },
    down(db: Database.Database) {
      // Best-effort inverse: re-book one auto entry per wallet-provider
      // transfer row, exactly as the pre-fix code did (SEND → TOP_UP +amount,
      // RECEIVE → PAYMENT −amount, service currency column only; cost-flow
      // SEND rows excluded — they never booked a transfer entry). Notes lose
      // any original [item_key] suffix; created_at is restored from the
      // financial_services row.
      const res = db
        .prepare(
          `INSERT INTO supplier_ledger
             (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, is_auto, created_at)
           SELECT
             fs.tenant_id,
             s.id,
             CASE WHEN fs.service_type = 'RECEIVE' THEN 'PAYMENT' ELSE 'TOP_UP' END,
             CASE WHEN fs.currency = 'USD'
                  THEN CASE WHEN fs.service_type = 'RECEIVE' THEN -ABS(fs.amount) ELSE ABS(fs.amount) END
                  ELSE 0 END,
             CASE WHEN fs.currency = 'LBP'
                  THEN CASE WHEN fs.service_type = 'RECEIVE' THEN -ABS(fs.amount) ELSE ABS(fs.amount) END
                  ELSE 0 END,
             'Auto: ' || fs.service_type || ' via ' || fs.provider,
             fs.created_by,
             1,
             fs.created_at
           FROM financial_services fs
           JOIN suppliers s
             ON s.provider = fs.provider AND s.tenant_id = fs.tenant_id AND s.is_active = 1
           WHERE fs.provider IN ('OMT_APP', 'WHISH_APP', 'BINANCE')
             AND fs.service_type IN ('SEND', 'RECEIVE')
             AND NOT (fs.service_type = 'SEND' AND fs.cost > 0)`,
        )
        .run();
      console.log(
        `Migration v133 rolled back: re-booked ${res.changes} wallet-provider auto ledger entries`,
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v134 — true-up under-booked OMT/WHISH SEND supplier debt (Fix C repair)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 134,
    name: "trueup_omt_whish_send_ledger_fee",
    description:
      "The short-lived original C3 booked the auto TOP_UP for an OMT/WHISH system SEND at the bare transfer amount. Owner-confirmed model (2026-07-19): the shop owes the provider amount + fee (it collected both on the provider's behalf; its cut is the commission, netted at settlement) — the revised code books the gross. This repairs rows written by C3-era builds: for every UNSETTLED (settlement_id IS NULL) OMT/WHISH SEND with a provider fee, the matching auto TOP_UP (same supplier, service-currency amount equal to the BARE transfer, created within 2s) gets the fee added. The bare-amount equality is the guard: pre-C3 rows already include the fee and never match, so the repair is idempotent and no-ops on databases that never ran a C3 build. Already-settled rows are deliberately untouched — their ledger netted at the bare amount; the real-world underpayment to the provider is a reconciliation matter, not a DB repair.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const rows = db
        .prepare(
          `SELECT fs.id, fs.tenant_id, fs.provider, fs.currency, fs.created_at,
                  ABS(fs.amount) AS bare,
                  COALESCE(CASE WHEN fs.provider = 'OMT' THEN fs.omt_fee ELSE fs.whish_fee END, 0) AS fee,
                  s.id AS supplier_id
             FROM financial_services fs
             JOIN suppliers s
               ON s.provider = fs.provider AND s.tenant_id = fs.tenant_id
            WHERE fs.provider IN ('OMT', 'WHISH')
              AND fs.service_type = 'SEND'
              AND fs.settlement_id IS NULL
              AND COALESCE(CASE WHEN fs.provider = 'OMT' THEN fs.omt_fee ELSE fs.whish_fee END, 0) > 0
            ORDER BY fs.id`,
        )
        .all() as Array<{
        id: number;
        tenant_id: number;
        currency: string;
        created_at: string;
        bare: number;
        fee: number;
        supplier_id: number;
      }>;

      const findMatch = db.prepare(
        `SELECT id FROM supplier_ledger
          WHERE supplier_id = ?
            AND is_auto = 1
            AND entry_type = 'TOP_UP'
            AND ABS((CASE WHEN ? = 'LBP' THEN amount_lbp ELSE amount_usd END) - ?) < 0.005
            AND ABS(julianday(created_at) - julianday(?)) * 86400.0 <= 2.0
            AND id NOT IN (SELECT value FROM json_each(?))
          ORDER BY id LIMIT 1`,
      );
      const addFeeUsd = db.prepare(
        `UPDATE supplier_ledger SET amount_usd = amount_usd + ? WHERE id = ?`,
      );
      const addFeeLbp = db.prepare(
        `UPDATE supplier_ledger SET amount_lbp = amount_lbp + ? WHERE id = ?`,
      );

      const consumed: number[] = [];
      let repaired = 0;
      for (const r of rows) {
        const match = findMatch.get(
          r.supplier_id,
          r.currency,
          r.bare,
          r.created_at,
          JSON.stringify(consumed),
        ) as { id: number } | undefined;
        if (!match) continue; // pre-C3 row (already gross) or manual cleanup
        if (r.currency === "LBP") addFeeLbp.run(r.fee, match.id);
        else addFeeUsd.run(r.fee, match.id);
        consumed.push(match.id);
        repaired++;
      }
      console.log(
        `Migration v134: trued-up ${repaired}/${rows.length} unsettled OMT/WHISH SEND ledger entries (+fee)`,
      );
    },
    down(db: Database.Database) {
      // Inverse heuristic: subtract the fee from entries that now match the
      // GROSS (bare + fee) for the same unsettled SEND rows.
      const rows = db
        .prepare(
          `SELECT fs.id, fs.currency, fs.created_at,
                  ABS(fs.amount) AS bare,
                  COALESCE(CASE WHEN fs.provider = 'OMT' THEN fs.omt_fee ELSE fs.whish_fee END, 0) AS fee,
                  s.id AS supplier_id
             FROM financial_services fs
             JOIN suppliers s
               ON s.provider = fs.provider AND s.tenant_id = fs.tenant_id
            WHERE fs.provider IN ('OMT', 'WHISH')
              AND fs.service_type = 'SEND'
              AND fs.settlement_id IS NULL
              AND COALESCE(CASE WHEN fs.provider = 'OMT' THEN fs.omt_fee ELSE fs.whish_fee END, 0) > 0
            ORDER BY fs.id`,
        )
        .all() as Array<{
        id: number;
        currency: string;
        created_at: string;
        bare: number;
        fee: number;
        supplier_id: number;
      }>;

      const findMatch = db.prepare(
        `SELECT id FROM supplier_ledger
          WHERE supplier_id = ?
            AND is_auto = 1
            AND entry_type = 'TOP_UP'
            AND ABS((CASE WHEN ? = 'LBP' THEN amount_lbp ELSE amount_usd END) - ?) < 0.005
            AND ABS(julianday(created_at) - julianday(?)) * 86400.0 <= 2.0
            AND id NOT IN (SELECT value FROM json_each(?))
          ORDER BY id LIMIT 1`,
      );
      const subFeeUsd = db.prepare(
        `UPDATE supplier_ledger SET amount_usd = amount_usd - ? WHERE id = ?`,
      );
      const subFeeLbp = db.prepare(
        `UPDATE supplier_ledger SET amount_lbp = amount_lbp - ? WHERE id = ?`,
      );

      const consumed: number[] = [];
      let reverted = 0;
      for (const r of rows) {
        const match = findMatch.get(
          r.supplier_id,
          r.currency,
          r.bare + r.fee,
          r.created_at,
          JSON.stringify(consumed),
        ) as { id: number } | undefined;
        if (!match) continue;
        if (r.currency === "LBP") subFeeLbp.run(r.fee, match.id);
        else subFeeUsd.run(r.fee, match.id);
        consumed.push(match.id);
        reverted++;
      }
      console.log(
        `Migration v134 rolled back: removed the fee from ${reverted} entries`,
      );
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // v135 — carrier_lines (shop SIM tracking) + mobile_service_items validity/credits
  // ─────────────────────────────────────────────────────────────────────────────
  {
    version: 135,
    name: "add_carrier_lines_and_mobile_item_validity",
    description:
      "LIRA W6 (owner ask 2026-07-19, informational only — no drawer legs, no checkout/closing involvement): (a) new `carrier_lines` table so the shop can track its own alfa/mtc SIM numbers' remaining credits + validity expiry date (days-remaining is DERIVED from the stored date at render time — a stored day-count would go stale daily); (b) `mobile_service_items` gains nullable `validity_days` (INTEGER) and `credits` (REAL) — plain nullable ALTERs, no CURRENT_TIMESTAMP defaults (v104 prod-brick lesson: this is a column add on an EXISTING table, unlike v132's new-table CREATE). Folds in W2's pending iPick mtc Prepaid rename (LIRA-072 follow-up): the OLD verbose labels ('10 days 3.79$', 'credit only 1$', …) encoded validity/credit information that the card-face-value rename (mirroring v117/118) would otherwise strip, so THIS migration backfills validity_days/credits from the old label BEFORE renaming it, scoped exactly like v117 (provider='iPick' AND category='mtc' AND subcategory='Prepaid'). It also stamps the SAME structured values onto Katsh/WHISH_APP mtc Prepaid rows wherever their (already v117-renamed) label matches one of these shared card face values — those two providers resell the identical physical cards, so the face value alone identifies the validity/credit meaning. Fresh installs never carry the old verbose labels (the static catalog + seed path were already renamed by W2 before this shipped) — for those, `frontend/src/data/mobileServices.ts` carries the same validity_days/credits directly so seeding populates the columns without this backfill ever matching a row; this migration exists for upgrades of already-seeded shops.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // ---------------------------------------------------------------------
      // (a) carrier_lines — shop-owned SIM lines per carrier
      // ---------------------------------------------------------------------
      db.exec(`
        CREATE TABLE IF NOT EXISTS carrier_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          carrier TEXT NOT NULL CHECK(carrier IN ('alfa', 'mtc')),
          phone_number TEXT NOT NULL,
          label TEXT,
          credits REAL NOT NULL DEFAULT 0,
          validity_expires_at TEXT,
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_carrier_lines_carrier ON carrier_lines(carrier)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_carrier_lines_tenant_id ON carrier_lines(tenant_id)`,
      );

      // ---------------------------------------------------------------------
      // (b) mobile_service_items — structured validity/credits columns
      // ---------------------------------------------------------------------
      db.exec(
        `ALTER TABLE mobile_service_items ADD COLUMN validity_days INTEGER`,
      );
      db.exec(`ALTER TABLE mobile_service_items ADD COLUMN credits REAL`);

      // ---------------------------------------------------------------------
      // (c) iPick mtc Prepaid: backfill validity_days/credits from the OLD
      // verbose label, then rename to the card face value in the SAME row
      // write (the rename this migration performs mirrors v117/118's A1
      // card-face-value convention, applied to iPick per LIRA-072 follow-up).
      // Old label -> [newLabel, validity_days, credits].
      // ---------------------------------------------------------------------
      const IPICK_PREPAID_RENAMES: Array<
        [string, string, number | null, number | null]
      > = [
        ["credit only 1$", "1", null, 1],
        ["credit only 1.67$", "1.67", null, 1.67],
        ["10 days 3.79$", "3.79", 10, null],
        ["30 days 4.5$", "4.5", 30, null],
        ["30 days 7.58$", "7.58", 30, null],
        ["30 days 10$", "10", 30, null],
        ["60 days 15.15$", "15.15", 60, null],
        ["90 days 22.73$", "22.73", 90, null],
        ["365 days 77.28$", "77.28", 365, null],
        ["start 4.5$", "start", null, null],
      ];
      const renameIPickStmt = db.prepare(`
        UPDATE mobile_service_items
           SET label = ?, validity_days = ?, credits = ?, updated_at = CURRENT_TIMESTAMP
         WHERE provider = 'iPick' AND category = 'mtc' AND subcategory = 'Prepaid'
           AND label = ?
      `);
      let renamed = 0;
      for (const [
        oldLabel,
        newLabel,
        validityDays,
        credits,
      ] of IPICK_PREPAID_RENAMES) {
        renamed += renameIPickStmt.run(
          newLabel,
          validityDays,
          credits,
          oldLabel,
        ).changes;
      }

      // ---------------------------------------------------------------------
      // (d) Stamp validity_days/credits by the shared card-face-value LABEL
      // for every mtc Prepaid row (iPick/Katsh/WHISH_APP) that is already on
      // the new label — covers (i) iPick rows seeded post-W2-rename (never
      // had the old verbose label to match step (c)), and (ii) Katsh/
      // WHISH_APP rows v117 already renamed to these same face values. Only
      // fills rows that don't already carry a value (idempotent / leaves any
      // manual edit alone).
      // ---------------------------------------------------------------------
      const FACE_VALUE_META: Array<[string, number | null, number | null]> = [
        ["1", null, 1],
        ["1.67", null, 1.67],
        ["3.79", 10, null],
        ["4.5", 30, null],
        ["7.58", 30, null],
        ["10", 30, null],
        ["15.15", 60, null],
        ["22.73", 90, null],
        ["77.28", 365, null],
      ];
      const stampStmt = db.prepare(`
        UPDATE mobile_service_items
           SET validity_days = ?, credits = ?, updated_at = CURRENT_TIMESTAMP
         WHERE provider IN ('iPick', 'Katsh', 'WHISH_APP')
           AND category = 'mtc' AND subcategory = 'Prepaid'
           AND label = ?
           AND validity_days IS NULL AND credits IS NULL
      `);
      let stamped = 0;
      for (const [label, validityDays, credits] of FACE_VALUE_META) {
        stamped += stampStmt.run(validityDays, credits, label).changes;
      }

      console.log(
        `Migration v135: carrier_lines table created; renamed ${renamed} iPick mtc Prepaid item(s); stamped validity/credits on ${stamped} mtc Prepaid row(s) (iPick/Katsh/WHISH_APP)`,
      );
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS carrier_lines`);

      // Best-effort inverse of the iPick rename (validity_days/credits are
      // left as-is — SQLite DROP COLUMN is intentionally not used here,
      // matching this file's prevailing down() convention of leaving added
      // nullable columns in place rather than rebuilding the table).
      const IPICK_PREPAID_REVERSE: Array<[string, string]> = [
        ["1", "credit only 1$"],
        ["1.67", "credit only 1.67$"],
        ["3.79", "10 days 3.79$"],
        ["4.5", "30 days 4.5$"],
        ["7.58", "30 days 7.58$"],
        ["10", "30 days 10$"],
        ["15.15", "60 days 15.15$"],
        ["22.73", "90 days 22.73$"],
        ["77.28", "365 days 77.28$"],
        ["start", "start 4.5$"],
      ];
      const revertStmt = db.prepare(`
        UPDATE mobile_service_items
           SET label = ?, updated_at = CURRENT_TIMESTAMP
         WHERE provider = 'iPick' AND category = 'mtc' AND subcategory = 'Prepaid'
           AND label = ?
      `);
      for (const [newLabel, oldLabel] of IPICK_PREPAID_REVERSE) {
        revertStmt.run(oldLabel, newLabel);
      }
      console.log(
        "Migration v135 rolled back: carrier_lines dropped, iPick mtc Prepaid labels reverted (validity_days/credits columns left in place)",
      );
    },
  },
  {
    version: 136,
    name: "add_supplier_ledger_source_ref",
    description:
      "LIRA-091: supplier_ledger gains source_ref_table/source_ref_id — a generic back-link from an auto-generated ledger row (FinancialServiceRepository's is_auto:true BILL-commission / SEND-RECEIVE TOP_UP-PAYMENT siblings) to the PARENT unified transaction's own source row (source_ref_table/source_ref_id mirror the parent's own transactions.source_table/source_id, e.g. 'financial_services'/<fs id>) — so TransactionRepository can find and cascade-void the sibling when the parent is voided/refunded (FEATURE_GUIDE §9 standing gap: 'voiding a FINANCIAL_SERVICE/RECHARGE row leaves its auto supplier sibling standing'). Mirrors the existing partner_ledger.reference_table/reference_id pattern used for the exact same purpose. Nullable, DEFAULT NULL only — never CURRENT_TIMESTAMP (v104 prod-brick lesson) — and guarded by a PRAGMA table_info check so replaying up() on an already-migrated DB is a safe no-op (mirrors the debt_ledger/supplier_ledger unified_transaction_id guard in the v83-era migration above). Pre-link (legacy) rows are NOT backfilled — no heuristic data repair, the same limitation LIRA-094 documented for its split_group marker.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db.prepare("PRAGMA table_info(supplier_ledger)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "source_ref_table")) {
        db.exec(
          `ALTER TABLE supplier_ledger ADD COLUMN source_ref_table TEXT DEFAULT NULL`,
        );
      }
      if (!cols.some((c) => c.name === "source_ref_id")) {
        db.exec(
          `ALTER TABLE supplier_ledger ADD COLUMN source_ref_id INTEGER DEFAULT NULL`,
        );
      }
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_supplier_ledger_source_ref ON supplier_ledger(source_ref_table, source_ref_id)`,
      );
      console.log(
        "Migration v136: added supplier_ledger.source_ref_table/source_ref_id + index",
      );
    },
    down(db: Database.Database) {
      db.exec(`DROP INDEX IF EXISTS idx_supplier_ledger_source_ref`);
      db.exec(`ALTER TABLE supplier_ledger DROP COLUMN source_ref_id`);
      db.exec(`ALTER TABLE supplier_ledger DROP COLUMN source_ref_table`);
      console.log(
        "Migration v136 rolled back: supplier_ledger source_ref_table/source_ref_id + index removed",
      );
    },
  },
  {
    version: 137,
    name: "add_drawer_cashouts_table",
    description:
      "Cash Out feature (mirrors Drawer Top-Up with the sign flipped): the owner pulls physical cash OUT of the General drawer for reasons that are neither a business expense (must not touch net_profit — no row in `expenses`) nor a drawer-to-drawer transfer. `drawer_cashouts` is the source-of-record table for DrawerCashoutRepository.createCashout, which negates amount_usd/amount_lbp on the unified transaction row (ExpenseRepository's outflow sign convention) and posts a negative-amount payments leg + negative applyDrawerDelta against General. No `modules`/`currency_modules`/`currency_drawers` inserts — this isn't a new module or drawer, exactly like drawer_topups.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS drawer_cashouts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          amount_usd REAL DEFAULT 0,
          amount_lbp REAL DEFAULT 0,
          notes TEXT NOT NULL,
          created_by INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_drawer_cashouts_tenant_id ON drawer_cashouts(tenant_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_drawer_cashouts_created_at ON drawer_cashouts(created_at)`,
      );
      console.log("Migration v137: Created drawer_cashouts table");
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS drawer_cashouts`);
      console.log("Migration v137 rolled back: dropped drawer_cashouts table");
    },
  },
  {
    version: 138,
    name: "add_wallet_exchanges_table",
    description:
      "Internal wallet exchange (owner req 2026-07-28): convert a provider wallet's OWN USD balance to LBP or vice versa (OMT_App / Whish_App drawer only — never General, never the customer-facing Exchange page). Both legs post against the SAME drawer at an operator-entered rate (default 89000, no spread/profit — this isn't a customer transaction). `wallet_exchanges` is deliberately its own table rather than reusing `exchange_transactions`, which has no drawer_name column and would silently pollute the General till's Exchange history/today-stats aggregates (those queries have no drawer filter). is_refunded/refunded_at (+ the _markSourceRefunded wiring in TransactionRepository) make it reversible via the generic void/refund path, matching EXCHANGE's own reversibility.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS wallet_exchanges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          drawer_name TEXT NOT NULL CHECK (drawer_name IN ('OMT_App', 'Whish_App')),
          from_currency TEXT NOT NULL CHECK (from_currency IN ('USD', 'LBP')),
          to_currency TEXT NOT NULL CHECK (to_currency IN ('USD', 'LBP')),
          amount_in REAL NOT NULL,
          amount_out REAL NOT NULL,
          rate REAL NOT NULL,
          note TEXT,
          created_by INTEGER,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_wallet_exchanges_tenant_id ON wallet_exchanges(tenant_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_wallet_exchanges_created_at ON wallet_exchanges(created_at)`,
      );
      console.log("Migration v138: Created wallet_exchanges table");
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS wallet_exchanges`);
      console.log("Migration v138 rolled back: dropped wallet_exchanges table");
    },
  },
  {
    version: 139,
    name: "add_system_float_topups_table",
    description:
      "Owner-confirmed float model (2026-07-29): OMT_System / Whish_System is a spendable float the operator can fund directly — a SEND spends the balance down, a RECEIVE credits it, and periodic settlement covers only the fee split, not the principal. Nothing in the codebase could previously INCREASE that float (DrawerTopUpRepository only moves it OUT to General). `system_float_topups` backs the missing direction: operator hands real money to the provider (or transfers it in), funding_drawer −, target_drawer (OMT_System/Whish_System) +, profit always 0 — a same-shop cash move, not earned revenue. Its own table (not a column on drawer_topups) because drawer_topups.source_drawer already means 'debit source in a transfer INTO General' and every existing drawer_topups row is permanently non-reversible; is_refunded/refunded_at + the _markSourceRefunded wiring make THIS flow reversible via the generic void/refund path, mirroring wallet_exchanges (v138).",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS system_float_topups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          target_drawer TEXT NOT NULL CHECK (target_drawer IN ('OMT_System', 'Whish_System')),
          funding_drawer TEXT NOT NULL,
          amount_usd REAL NOT NULL DEFAULT 0,
          amount_lbp REAL NOT NULL DEFAULT 0,
          notes TEXT,
          created_by INTEGER,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_system_float_topups_tenant_id ON system_float_topups(tenant_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_system_float_topups_created_at ON system_float_topups(created_at)`,
      );
      console.log("Migration v139: Created system_float_topups table");
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS system_float_topups`);
      console.log(
        "Migration v139 rolled back: dropped system_float_topups table",
      );
    },
  },
  {
    version: 140,
    name: "rebuild_system_float_topups_as_drawer_transfers",
    description:
      "Primary Cash Drawer plan §8.6 (owner verdict 2026-07-30, superseding v139's float model): OMT_System/Whish_System stop being a spendable float and become the physical primary cash drawer (PCD) at the money-transfer counter. The generic cash-move mechanism therefore needs to run BOTH directions (General→PCD funding AND PCD→General draining), but v139's `system_float_topups.target_drawer CHECK (target_drawer IN ('OMT_System','Whish_System'))` forbids a PCD→General row outright — and SQLite cannot ALTER a CHECK constraint, so the table is rebuilt rather than altered. `drawer_transfers` replaces the fixed target_drawer/funding_drawer roles with symmetric from_drawer/to_drawer columns and NO CHECK on either (a manual transfer's counterparties are shop drawer names, not a fixed provider-float pair). Existing rows carry forward 1:1 (funding_drawer -> from_drawer, target_drawer -> to_drawer) WITH their original id — transactions.source_id for every pre-existing SYSTEM_FLOAT_TOPUP/DRAWER_TRANSFER row points at this table by id, so an id-preserving copy is required for the generic void/refund path (TransactionRepository._markSourceRefunded) to keep resolving the right row.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE drawer_transfers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          from_drawer TEXT NOT NULL,
          to_drawer TEXT NOT NULL,
          amount_usd REAL NOT NULL DEFAULT 0,
          amount_lbp REAL NOT NULL DEFAULT 0,
          notes TEXT,
          created_by INTEGER,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_drawer_transfers_tenant_id ON drawer_transfers(tenant_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_drawer_transfers_created_at ON drawer_transfers(created_at)`,
      );

      // Carry forward every existing row, id-preserving (see description).
      db.exec(`
        INSERT INTO drawer_transfers (
          id, tenant_id, from_drawer, to_drawer, amount_usd, amount_lbp,
          notes, created_by, is_refunded, refunded_at, created_at, updated_at
        )
        SELECT
          id, tenant_id, funding_drawer, target_drawer, amount_usd, amount_lbp,
          notes, created_by, is_refunded, refunded_at, created_at, updated_at
        FROM system_float_topups
      `);

      db.exec(`DROP TABLE system_float_topups`);

      console.log(
        "Migration v140: rebuilt system_float_topups as drawer_transfers (from_drawer/to_drawer, no CHECK)",
      );
    },
    down(db: Database.Database) {
      db.exec(`
        CREATE TABLE system_float_topups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          target_drawer TEXT NOT NULL CHECK (target_drawer IN ('OMT_System', 'Whish_System')),
          funding_drawer TEXT NOT NULL,
          amount_usd REAL NOT NULL DEFAULT 0,
          amount_lbp REAL NOT NULL DEFAULT 0,
          notes TEXT,
          created_by INTEGER,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_system_float_topups_tenant_id ON system_float_topups(tenant_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_system_float_topups_created_at ON system_float_topups(created_at)`,
      );

      // Only rows whose to_drawer fits the old CHECK can come back. v139's
      // CHECK allowed target_drawer IN ('OMT_System','Whish_System') only, so
      // General->PCD rows survive the rollback and PCD->General rows — the
      // direction v140 exists to make possible — have no legal home in the
      // old shape and are dropped rather than violating the CHECK.
      db.exec(`
        INSERT INTO system_float_topups (
          id, tenant_id, target_drawer, funding_drawer, amount_usd, amount_lbp,
          notes, created_by, is_refunded, refunded_at, created_at, updated_at
        )
        SELECT
          id, tenant_id, to_drawer, from_drawer, amount_usd, amount_lbp,
          notes, created_by, is_refunded, refunded_at, created_at, updated_at
        FROM drawer_transfers
        WHERE to_drawer IN ('OMT_System', 'Whish_System')
      `);

      db.exec(`DROP TABLE drawer_transfers`);

      console.log(
        "Migration v140 rolled back: rebuilt system_float_topups (target_drawer/funding_drawer, CHECK restored)",
      );
    },
  },
  {
    version: 141,
    name: "add_telecom_days_credit_validity_schema",
    description:
      "LIRA-090 Phase 1 (owner interview resolved 2026-07-30, TELECOM_DAYS_VALIDITY_PLAN.md §7): schema for the telecom 'Only Days' credit-return model. (a) mobile_service_items gains three nullable REAL columns — days_cost_lbp (the item's own validity-only cost component, out of the existing cost_lbp), sell_days_lbp (customer price when only the days are sold), sell_credit_lbp (display/decision-aid price for resold recovered credit) — added via defaultless ALTER TABLE ADD COLUMN (v104 prod-brick lesson: SQLite rejects a non-constant default on ALTER; these stay NULL until a per-item split is configured, so existing catalog rows are unaffected and keep today's manual returnedCreditsUsd behaviour). (b) carrier_lines gains is_primary (constant default 0 IS legal on ALTER) plus a partial unique index enforcing at most one primary line per (tenant, carrier) — the line that receives automated returns/self-charges by default. (c) new carrier_line_movements table: the rule-20 reversal owner for every automated carrier_lines credit/validity mutation (Only Days credit-return, self-charge), so the generic void/refund path can reverse a line's credits/validity by transaction_id instead of leaving it permanently decremented (carrier_lines has no is_refunded column and is absent from TransactionRepository._markSourceRefunded's whitelist). (d) seeds the 'telecom_credit_sell_price_lbp' per-tenant setting (default 100000, the plan's §2.4 worked-example price) backing the three-row resale decision-aid table — seeded the same way v125 seeded allow_out_of_stock_sales (INSERT OR IGNORE per tenant row), and named distinctly from the existing alfa_credit_sell_rate_lbp/alfa_credit_cost_rate_lbp/alfa_credit_cost_lbp keys, which belong to the separate, out-of-scope Alfa Gift recharge channel (RechargeRepository/TelecomForm.tsx).",
    type: "typescript" as const,
    up(db: Database.Database) {
      // ---------------------------------------------------------------------
      // (a) mobile_service_items — Only Days split columns. Nullable,
      // defaultless ALTER (v104 prod-brick lesson). Guarded so replaying
      // up() on an already-migrated DB is a safe no-op.
      // ---------------------------------------------------------------------
      const msiCols = db
        .prepare("PRAGMA table_info(mobile_service_items)")
        .all() as { name: string }[];
      if (!msiCols.some((c) => c.name === "days_cost_lbp")) {
        db.exec(
          `ALTER TABLE mobile_service_items ADD COLUMN days_cost_lbp REAL`,
        );
      }
      if (!msiCols.some((c) => c.name === "sell_days_lbp")) {
        db.exec(
          `ALTER TABLE mobile_service_items ADD COLUMN sell_days_lbp REAL`,
        );
      }
      if (!msiCols.some((c) => c.name === "sell_credit_lbp")) {
        db.exec(
          `ALTER TABLE mobile_service_items ADD COLUMN sell_credit_lbp REAL`,
        );
      }

      // ---------------------------------------------------------------------
      // (b) carrier_lines — is_primary flag (constant default is legal on
      // ALTER) + partial unique index: at most one primary line per carrier
      // per tenant.
      // ---------------------------------------------------------------------
      const clCols = db.prepare("PRAGMA table_info(carrier_lines)").all() as {
        name: string;
      }[];
      if (!clCols.some((c) => c.name === "is_primary")) {
        db.exec(
          `ALTER TABLE carrier_lines ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0`,
        );
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_carrier_lines_one_primary_per_carrier
        ON carrier_lines(tenant_id, carrier)
        WHERE is_primary = 1
      `);

      // ---------------------------------------------------------------------
      // (c) carrier_line_movements — new table, so DEFAULT CURRENT_TIMESTAMP
      // is fine (only ALTER ADD COLUMN forbids non-constant defaults).
      // ---------------------------------------------------------------------
      db.exec(`
        CREATE TABLE IF NOT EXISTS carrier_line_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          carrier_line_id INTEGER NOT NULL,
          transaction_id INTEGER,
          credits_delta REAL NOT NULL DEFAULT 0,
          validity_days_delta INTEGER NOT NULL DEFAULT 0,
          reason TEXT NOT NULL,
          is_reversed INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (carrier_line_id) REFERENCES carrier_lines(id) ON DELETE CASCADE,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_carrier_line_movements_tenant_id ON carrier_line_movements(tenant_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_carrier_line_movements_carrier_line_id ON carrier_line_movements(carrier_line_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_carrier_line_movements_transaction_id ON carrier_line_movements(transaction_id)`,
      );

      // ---------------------------------------------------------------------
      // (d) Settings default — credit sell price (LBP per $1) backing the
      // §2.4 resale decision-aid table. Same per-tenant seeding pattern as
      // v125's allow_out_of_stock_sales.
      // ---------------------------------------------------------------------
      const settingsRes = db
        .prepare(
          `INSERT OR IGNORE INTO system_settings (tenant_id, key_name, value)
           SELECT id, 'telecom_credit_sell_price_lbp', '100000' FROM tenants`,
        )
        .run();

      console.log(
        `Migration v140: mobile_service_items split columns added; carrier_lines.is_primary + partial unique index added; carrier_line_movements table created; telecom_credit_sell_price_lbp seeded for ${settingsRes.changes} tenant(s)`,
      );
    },
    down(db: Database.Database) {
      // New table + new index — straightforward drop.
      db.exec(`DROP INDEX IF EXISTS idx_carrier_line_movements_transaction_id`);
      db.exec(
        `DROP INDEX IF EXISTS idx_carrier_line_movements_carrier_line_id`,
      );
      db.exec(`DROP INDEX IF EXISTS idx_carrier_line_movements_tenant_id`);
      db.exec(`DROP TABLE IF EXISTS carrier_line_movements`);

      // Drop the partial unique index, then the column it covers (this
      // better-sqlite3 build's bundled SQLite supports DROP COLUMN — same
      // precedent as v136's source_ref_table/source_ref_id rollback — but the
      // index must go first since a column backing an index can't be dropped).
      db.exec(`DROP INDEX IF EXISTS idx_carrier_lines_one_primary_per_carrier`);
      const clCols = db.prepare("PRAGMA table_info(carrier_lines)").all() as {
        name: string;
      }[];
      if (clCols.some((c) => c.name === "is_primary")) {
        db.exec(`ALTER TABLE carrier_lines DROP COLUMN is_primary`);
      }

      const msiCols = db
        .prepare("PRAGMA table_info(mobile_service_items)")
        .all() as { name: string }[];
      if (msiCols.some((c) => c.name === "sell_credit_lbp")) {
        db.exec(`ALTER TABLE mobile_service_items DROP COLUMN sell_credit_lbp`);
      }
      if (msiCols.some((c) => c.name === "sell_days_lbp")) {
        db.exec(`ALTER TABLE mobile_service_items DROP COLUMN sell_days_lbp`);
      }
      if (msiCols.some((c) => c.name === "days_cost_lbp")) {
        db.exec(`ALTER TABLE mobile_service_items DROP COLUMN days_cost_lbp`);
      }

      db.exec(
        `DELETE FROM system_settings WHERE key_name = 'telecom_credit_sell_price_lbp'`,
      );

      console.log(
        "Migration v141 rolled back: carrier_line_movements dropped, carrier_lines.is_primary + partial index dropped, mobile_service_items split columns dropped, telecom_credit_sell_price_lbp setting removed",
      );
    },
  },
  {
    version: 142,
    name: "add_carrier_line_movement_previous_validity",
    description:
      "LIRA-090 M2 fix (2026-07-30 adversarial review, TELECOM_DAYS_VALIDITY_PLAN.md §8): carrier_line_movements gains a nullable previous_validity_expires_at TEXT column, added via defaultless ALTER TABLE ADD COLUMN (v104 prod-brick lesson). It records the carrier line's validity_expires_at exactly as it stood immediately BEFORE the movement's mutation was applied. CarrierLineRepository.reverseMovement restores this value VERBATIM instead of subtracting validity_days_delta off whatever the line's CURRENT expiry happens to be — the pre-fix 'reverseDelta' primitive (a) silently dropped the restore whenever the CURRENT expiry was null at reversal time (guard: validityDaysDelta !== 0 && line.validity_expires_at), with no error and no log, and (b) even when non-null, could not undo the §5.2 'already-expired lines extend from today' rebasing on reversal, because a naive day-subtraction cannot recover a stale date that was never used in the forward computation. Storing the exact pre-mutation snapshot makes both cases exact. Existing rows (written before this migration) get NULL here, which reverseMovement treats as 'the line legitimately had no expiry before this movement' — the same value applyMovement stores when the line's expiry actually was null at apply time.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const cols = db
        .prepare("PRAGMA table_info(carrier_line_movements)")
        .all() as { name: string }[];
      if (!cols.some((c) => c.name === "previous_validity_expires_at")) {
        db.exec(
          `ALTER TABLE carrier_line_movements ADD COLUMN previous_validity_expires_at TEXT`,
        );
      }
      console.log(
        "Migration v142: carrier_line_movements.previous_validity_expires_at added",
      );
    },
    down(db: Database.Database) {
      const cols = db
        .prepare("PRAGMA table_info(carrier_line_movements)")
        .all() as { name: string }[];
      if (cols.some((c) => c.name === "previous_validity_expires_at")) {
        db.exec(
          `ALTER TABLE carrier_line_movements DROP COLUMN previous_validity_expires_at`,
        );
      }
      console.log(
        "Migration v142 rolled back: carrier_line_movements.previous_validity_expires_at dropped",
      );
    },
  },
  {
    version: 143,
    name: "backfill_credits_on_prepaid_cards",
    description:
      "TELECOM_DAYS_COST_PLAN.md §6 step 3: backfills mobile_service_items.credits for existing installs. parseCatalogToSeedData (the frontend catalog seed) only ever runs ONCE, on first launch, when the table is empty — the 2026-08-03 uncommitted `credits` addition to the alfa (all 3 providers) and mtc (7 face-value cards × 3 providers) Prepaid blocks in frontend/src/data/mobileServices.ts therefore reaches ZERO already-provisioned installs on its own. This migration is what reaches them: sets credits = CAST(label AS REAL) for every row where provider IN ('iPick','Katsh','WHISH_APP') AND category IN ('alfa','mtc') AND subcategory = 'Prepaid' AND credits IS NULL AND the label is a pure numeric string (label GLOB '[0-9]*' AND label NOT GLOB '*[^0-9.]*') — the card's face value IS the label, the same rule the frontend seed applies. The numeric guard is load-bearing, not decorative: 'start'/'startSOS'/'smart'/'super' (mtc Prepaid) sit in the exact same provider/category/subcategory bucket, and SQLite's CAST('start' AS REAL) silently returns 0.0 with NO error — without the GLOB guard those named plans would get a bogus credits = 0 instead of staying correctly unset. mtc Prepaid '1'/'1.67' (all 3 providers, plan §1.3 — credit-only, no validity days, explicitly OUT of Only-Days scope) already carry credits from a prior seed and are skipped here by the credits IS NULL guard; down() has to exclude them by label explicitly instead, since after up() runs their credits is no longer NULL and that natural discriminator is gone (see down()'s own comment). Idempotent: a second run only ever touches rows still NULL.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const result = db
        .prepare(
          `UPDATE mobile_service_items
           SET credits = CAST(label AS REAL), updated_at = CURRENT_TIMESTAMP
           WHERE provider IN ('iPick', 'Katsh', 'WHISH_APP')
             AND category IN ('alfa', 'mtc')
             AND subcategory = 'Prepaid'
             AND credits IS NULL
             AND label GLOB '[0-9]*'
             AND label NOT GLOB '*[^0-9.]*'`,
        )
        .run();

      console.log(
        `Migration v143: backfilled credits (= numeric label, card face value) for ${result.changes} alfa/mtc Prepaid row(s) across iPick/Katsh/WHISH_APP`,
      );
    },
    down(db: Database.Database) {
      // Cannot tell "credits this migration just backfilled" apart from
      // "credits the frontend seed itself already wrote on a genuinely fresh
      // install" — both land on the identical rows with the identical value,
      // and there is no provenance column to distinguish them after the
      // fact. What CAN be told apart is which specific labels this migration
      // (and the matching frontend seed change) ever touches: mtc Prepaid
      // '1' and '1.67' already carried credits before ANY of this shipped
      // (LIRA-072-era seed, plan §1.3 — explicitly OUT of Only-Days scope)
      // and must never be reverted here, in either scenario above. Every
      // OTHER numeric-labelled alfa/mtc Prepaid row across the three
      // providers is exactly the set up() can ever touch, so nulling all of
      // them back is exact — not merely "least destructive" — for both an
      // upgraded install and a fresh one.
      const result = db
        .prepare(
          `UPDATE mobile_service_items
           SET credits = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE provider IN ('iPick', 'Katsh', 'WHISH_APP')
             AND category IN ('alfa', 'mtc')
             AND subcategory = 'Prepaid'
             AND label NOT IN ('1', '1.67')
             AND label GLOB '[0-9]*'
             AND label NOT GLOB '*[^0-9.]*'`,
        )
        .run();

      console.log(
        `Migration v143 rolled back: credits nulled for ${result.changes} alfa/mtc Prepaid row(s) (excludes '1'/'1.67', which predate this migration)`,
      );
    },
  },
  {
    version: 144,
    name: "seed_telecom_credit_cost_rate_and_backfill_days_cost",
    description:
      "TELECOM_DAYS_COST_PLAN.md §6 step 7a (owner-confirmed 2026-08-04, THE resolution of the plan's one blocking input): (a) seeds the telecom_credit_cost_rate_lbp per-tenant setting at 93,333.33 LBP/$ — R, the shop's cost of $1 of credit — sourced from iPick > mtc > Credits, the one category in the whole catalog where credit is bought with no validity days attached (280,000/3$ = 93,333.33 LBP/$, exactly linear across all 5 entries in that price list), seeded with the same per-tenant INSERT OR IGNORE pattern v141 used for telecom_credit_sell_price_lbp. (b) backfills mobile_service_items.days_cost_lbp = round(cost_lbp - credits * R) for every row with cost_lbp > 0 AND credits > 0 AND days_cost_lbp IS NULL, reading each tenant's OWN rate setting back out of system_settings (never the literal constant), so a tenant that customizes the rate before this migration runs — or between (a) and (b) in some future replay — gets backfilled at their own number, not the default. The arithmetic itself is never re-encoded here (rule 14): it calls deriveDaysCostLbp from packages/core/src/utils/telecomCredit.ts, the ONE definition, which also enforces the plan's §4.4 guard (0 < days_cost_lbp < cost_lbp; ceiling 98,603 LBP/$, set by Katsh/WHISH_APP alfa 77.28) and returns null — never a value the guard would reject — for any row that fails it; such rows are counted and logged, never written with a non-positive or out-of-range value. At R = 93,333.33 all 43 catalog Only-Days items (plan §1) price positive (lowest: iPick mtc 3.79 at 25,267 LBP), so nothing is skipped on the shipped catalog today — the skip path exists for any row an operator hand-enters with a different credits/cost_lbp combination later. Idempotent: a second run only ever touches rows still NULL, at whatever rate is on record at that time.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // (a) Seed R per tenant — same INSERT OR IGNORE per-tenant-row pattern
      // v141 used for telecom_credit_sell_price_lbp.
      const settingsRes = db
        .prepare(
          `INSERT OR IGNORE INTO system_settings (tenant_id, key_name, value)
           SELECT id, 'telecom_credit_cost_rate_lbp', ? FROM tenants`,
        )
        .run(String(TELECOM_CREDIT_COST_RATE_LBP));

      // (b) Backfill days_cost_lbp, per tenant, using that tenant's OWN rate
      // (read back from system_settings, not the literal constant — a
      // tenant may already have a customized value on record).
      const tenants = db.prepare(`SELECT id FROM tenants`).all() as {
        id: number;
      }[];

      let updated = 0;
      let skipped = 0;

      for (const tenant of tenants) {
        const rateRow = db
          .prepare(
            `SELECT value FROM system_settings
             WHERE tenant_id = ? AND key_name = 'telecom_credit_cost_rate_lbp'`,
          )
          .get(tenant.id) as { value: string } | undefined;
        const rate = rateRow
          ? Number(rateRow.value)
          : TELECOM_CREDIT_COST_RATE_LBP;

        const items = db
          .prepare(
            `SELECT id, cost_lbp, credits FROM mobile_service_items
             WHERE tenant_id = ? AND cost_lbp > 0 AND credits > 0 AND days_cost_lbp IS NULL`,
          )
          .all(tenant.id) as {
          id: number;
          cost_lbp: number;
          credits: number;
        }[];

        for (const item of items) {
          const daysCostLbp = deriveDaysCostLbp(
            item.cost_lbp,
            item.credits,
            rate,
          );
          if (daysCostLbp === null) {
            skipped++;
            continue;
          }
          db.prepare(
            `UPDATE mobile_service_items
             SET days_cost_lbp = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          ).run(daysCostLbp, item.id);
          updated++;
        }
      }

      console.log(
        `Migration v144: telecom_credit_cost_rate_lbp seeded for ${settingsRes.changes} tenant(s); days_cost_lbp backfilled for ${updated} item(s), ${skipped} skipped (guard rejected: cost_lbp/credits combination would not satisfy 0 < days_cost_lbp < cost_lbp)`,
      );
    },
    down(db: Database.Database) {
      // Same provenance caveat as v143's down(): a row's days_cost_lbp
      // could in principle have been hand-entered by an operator via
      // Settings rather than by this migration (plan §3.4 — the field is
      // editable there too). There is no column recording which wrote it, so
      // this reverts every row that currently matches the same shape this
      // migration's up() selects from (cost_lbp > 0 AND credits > 0 AND
      // days_cost_lbp IS NOT NULL) — the defensible, documented tradeoff.
      const result = db
        .prepare(
          `UPDATE mobile_service_items
           SET days_cost_lbp = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE cost_lbp > 0 AND credits > 0 AND days_cost_lbp IS NOT NULL`,
        )
        .run();

      db.prepare(
        `DELETE FROM system_settings WHERE key_name = 'telecom_credit_cost_rate_lbp'`,
      ).run();

      console.log(
        `Migration v144 rolled back: days_cost_lbp nulled for ${result.changes} row(s); telecom_credit_cost_rate_lbp setting removed`,
      );
    },
  },
  {
    version: 145,
    name: "backfill_alfa_prepaid_validity_days",
    description:
      "TELECOM_DAYS_COST_PLAN.md §6 step 7b (owner-confirmed 2026-08-04): backfills mobile_service_items.validity_days for the alfa Prepaid combo cards, which shipped with credits but no day count. The owner read the day counts off the KATSH alfa shelf — 4.5 = 10 days, 7.58 = 30, 10 = 30, 15.15 = 60, 22.73 = 90, 77.28 = 365 (12 months) — and they are applied to iPick/Katsh/WHISH_APP alike, because all three resell the identical physical Alfa card, so the face value alone identifies the validity. That cross-provider stamping rule is not new: migration v135 established it for the mtc Prepaid cards with the same justification. NOTE these deliberately DIVERGE from the mtc card of the same face value on two entries — alfa 4.5 grants 10 days where mtc 4.5 grants 30, and alfa 15.15 was owner-corrected to 60 (matching mtc) after it was first reported as 30; a per-day cost cross-check flagged 30 as the outlier of the alfa set and the owner confirmed 60. The alfa `1.22` and `3.03` cards are deliberately EXCLUDED: the owner could not confirm a day count for them, so they stay credit-only — the alfa equivalent of mtc's `1`/`1.67` — and remain out of the Only-Days split (plan §1.3). Giving them a validity_days here would flip isTelecomSplitComplete and start routing their sales through the credit-return netting path, which is exactly the trap the seed parser's isOnlyDaysCandidate guard exists to prevent. Scoped exactly like v143 (provider IN iPick/Katsh/WHISH_APP, category='alfa', subcategory='Prepaid') and idempotent via validity_days IS NULL, so a shop that has already hand-entered a day count keeps it. Fresh installs never reach this migration (create_db.sql marks it applied before any catalog row exists) — for those, frontend/src/data/mobileServices.ts carries the same values directly, exactly the split v135 documented.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Owner-confirmed day counts, keyed by card face value. Deliberately a
      // literal map rather than a formula: there is no relationship between
      // face value and validity to derive from (plan §2), these are read off
      // the physical shelf.
      const ALFA_PREPAID_VALIDITY_DAYS: Record<string, number> = {
        "4.5": 10,
        "7.58": 30,
        "10": 30,
        "15.15": 60,
        "22.73": 90,
        "77.28": 365,
      };

      const stmt = db.prepare(
        `UPDATE mobile_service_items
            SET validity_days = ?, updated_at = CURRENT_TIMESTAMP
          WHERE provider IN ('iPick', 'Katsh', 'WHISH_APP')
            AND category = 'alfa'
            AND subcategory = 'Prepaid'
            AND label = ?
            AND validity_days IS NULL`,
      );

      let updated = 0;
      for (const [label, days] of Object.entries(ALFA_PREPAID_VALIDITY_DAYS)) {
        updated += stmt.run(days, label).changes;
      }

      console.log(
        `Migration v145: alfa Prepaid validity_days backfilled on ${updated} row(s) ` +
          `(1.22 and 3.03 deliberately left NULL — credit-only, out of Only-Days)`,
      );
    },
    down(db: Database.Database) {
      // Only the six labels this migration can have set. `1.22`/`3.03` are
      // never touched in either direction, and any OTHER alfa Prepaid label a
      // shop added by hand keeps whatever it has — same provenance caveat as
      // v143's down(): a row's validity_days cannot be distinguished from one
      // the catalog seed wrote, so this reverts by the exact label set only.
      const result = db
        .prepare(
          `UPDATE mobile_service_items
              SET validity_days = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE provider IN ('iPick', 'Katsh', 'WHISH_APP')
              AND category = 'alfa'
              AND subcategory = 'Prepaid'
              AND label IN ('4.5', '7.58', '10', '15.15', '22.73', '77.28')`,
        )
        .run();

      console.log(
        `Migration v145 rolled back: validity_days nulled for ${result.changes} alfa Prepaid row(s)`,
      );
    },
  },
  {
    version: 146,
    name: "reanchor_telecom_credit_cost_rate",
    description:
      "TELECOM_CREDIT_RATE_PLAN.md (owner-confirmed 2026-08-05): moves the telecom credit cost rate R from 93,333.33 to 85,000 LBP/$ and re-derives every days_cost_lbp that was written at the old rate. R is what the shop already works in — Settings > Shop Config records it as alfa_credit_cost_lbp and the MTC/Alfa credit-sale path charges against it. The old 93,333.33 came from iPick > mtc > Credits (280,000/3$, exactly linear across all five entries) but that price list carries a SELL of 50,000/$, half its own cost, so it was stale: linearity proved arithmetic, not currency. Four independent checks rejected it — the cheapest delivered $1 came to 104,075 against a 100,000 sell price (a guaranteed loss on every resale); $1 recovered from a card cost 98,805 against 85,000 to buy credit directly (nobody would buy cards for credit); the implied days cost landed at 1,000-2,500 LBP/day against a 6,500 LBP/day standalone validity price (days four times cheaper bundled than alone); and the owner's own anchor, the 77.28 card's days selling for ~2,000,000 LBP, made a 515,200 days cost imply a 74% margin on days while the credit side ran negative. NOTE R is an ALLOCATION knob, not a measurement: total profit on an Only-Days sale is independent of it (the credits x R term cancels between profit_days and profit_credit), so this migration moves no money and changes no total — it only re-attributes cost between the days and credit reporting lines, and lifts the days share from 6.67% to 15% of card cost. HAND-EDITED ROWS ARE PRESERVED: a row is only recomputed when its current days_cost_lbp still equals what the OLD rate's formula produced, i.e. nobody has touched it since v144 wrote it. Anything else is treated as a deliberate override and left exactly as-is (the same reason this recomputes from cost_lbp/credits rather than scaling the stored value — scaling would silently carry an override to a new wrong number). The rate setting itself is likewise only moved when it still holds the old default, so a tenant who already customised it keeps their value.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const OLD_RATE = 93333.33;

      // (a) The setting: only move it if it still holds the old default.
      const settingRes = db
        .prepare(
          `UPDATE system_settings
              SET value = ?, updated_at = CURRENT_TIMESTAMP
            WHERE key_name = 'telecom_credit_cost_rate_lbp'
              AND CAST(value AS REAL) = ?`,
        )
        .run(String(TELECOM_CREDIT_COST_RATE_LBP), OLD_RATE);

      // (b) Re-derive days_cost_lbp per tenant, at that tenant's OWN rate.
      const tenants = db.prepare(`SELECT id FROM tenants`).all() as {
        id: number;
      }[];

      let updated = 0;
      let preserved = 0;
      let skipped = 0;

      for (const tenant of tenants) {
        const rateRow = db
          .prepare(
            `SELECT value FROM system_settings
              WHERE tenant_id = ? AND key_name = 'telecom_credit_cost_rate_lbp'`,
          )
          .get(tenant.id) as { value: string } | undefined;
        const rate = rateRow
          ? Number(rateRow.value)
          : TELECOM_CREDIT_COST_RATE_LBP;

        const rows = db
          .prepare(
            `SELECT id, cost_lbp, credits, days_cost_lbp
               FROM mobile_service_items
              WHERE tenant_id = ?
                AND cost_lbp > 0
                AND credits > 0
                AND days_cost_lbp IS NOT NULL`,
          )
          .all(tenant.id) as {
          id: number;
          cost_lbp: number;
          credits: number;
          days_cost_lbp: number;
        }[];

        const setStmt = db.prepare(
          `UPDATE mobile_service_items
              SET days_cost_lbp = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND tenant_id = ?`,
        );

        for (const row of rows) {
          // Was this row's value produced by the OLD rate? If not, an operator
          // edited it and it is not ours to move.
          const atOldRate = deriveDaysCostLbp(
            row.cost_lbp,
            row.credits,
            OLD_RATE,
          );
          if (atOldRate === null || atOldRate !== row.days_cost_lbp) {
            preserved++;
            continue;
          }

          const atNewRate = deriveDaysCostLbp(row.cost_lbp, row.credits, rate);
          if (atNewRate === null) {
            // The new rate drives this row out of the 0 < days_cost < cost
            // guard. Leave the old value rather than writing something the
            // split gate would reject.
            skipped++;
            continue;
          }

          setStmt.run(atNewRate, row.id, tenant.id);
          updated++;
        }
      }

      console.log(
        `Migration v146: rate setting rows moved to ${TELECOM_CREDIT_COST_RATE_LBP} = ${settingRes.changes}; ` +
          `days_cost_lbp re-derived on ${updated} row(s), ${preserved} left as operator overrides, ${skipped} skipped by the guard`,
      );
    },
    down(db: Database.Database) {
      const OLD_RATE = 93333.33;

      // Mirror of up(): only revert rows that currently hold exactly what the
      // NEW rate produced, so an override made after this migration ran is not
      // clobbered on the way back either.
      const tenants = db.prepare(`SELECT id FROM tenants`).all() as {
        id: number;
      }[];

      let reverted = 0;
      for (const tenant of tenants) {
        const rows = db
          .prepare(
            `SELECT id, cost_lbp, credits, days_cost_lbp
               FROM mobile_service_items
              WHERE tenant_id = ?
                AND cost_lbp > 0
                AND credits > 0
                AND days_cost_lbp IS NOT NULL`,
          )
          .all(tenant.id) as {
          id: number;
          cost_lbp: number;
          credits: number;
          days_cost_lbp: number;
        }[];

        const setStmt = db.prepare(
          `UPDATE mobile_service_items
              SET days_cost_lbp = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND tenant_id = ?`,
        );

        for (const row of rows) {
          const atNewRate = deriveDaysCostLbp(
            row.cost_lbp,
            row.credits,
            TELECOM_CREDIT_COST_RATE_LBP,
          );
          if (atNewRate === null || atNewRate !== row.days_cost_lbp) continue;

          const atOldRate = deriveDaysCostLbp(
            row.cost_lbp,
            row.credits,
            OLD_RATE,
          );
          if (atOldRate === null) continue;

          setStmt.run(atOldRate, row.id, tenant.id);
          reverted++;
        }
      }

      db.prepare(
        `UPDATE system_settings
            SET value = ?, updated_at = CURRENT_TIMESTAMP
          WHERE key_name = 'telecom_credit_cost_rate_lbp'
            AND CAST(value AS REAL) = ?`,
      ).run(String(OLD_RATE), TELECOM_CREDIT_COST_RATE_LBP);

      console.log(
        `Migration v146 rolled back: days_cost_lbp restored to the ${OLD_RATE} rate on ${reverted} row(s)`,
      );
    },
  },
  {
    version: 147,
    name: "seed_sell_days_lbp_from_validity_days",
    description:
      "TELECOM_CREDIT_RATE_PLAN.md (owner-confirmed 2026-08-05): populates mobile_service_items.sell_days_lbp — the customer price for a days-only sale — from the item's validity_days, using the shared TELECOM_DAYS_SELL_PRICE_LBP table (10d 100,000 / 30d 250,000 / 60d 500,000 / 90d 750,000 / 365d 2,300,000). SUPERSEDED FIGURE — the annual was repriced to 1,780,000 on 2026-08-29 (v159). This migration reads the LIVE table rather than a pinned literal, so on a database created after that date it seeds 1,780,000 for 365 days, NOT the 2,300,000 written above. Read telecomCredit.ts for the current curve; never quote a price out of a migration description. Keyed on the DAY COUNT and not the card, because the customer is buying days: two cards granting 30 days sell those days for the same price even though they cost the shop different amounts, so five numbers populate all 39 Only-Days candidates. The curve is exactly linear at 8,333 LBP/day from 30 through 90 days and then 6,301 LBP/day for the year, a ~24% annual bulk discount; the 10-day figure is the catalog's own long-standing validity sell price (100,000) rather than the strict linear 83,333, because at 83,333 the alfa 4.5 card (days_cost 83,500) would sell its days at a 167 LBP loss and 10-day validity is rarely sold anyway. REJECTED ALTERNATIVE: a single observed sale (the 7.58 card at 300,000 for '1 month + $1.5 kept') implies 30d = 150,000 once the kept credit is priced at 100,000/$, i.e. card-derived days priced below a standalone validity charge — but that prices a month at 5,000/day while still pricing three months at 8,333/day (more per day for a longer commitment) and lands on EXACTLY zero margin for both 10-face cards, whose days_cost is precisely 150,000; under the shipped table that sale reads instead as a 100,000 discount off 400,000, consistent with the shop's habit of discounting (the annual goes $23 -> $20 as an offer). Scoped to genuine Only-Days candidates (credits > 0 AND validity_days > 0), which excludes both the standalone Validity products (days but no credit, nothing to return) and the credit-only cards (credit but no days, nothing to sell). Only ever fills a NULL, so any price an operator has already typed is preserved without needing an override marker. A day count absent from the table is SKIPPED rather than interpolated — the curve is discounted at the annual, so interpolating would invent a price the owner never agreed to; the catalog's 20/120/180/360-day validity products need an owner price, not arithmetic.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const rows = db
        .prepare(
          `SELECT id, validity_days
             FROM mobile_service_items
            WHERE sell_days_lbp IS NULL
              AND cost_lbp > 0
              AND credits > 0
              AND validity_days > 0`,
        )
        .all() as { id: number; validity_days: number }[];

      const stmt = db.prepare(
        `UPDATE mobile_service_items
            SET sell_days_lbp = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      );

      let updated = 0;
      const skippedDurations = new Set<number>();

      for (const row of rows) {
        // rule 14: the price curve is defined once, in telecomCredit.ts.
        const price = deriveSellDaysLbp(row.validity_days);
        if (price === null) {
          skippedDurations.add(row.validity_days);
          continue;
        }
        stmt.run(price, row.id);
        updated++;
      }

      console.log(
        `Migration v147: sell_days_lbp seeded on ${updated} row(s)` +
          (skippedDurations.size > 0
            ? `; skipped day counts not in the price table: ${[...skippedDurations].sort((a, b) => a - b).join(", ")}`
            : ""),
      );
    },
    down(db: Database.Database) {
      // Revert only rows still holding exactly a table price, so a price the
      // operator edited after this ran is not dragged back to NULL.
      const prices = Object.values(TELECOM_DAYS_SELL_PRICE_LBP);
      const placeholders = prices.map(() => "?").join(", ");
      const result = db
        .prepare(
          `UPDATE mobile_service_items
              SET sell_days_lbp = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE sell_days_lbp IN (${placeholders})
              AND credits > 0
              AND validity_days > 0`,
        )
        .run(...prices);

      console.log(
        `Migration v147 rolled back: sell_days_lbp nulled on ${result.changes} row(s)`,
      );
    },
  },
  {
    version: 148,
    name: "add_daily_closing_carrier_lines",
    description:
      "CARRIER_LINES_VALIDITY_PLAN.md Phase 3 (D2): the checkpoint stops being a pure cash count for MTC/Alfa and starts counting the shop's own SIM lines — credits AND validity expiry — per line. daily_closing_amounts cannot hold either fact: its grain is (closing_id, drawer_name, currency_code) -> (opening_amount = the EXPECTED value, physical_amount = the counted one), so it has nowhere to put a DATE and nowhere to put a per-line breakdown once a carrier has more than one line (§0.5 keeps the schema multi-line-capable). This table is the per-line audit snapshot: expected_credits/expected_expires_at are read server-side off carrier_lines at count time (never trusted from the client) and counted_* are what the operator entered. Credits are deliberately DUPLICATED here and in daily_closing_amounts' USD row for the provider drawer — nothing in the schema enforces the duplicate, so createCheckpoint sets both from ONE value (the post-count getCarrierCreditsSum, §0.1's single definition of the sum invariant) and a core test asserts they match for the same closing. UNIQUE(closing_id, carrier_line_id) makes a line countable at most once per checkpoint. Both FKs CASCADE: deleting a closing disposes its snapshot rows (rule 20 — the CHECKPOINT transaction itself is non-reversible, so this table has no reversal owner by design, only a cascade owner), and archiving is a soft is_active flip so a carrier line is never hard-deleted in practice.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_closing_carrier_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          closing_id INTEGER NOT NULL REFERENCES daily_closings(id) ON DELETE CASCADE,
          carrier_line_id INTEGER NOT NULL REFERENCES carrier_lines(id) ON DELETE CASCADE,
          expected_credits REAL NOT NULL DEFAULT 0,
          counted_credits REAL NOT NULL DEFAULT 0,
          expected_expires_at TEXT,
          counted_expires_at TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(closing_id, carrier_line_id)
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_dccl_tenant_id ON daily_closing_carrier_lines(tenant_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_dccl_closing_id ON daily_closing_carrier_lines(closing_id)`,
      );

      console.log(
        "Migration v148: daily_closing_carrier_lines created (per-line credits + validity count snapshot)",
      );
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS daily_closing_carrier_lines`);
      console.log(
        "Migration v148 rolled back: daily_closing_carrier_lines dropped",
      );
    },
  },
  {
    version: 149,
    name: "allow_credit_buyback_recharge_type",
    description:
      "CARRIER_LINES_VALIDITY_PLAN.md Phase 6: add 'CREDIT_BUYBACK' to recharges.recharge_type CHECK. A shop-line credit buy-back (RechargeRepository.processCreditBuyback) records into the recharges table with recharge_type='CREDIT_BUYBACK' — needed for source_table/source_id linkage, refunds via _markSourceRefunded, and the recharge history list — which the CHECK(recharge_type IN ('CREDIT_TRANSFER','VOUCHER','DAYS','TOP_UP','ALFA_GIFT')) established by v114 rejects with SQLITE_CONSTRAINT_CHECK. SQLite cannot ALTER a CHECK, so this recreates the table exactly as v114 did, preserving all rows + ids + indexes.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Defensive against a `recharges`-less DB — see the matching guard on
      // down() below for why (a synthetic test-harness scenario, never a
      // real upgrading install, which has had `recharges` since v1). Nothing
      // to add a CHECK to if the table was never created.
      const hasRecharges = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recharges'`,
        )
        .get();
      if (!hasRecharges) {
        console.log("Migration v149 skipped: no 'recharges' table present");
        return;
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS recharges_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          carrier TEXT NOT NULL,
          recharge_type TEXT CHECK(recharge_type IN ('CREDIT_TRANSFER', 'VOUCHER', 'DAYS', 'TOP_UP', 'ALFA_GIFT', 'CREDIT_BUYBACK')) NOT NULL DEFAULT 'CREDIT_TRANSFER',
          amount DECIMAL(10, 2) NOT NULL,
          cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
          price DECIMAL(10, 2) NOT NULL DEFAULT 0,
          default_price_to_client REAL DEFAULT NULL,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          paid_by TEXT DEFAULT 'CASH',
          phone_number TEXT,
          client_id INTEGER,
          client_name TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER DEFAULT 1,
          edited_by TEXT DEFAULT NULL,
          edited_at TEXT DEFAULT NULL,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );

        INSERT INTO recharges_new (
          id, tenant_id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        )
        SELECT
          id, tenant_id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        FROM recharges;

        DROP TABLE recharges;
        ALTER TABLE recharges_new RENAME TO recharges;

        CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
        CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
        CREATE INDEX IF NOT EXISTS idx_recharges_tenant_id ON recharges(tenant_id);
      `);
      console.log(
        "Migration v149: added 'CREDIT_BUYBACK' to recharges.recharge_type CHECK",
      );
    },
    down(db: Database.Database) {
      // Defensive against a `recharges`-less DB — a test harness that
      // fake-applies every OTHER migration (telecomDaysCostMigrationsViaRunner
      // .test.ts's `markAppliedExcept`, scoped to a schema with no `recharges`
      // table at all) rolls back EVERY migration above its target through
      // this exact rollbackTo() path, this one included, even though this
      // migration's own up() never really ran there. A real upgrading
      // install always has `recharges` (v1) long before v149, so this guard
      // never fires there — it only protects the "marked applied but never
      // run" test scenario from throwing on a table that was never created.
      const hasRecharges = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recharges'`,
        )
        .get();
      if (!hasRecharges) {
        console.log(
          "Migration v149 rollback skipped: no 'recharges' table present",
        );
        return;
      }

      // Restore the pre-CREDIT_BUYBACK CHECK. Throws if any CREDIT_BUYBACK
      // rows exist (expected — you can't roll back after recording buy-backs).
      db.exec(`
        CREATE TABLE recharges_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          carrier TEXT NOT NULL,
          recharge_type TEXT CHECK(recharge_type IN ('CREDIT_TRANSFER', 'VOUCHER', 'DAYS', 'TOP_UP', 'ALFA_GIFT')) NOT NULL DEFAULT 'CREDIT_TRANSFER',
          amount DECIMAL(10, 2) NOT NULL,
          cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
          price DECIMAL(10, 2) NOT NULL DEFAULT 0,
          default_price_to_client REAL DEFAULT NULL,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          paid_by TEXT DEFAULT 'CASH',
          phone_number TEXT,
          client_id INTEGER,
          client_name TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by INTEGER DEFAULT 1,
          edited_by TEXT DEFAULT NULL,
          edited_at TEXT DEFAULT NULL,
          is_refunded INTEGER DEFAULT 0,
          refunded_at TEXT DEFAULT NULL,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );

        INSERT INTO recharges_old (
          id, tenant_id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        )
        SELECT
          id, tenant_id, carrier, recharge_type, amount, cost, price, default_price_to_client,
          currency_code, paid_by, phone_number, client_id, client_name, note,
          created_at, created_by, edited_by, edited_at, is_refunded, refunded_at
        FROM recharges;

        DROP TABLE recharges;
        ALTER TABLE recharges_old RENAME TO recharges;

        CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
        CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
        CREATE INDEX IF NOT EXISTS idx_recharges_tenant_id ON recharges(tenant_id);
      `);
      console.log(
        "Migration v149 rolled back: removed 'CREDIT_BUYBACK' from recharges.recharge_type CHECK",
      );
    },
  },
  {
    version: 150,
    name: "commission_at_settlement_foundation",
    description:
      "COMMISSION_AT_SETTLEMENT_PLAN.md Phase 0 (D2/D3/D5/D6/D8): lays the shared machinery for entering supplier commission AT SETTLEMENT instead of guessing it at transaction time. Adds financial_services.commission_model as the per-row cutover flag (D3, precedent: v115 supplier_debt_booked) — 0 = EMBEDDED (the pre-existing guess-at-creation model; every pre-existing row reads 0 unchanged after this ALTER), 1 = AT_SETTLEMENT (stamped by the insert path only for BILL rows — Phase 1's actual scope; OMT/WHISH stay 0 until Phase 2's gross-payable flip ships, since their supplier_owed is still commission-netted at creation and stamping them 1 early would double-subtract the commission at settlement). A per-row flag beats a date/version cutoff because this is a multi-tenant single DB with backdated rows, and reversal must branch per row. Adds supplier_settlements (D5: real commission storage per settlement batch — gross/commission per currency, entry_mode LUMP/RATE, rate, unit_count, model, uniquely linked to the settlement's own supplier_ledger SETTLEMENT row via ledger_entry_id so a settlement's commission entry is found by ID, never by time proximity — the LIRA-085 lesson) and settlement_commission_allocations (D6: one row per settled financial_services row, per-currency share — chosen over stamp-back, which mutates posted rows and retroactively rewrites closed-period reports, and over pure query-time derivation, which can't give FOR-partner rows a frozen, independently-gated per-row record). Adds suppliers.commission_entry_mode/commission_rate (D8: per-supplier entry-mode preference, pre-selected at settlement time; the settlement itself snapshots the actually-used mode/rate/count onto supplier_settlements rather than relying on shared UI state, which isn't shared across the desktop/web transports per CLAUDE.md rule 19). Fresh installs (create_db.sql) also declare commission_model DEFAULT 0 — the safe/legacy value; only the repository's explicit BILL-gated stamp ever writes 1.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Defensive against a suppliers-less / financial_services-less DB —
      // same reasoning as v149's `hasRecharges` guard (see this migration's
      // down() for the full explanation): a synthetic test-harness scenario
      // marks every OTHER migration applied on a minimal fixture schema and
      // replays every pending migration through the real runner, this one
      // included. A real upgrading install always has both tables
      // (financial_services since v1, suppliers since v11) long before v150,
      // so this guard never fires there.
      const hasSuppliers = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'suppliers'`,
        )
        .get();
      const hasFinancialServices = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'financial_services'`,
        )
        .get();
      if (!hasSuppliers || !hasFinancialServices) {
        console.log(
          "Migration v150 skipped: 'suppliers' or 'financial_services' table not present",
        );
        return;
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS supplier_settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
          ledger_entry_id INTEGER NOT NULL UNIQUE REFERENCES supplier_ledger(id) ON DELETE CASCADE,
          gross_usd REAL NOT NULL DEFAULT 0,
          gross_lbp REAL NOT NULL DEFAULT 0,
          commission_usd REAL NOT NULL DEFAULT 0,
          commission_lbp REAL NOT NULL DEFAULT 0,
          entry_mode TEXT NOT NULL DEFAULT 'LUMP' CHECK(entry_mode IN ('LUMP', 'RATE')),
          rate REAL,
          unit_count INTEGER,
          model INTEGER NOT NULL CHECK(model IN (0, 1)),
          created_by INTEGER REFERENCES users(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_supplier_settlements_supplier_id
          ON supplier_settlements(supplier_id);
        CREATE INDEX IF NOT EXISTS idx_supplier_settlements_tenant_id
          ON supplier_settlements(tenant_id);

        CREATE TABLE IF NOT EXISTS settlement_commission_allocations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER REFERENCES tenants(id),
          settlement_ledger_id INTEGER NOT NULL REFERENCES supplier_ledger(id) ON DELETE CASCADE,
          financial_service_id INTEGER NOT NULL REFERENCES financial_services(id) ON DELETE CASCADE,
          service_type TEXT NOT NULL,
          provider TEXT NOT NULL,
          commission_usd REAL NOT NULL DEFAULT 0,
          commission_lbp REAL NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sca_settlement_ledger_id
          ON settlement_commission_allocations(settlement_ledger_id);
        CREATE INDEX IF NOT EXISTS idx_sca_financial_service_id
          ON settlement_commission_allocations(financial_service_id);
        CREATE INDEX IF NOT EXISTS idx_sca_tenant_id
          ON settlement_commission_allocations(tenant_id);

        ALTER TABLE financial_services
          ADD COLUMN commission_model INTEGER NOT NULL DEFAULT 0;

        ALTER TABLE suppliers
          ADD COLUMN commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP';
        ALTER TABLE suppliers
          ADD COLUMN commission_rate REAL;
      `);

      console.log(
        "Migration v150: supplier_settlements + settlement_commission_allocations created; " +
          "financial_services.commission_model (default 0, existing rows unaffected) + " +
          "suppliers.commission_entry_mode/commission_rate added",
      );
    },
    down(db: Database.Database) {
      // Defensive against a suppliers-less / financial_services-less DB —
      // same reasoning as v149's `hasRecharges` guard: a synthetic
      // test-harness scenario (`telecomDaysCostMigrationsViaRunner.test.ts`'s
      // `markAppliedExcept`) marks every OTHER migration applied on a minimal
      // fixture schema and rolls back EVERY migration above its target
      // through this exact rollbackTo() path, this one included, even though
      // this migration's own up() never really ran there. A real upgrading
      // install always has both tables (financial_services since v1,
      // suppliers since v11) long before v150, so these guards never fire
      // there.
      const hasSuppliers = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'suppliers'`,
        )
        .get();
      if (hasSuppliers) {
        db.exec(`
          ALTER TABLE suppliers DROP COLUMN commission_rate;
          ALTER TABLE suppliers DROP COLUMN commission_entry_mode;
        `);
      }

      const hasFinancialServices = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'financial_services'`,
        )
        .get();
      if (hasFinancialServices) {
        db.exec(`ALTER TABLE financial_services DROP COLUMN commission_model;`);
      }

      db.exec(`
        DROP TABLE IF EXISTS settlement_commission_allocations;
        DROP TABLE IF EXISTS supplier_settlements;
      `);

      console.log(
        "Migration v150 rolled back: supplier_settlements + settlement_commission_allocations dropped; " +
          "commission_model/commission_entry_mode/commission_rate columns dropped" +
          (hasSuppliers && hasFinancialServices
            ? ""
            : " (some columns skipped — parent table absent in this DB)"),
      );
    },
  },
  {
    version: 151,
    name: "commission_at_settlement_provider_eligibility",
    description:
      "COMMISSION_AT_SETTLEMENT_PLAN.md §6 D12 / LIRA-112 — 'iPick bills give us no commission, but Katsh does.' Both the pre-plan code and Phase 0/1 (v150) treated the two providers identically: the legacy per-bill booking fired for ANY bill provider, and the new PENDING_SETTLEMENT_SQL/isPendingSupplierSettlement BILL branch hardcoded `provider IN ('iPick','Katsh')` with no distinction between them — so iPick has been credited (and, post-v150, queued for settlement on) a commission it never earned. This migration replaces that provider-name hardcode with a per-supplier config bit: adds suppliers.commission_eligible (INTEGER, default 1 — every existing supplier keeps today's 'can enter commission at settlement' behavior unchanged) and suppliers.commission_rate_currency (TEXT 'USD'|'LBP', default 'USD' — commission_rate (v150) was specced in USD, but Katsh's real-world rate is 20,000 LBP per bill, so a currency companion is required to interpret it correctly; USD default preserves the original spec assumption for every supplier except Katsh). Data backfill for EVERY existing tenant's iPick/Katsh rows (matched by `provider`, not `tenant_id`, forward-only per the owner's 2026-08-08 'historical ipick leave them i dont care' decision — this does not touch any already-posted commission, only the config that gates FUTURE bills): iPick -> commission_eligible = 0 (no commission, ever); Katsh -> commission_eligible = 1, commission_entry_mode = 'RATE', commission_rate = 20000, commission_rate_currency = 'LBP'. The repository-level fix (FinancialServiceRepository's PENDING_SETTLEMENT_SQL/isPendingSupplierSettlement) reads commission_eligible instead of a provider-name list, so a HYPOTHETICAL future bill provider is correct by default (eligible, LUMP) without another repository edit — only its own suppliers row needs configuring, exactly like this migration does for Katsh.",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Same defensive guard as v150 (see that migration's comment) — a
      // synthetic test-harness scenario replays every pending migration
      // against a minimal fixture schema that never created `suppliers`.
      const hasSuppliers = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'suppliers'`,
        )
        .get();
      if (!hasSuppliers) {
        console.log("Migration v151 skipped: 'suppliers' table not present");
        return;
      }

      db.exec(`
        ALTER TABLE suppliers
          ADD COLUMN commission_eligible INTEGER NOT NULL DEFAULT 1 CHECK(commission_eligible IN (0, 1));
        ALTER TABLE suppliers
          ADD COLUMN commission_rate_currency TEXT CHECK(commission_rate_currency IN ('USD', 'LBP')) DEFAULT 'USD';
      `);

      // Forward-only data-driven fix (rule 14 — this is the ONLY place a
      // provider name appears; every read path from here on branches on
      // commission_eligible, never on 'iPick'/'Katsh' literals). Matched by
      // `provider` across ALL tenants — every existing tenant's iPick/Katsh
      // supplier row gets corrected, not just tenant 1.
      db.exec(`
        UPDATE suppliers SET commission_eligible = 0 WHERE provider = 'iPick';
        UPDATE suppliers SET commission_eligible = 1,
                              commission_entry_mode = 'RATE',
                              commission_rate = 20000,
                              commission_rate_currency = 'LBP'
          WHERE provider = 'Katsh';
      `);

      console.log(
        "Migration v151: suppliers.commission_eligible/commission_rate_currency added " +
          "(default eligible/USD, every OTHER existing supplier unaffected); " +
          "iPick backfilled commission_eligible = 0 (no commission), " +
          "Katsh backfilled commission_eligible = 1 / RATE / 20000 / LBP",
      );
    },
    down(db: Database.Database) {
      const hasSuppliers = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'suppliers'`,
        )
        .get();
      if (!hasSuppliers) {
        console.log(
          "Migration v151 rollback skipped: 'suppliers' table not present",
        );
        return;
      }

      // Revert Katsh's v150-column data (commission_entry_mode/commission_rate
      // are NOT dropped by this migration — they're v150's — so this migration's
      // own writes to them must be undone explicitly for a clean round-trip).
      // iPick's v150 columns were never touched by up(), nothing to revert there.
      db.exec(`
        UPDATE suppliers SET commission_entry_mode = 'LUMP', commission_rate = NULL
          WHERE provider = 'Katsh';

        ALTER TABLE suppliers DROP COLUMN commission_rate_currency;
        ALTER TABLE suppliers DROP COLUMN commission_eligible;
      `);

      console.log(
        "Migration v151 rolled back: commission_eligible/commission_rate_currency dropped; " +
          "Katsh's commission_entry_mode/commission_rate reverted to the v150 default",
      );
    },
  },
  {
    version: 152,
    name: "custom_services_product_id_stock_link",
    description:
      "FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 FINAL SPEC — 'an inventory-backed custom " +
      "service behaves like a POS sale: stock decrements, no cash row' (§2a already removed the " +
      "cash row, commit d1a0ad2 — this is the missing stock half). Blocker the characterization " +
      "matrix proved (CustomServiceRepository.scenarioMatrix.test.ts, scenarios A1/A2/A3): the " +
      "preset / inventory-item / free-text input paths are byte-identical by the time they reach " +
      "the repository — no column records which product (if any) was involved, so stock never " +
      "moved for the inventory path. Adds custom_services.product_id (nullable, FK to products) " +
      "so CustomServiceRepository can decrement it on create and restore it on void/refund. " +
      "Existing rows get NULL -> unchanged behaviour (no stock movement), which is the correct " +
      "cutover: historical rows are not retro-adjusted (same D3 precedent as every other §2 " +
      "cutover in this plan). No `quantity` column: the Custom Services form never lets the " +
      "operator choose a quantity for a single ad-hoc service (unlike a POS sale_items row) — " +
      "exactly 1 unit is consumed whenever product_id is set, and exactly 1 unit is restored on " +
      "reversal. This is a deliberate scope decision, not an oversight — add a quantity column " +
      "explicitly in a future migration if the form ever grows a quantity control.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const hasCustomServices = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'custom_services'`,
        )
        .get();
      if (!hasCustomServices) {
        console.log(
          "Migration v152 skipped: 'custom_services' table not present",
        );
        return;
      }

      const cols = db.prepare("PRAGMA table_info(custom_services)").all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "product_id")) {
        db.exec(
          `ALTER TABLE custom_services ADD COLUMN product_id INTEGER REFERENCES products(id);`,
        );
      }

      console.log(
        "Migration v152: custom_services.product_id added (nullable, existing rows NULL -> no stock movement)",
      );
    },
    down(db: Database.Database) {
      const hasCustomServices = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'custom_services'`,
        )
        .get();
      if (!hasCustomServices) {
        console.log(
          "Migration v152 rollback skipped: 'custom_services' table not present",
        );
        return;
      }

      const cols = db.prepare("PRAGMA table_info(custom_services)").all() as {
        name: string;
      }[];
      if (cols.some((c) => c.name === "product_id")) {
        db.exec(`ALTER TABLE custom_services DROP COLUMN product_id;`);
      }

      console.log(
        "Migration v152 rolled back: custom_services.product_id dropped",
      );
    },
  },
  {
    version: 153,
    name: "add_service_providers_table",
    description:
      "FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 1 — introduce " +
      "`service_providers`, the provider-taxonomy config table, mirroring " +
      "the existing `payment_methods` precedent (create_db.sql:1309-1330) " +
      "exactly: code/label/drawer_name/is_system_provider/is_active/" +
      "is_system/sort_order, tenant-scoped. Seeded with the 9 existing " +
      "financial_services.provider CHECK-constraint values (OMT, WHISH, " +
      "BOB, OTHER, iPick, Katsh, WHISH_APP, OMT_APP, BINANCE); drawer names " +
      "match FinancialServiceRepository.mapDrawerName's hardcoded switch " +
      "byte-for-byte (OMT->OMT_System, WHISH->Whish_System, " +
      "iPick->iPick, Katsh->Katsh, WHISH_APP->Whish_App, OMT_APP->OMT_App, " +
      "BINANCE->Binance, BOB/OTHER->General). is_system_provider=1 only for " +
      "OMT/WHISH — the two providers eligible for partners.system_association " +
      "/ Primary-Cash-Drawer routing today; every other provider is 0. " +
      "Nothing reads this table yet (phase 2, a follow-up change, points " +
      "FinancialServiceRepository.mapDrawerName at it with the current " +
      "switch kept as the offline fallback) — this migration alone is " +
      "zero behaviour change. Applied to every existing tenant, same " +
      "pattern as migration v125.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_providers (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id          INTEGER REFERENCES tenants(id),
          code               TEXT NOT NULL,
          label              TEXT NOT NULL,
          drawer_name        TEXT NOT NULL,
          is_system_provider INTEGER NOT NULL DEFAULT 0,
          is_active          INTEGER NOT NULL DEFAULT 1,
          is_system          INTEGER NOT NULL DEFAULT 0,
          sort_order         INTEGER NOT NULL DEFAULT 0,
          created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, code)
        );
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_service_providers_tenant_id ON service_providers(tenant_id);`,
      );

      // Seed the 9 existing provider codes for every existing tenant.
      // Mirrors migration v125's `SELECT id, ... FROM tenants` pattern so
      // every tenant (not just tenant 1) gets the seed, and re-running is
      // idempotent via INSERT OR IGNORE + the (tenant_id, code) UNIQUE.
      const insert = db.prepare(
        `INSERT OR IGNORE INTO service_providers
           (tenant_id, code, label, drawer_name, is_system_provider, is_active, is_system, sort_order)
         SELECT id, ?, ?, ?, ?, 1, 1, ? FROM tenants`,
      );
      const seeds: {
        code: string;
        label: string;
        drawerName: string;
        isSystemProvider: number;
        sortOrder: number;
      }[] = [
        {
          code: "OMT",
          label: "OMT",
          drawerName: "OMT_System",
          isSystemProvider: 1,
          sortOrder: 0,
        },
        {
          code: "WHISH",
          label: "Whish",
          drawerName: "Whish_System",
          isSystemProvider: 1,
          sortOrder: 1,
        },
        {
          code: "BOB",
          label: "BOB",
          drawerName: "General",
          isSystemProvider: 0,
          sortOrder: 2,
        },
        {
          code: "OTHER",
          label: "Other",
          drawerName: "General",
          isSystemProvider: 0,
          sortOrder: 3,
        },
        {
          code: "iPick",
          label: "iPick",
          drawerName: "iPick",
          isSystemProvider: 0,
          sortOrder: 4,
        },
        {
          code: "Katsh",
          label: "Katsh",
          drawerName: "Katsh",
          isSystemProvider: 0,
          sortOrder: 5,
        },
        {
          code: "WHISH_APP",
          label: "Whish App",
          drawerName: "Whish_App",
          isSystemProvider: 0,
          sortOrder: 6,
        },
        {
          code: "OMT_APP",
          label: "OMT App",
          drawerName: "OMT_App",
          isSystemProvider: 0,
          sortOrder: 7,
        },
        {
          code: "BINANCE",
          label: "Binance",
          drawerName: "Binance",
          isSystemProvider: 0,
          sortOrder: 8,
        },
      ];

      let totalSeeded = 0;
      for (const s of seeds) {
        const res = insert.run(
          s.code,
          s.label,
          s.drawerName,
          s.isSystemProvider,
          s.sortOrder,
        );
        totalSeeded += res.changes;
      }

      console.log(
        `Migration v153: service_providers table created; ${totalSeeded} row(s) seeded across all tenants (9 provider codes each)`,
      );
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS service_providers;`);
      console.log(
        "Migration v153 rolled back: service_providers table dropped",
      );
    },
  },
  {
    version: 154,
    name: "financial_services_provider_check_to_fk",
    description:
      "FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 3 — relax financial_services.provider " +
      "from the closed 9-value CHECK (OMT/WHISH/BOB/OTHER/iPick/Katsh/WHISH_APP/OMT_APP/BINANCE, " +
      "create_db.sql pre-v154) to a composite FOREIGN KEY (tenant_id, provider) REFERENCES " +
      "service_providers(tenant_id, code) — deliberately NOT a bare `REFERENCES " +
      "service_providers(code)` as the plan's own §5b phase-3 wording suggested. Verified with a " +
      "throwaway better-sqlite3 script (PRAGMA foreign_keys=ON, matching electron-app/main.ts:327 " +
      "and backend/src/database/connection.ts:68, both of which enable FK enforcement at every real " +
      "connection open — this is NOT a dead/decorative FK in this codebase): a bare single-column FK " +
      "against `code` throws 'foreign key mismatch' on EVERY prepared statement touching " +
      "financial_services, not just violating rows, because service_providers only carries " +
      "UNIQUE(tenant_id, code) (v153) — no unique index on `code` alone (multi-tenant backend seeds " +
      "the SAME 9 codes per tenant by design, so `code` genuinely repeats across tenants). The " +
      "literal plan wording would have broken every financial_services read/write in production the " +
      "moment this shipped. The composite form matches the ACTUAL unique index and was verified " +
      "working end-to-end (valid provider accepted, bogus provider rejected, foreign_key_check clean) " +
      "against both a synthetic DB and a copy of the real accumulated production database. " +
      "SQLite can't ALTER a CHECK, so this is a full table rebuild in the shape of v105/v106/v123: " +
      "read financial_services' OWN live CREATE-TABLE text from sqlite_master (never retyped from " +
      "memory — this migration was written by diffing the actual runtime schema, not create_db.sql, " +
      "and the transform matches whether the live text is ALTER-appended production formatting or " +
      "create_db.sql's hand-written formatting), swap the provider CHECK clause for a plain NOT NULL " +
      "column plus the new table-level composite FK, copy every row with INSERT...SELECT * (so column " +
      "count/order is never hand-retyped), drop, rename, recreate all 7 pre-existing indexes captured " +
      "from live sqlite_master before the drop (idx_financial_services_is_settled/" +
      "provider_settled/tenant_id/provider_type_created_at/created_at/paid_by/client_id — no triggers " +
      "exist on this table, verified against both create_db.sql and the real DB, so none need " +
      "recreating, though the code stays defensive and would recreate any it found). " +
      "financial_services carries NO generated columns (verified — profit_usd/profit_lbp are " +
      "GENERATED only on custom_services, a different table) so that hazard does not apply here. " +
      "tenant_id is nullable on financial_services (pre-multi-tenant legacy rows, predating v123 — " +
      "financial_services was never in v123's tenant-scoped-rebuild list); SQLite's standard " +
      "composite-FK NULL semantics exempt any such row from the new check entirely — the correct " +
      "'leave history alone, apply forward' behavior (rule 20 / D3 precedent), not a loophole opened " +
      "by this migration. A gotcha the round-trip test on the real DB copy caught: after " +
      "`ALTER TABLE … RENAME TO financial_services`, SQLite re-serializes the stored CREATE TABLE " +
      'text with the table name double-quoted (`CREATE TABLE "financial_services" (`) — the ' +
      "table-name swap regex below matches both the quoted and unquoted forms, or down() would silently " +
      "fail to rename its rebuild target and collide with the live table. Self-guards with an explicit " +
      "PRAGMA foreign_key_check after the rebuild (mirrors v123 §4) since FK enforcement is OFF for " +
      "the whole migration batch (runMigrations' own wrapper) and would not otherwise catch a broken " +
      "FK before it reached production. " +
      "Zod's createFinancialServiceSchema.provider / getFinancialServicesSchema.provider " +
      "(packages/core/src/validators/financial.ts, shared by electron-app + backend per rule 19) are " +
      "relaxed from a closed z.enum(9) to a constrained non-empty string in the same change — a Zod " +
      "schema is a pure function with no DB handle, so it cannot check service_providers membership " +
      "itself (that would couple a shared validator to a live connection); the membership check " +
      "instead lives at the service boundary (FinancialService.addTransaction, before the repository " +
      "write), mirroring mapDrawerName's existing try/catch-missing-table fallback so the ~55 " +
      "repository test files that hand-build a financial_services-only schema (no service_providers " +
      "table) keep passing unchanged — a typo'd provider now surfaces as a clear service-layer error " +
      "instead of either a Zod rejection (no longer possible, the whole point of this phase) or a raw " +
      "SQLITE_CONSTRAINT bubbling out of the INSERT.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const hasFinancialServices = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'financial_services'`,
        )
        .get();
      const hasServiceProviders = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'service_providers'`,
        )
        .get();
      if (!hasFinancialServices || !hasServiceProviders) {
        console.log(
          "Migration v154 skipped: 'financial_services' or 'service_providers' table not present",
        );
        return;
      }

      const tbl = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='financial_services'`,
        )
        .get() as { sql: string };

      const FK_MARKER =
        "FOREIGN KEY (tenant_id, provider) REFERENCES service_providers";
      if (tbl.sql.includes(FK_MARKER)) {
        console.log(
          "Migration v154 skipped: financial_services.provider FK already present",
        );
        return;
      }

      const CHECK_CLAUSE =
        "provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'iPick', 'Katsh', 'WHISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,";
      if (!tbl.sql.includes(CHECK_CLAUSE)) {
        throw new Error(
          "Migration v154: expected provider CHECK clause not found verbatim in the live " +
            "financial_services DDL — schema drift from what this migration was written against. " +
            "Aborting rather than guessing at the column list (this is a money table).",
        );
      }

      // Capture index + trigger DDL before the table is dropped. financial_services
      // has no triggers today (verified) — this stays defensive for future-proofing.
      const idx = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='financial_services' AND sql IS NOT NULL`,
        )
        .all() as { sql: string }[];
      const triggers = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='financial_services' AND sql IS NOT NULL`,
        )
        .all() as { sql: string }[];

      // Table-name swap handles BOTH the unquoted form (first time this table is
      // rebuilt) and the double-quoted form SQLite re-serializes into
      // sqlite_master after any prior `ALTER TABLE … RENAME TO` — see the
      // description above.
      let newSql = tbl.sql
        .replace(
          /^CREATE TABLE (IF NOT EXISTS )?"?financial_services"?\s*\(/,
          "CREATE TABLE financial_services_new (",
        )
        .replace(CHECK_CLAUSE, "provider TEXT NOT NULL,");
      newSql = newSql.replace(
        /\)\s*$/,
        ",\n    FOREIGN KEY (tenant_id, provider) REFERENCES service_providers(tenant_id, code)\n)",
      );

      db.exec(newSql);
      db.exec(
        `INSERT INTO financial_services_new SELECT * FROM financial_services;`,
      );
      db.exec(`DROP TABLE financial_services;`);
      db.exec(
        `ALTER TABLE financial_services_new RENAME TO financial_services;`,
      );
      for (const r of idx) db.exec(r.sql);
      for (const r of triggers) db.exec(r.sql);

      // Self-guard: fail loudly if the rebuild left any FK dangling (mirrors
      // v123 §4) — foreign_keys enforcement is OFF for the whole migration
      // batch, so this is the only thing that would catch a broken FK here.
      const fkViolations = db.pragma("foreign_key_check") as unknown[];
      if (fkViolations.length > 0) {
        throw new Error(
          `Migration v154: foreign_key_check found ${fkViolations.length} violation(s) after rebuild: ${JSON.stringify(fkViolations)}`,
        );
      }

      console.log(
        "Migration v154: financial_services.provider CHECK relaxed to a composite FK " +
          "(tenant_id, provider) -> service_providers(tenant_id, code); all rows copied, " +
          "all 7 indexes recreated, foreign_key_check clean",
      );
    },
    down(db: Database.Database) {
      const hasFinancialServices = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'financial_services'`,
        )
        .get();
      if (!hasFinancialServices) {
        console.log(
          "Migration v154 rollback skipped: 'financial_services' table not present",
        );
        return;
      }

      const tbl = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='financial_services'`,
        )
        .get() as { sql: string };

      const FK_SUFFIX =
        ",\n    FOREIGN KEY (tenant_id, provider) REFERENCES service_providers(tenant_id, code)\n)";
      if (!tbl.sql.includes(FK_SUFFIX)) {
        console.log(
          "Migration v154 rollback skipped: financial_services.provider FK not present " +
            "(migration was never applied, or already rolled back)",
        );
        return;
      }

      // A provider added via service_providers after this migration shipped
      // (phase 4/5: a new operator-created code, e.g. a future 'SYRIA') cannot
      // satisfy the ORIGINAL closed CHECK being restored — the same "data the
      // older constraint can't represent" situation v106's down() hit with BILL
      // rows. Removing those rows (not silently keeping an unenforceable value,
      // and not failing the whole rollback) is the only way this round-trip can
      // succeed; mirrors v106's precedent.
      const KNOWN_PROVIDERS = [
        "OMT",
        "WHISH",
        "BOB",
        "OTHER",
        "iPick",
        "Katsh",
        "WHISH_APP",
        "OMT_APP",
        "BINANCE",
      ];
      const placeholders = KNOWN_PROVIDERS.map(() => "?").join(", ");
      const deleted = db
        .prepare(
          `DELETE FROM financial_services WHERE provider NOT IN (${placeholders})`,
        )
        .run(...KNOWN_PROVIDERS);
      if (deleted.changes > 0) {
        console.warn(
          `Migration v154 rollback: removed ${deleted.changes} financial_services row(s) whose ` +
            "provider is outside the original 9-value CHECK set (cannot be represented once the " +
            "CHECK is restored)",
        );
      }

      const idx = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='financial_services' AND sql IS NOT NULL`,
        )
        .all() as { sql: string }[];
      const triggers = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='financial_services' AND sql IS NOT NULL`,
        )
        .all() as { sql: string }[];

      const CHECK_CLAUSE =
        "provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'iPick', 'Katsh', 'WHISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,";

      let revertedSql = tbl.sql
        .replace(
          /^CREATE TABLE (IF NOT EXISTS )?"?financial_services"?\s*\(/,
          "CREATE TABLE financial_services_old (",
        )
        .replace(FK_SUFFIX, ")")
        .replace("provider TEXT NOT NULL,", CHECK_CLAUSE);

      db.exec(revertedSql);
      db.exec(
        `INSERT INTO financial_services_old SELECT * FROM financial_services;`,
      );
      db.exec(`DROP TABLE financial_services;`);
      db.exec(
        `ALTER TABLE financial_services_old RENAME TO financial_services;`,
      );
      for (const r of idx) db.exec(r.sql);
      for (const r of triggers) db.exec(r.sql);

      console.log(
        "Migration v154 rolled back: financial_services.provider FK replaced with the original " +
          "9-value CHECK constraint",
      );
    },
  },
  {
    version: 155,
    name: "partners_system_association_to_fk",
    description:
      "FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4b — referential integrity for " +
      "partners.system_association. The column was unconstrained TEXT (create_db.sql pre-v155, " +
      "migration v79/v78) with no FK, no enum, no CHECK — a custom provider (e.g. the owner's live " +
      "'SYRIA' entry, created via the phase-5 Settings UI) could be deleted out from under an " +
      "associated partner, since ServiceProviderRepository.deleteProvider only blocked is_system=1 " +
      "rows, leaving a dangling system_association that silently matched no provider anywhere " +
      "downstream. Adds a composite FOREIGN KEY (tenant_id, system_association) REFERENCES " +
      "service_providers(tenant_id, code) — the SAME composite shape v154 used for " +
      "financial_services.provider, and for the SAME reason: service_providers only carries " +
      "UNIQUE(tenant_id, code) (v153), not a unique index on code alone (multi-tenant seeds the SAME " +
      "9 built-in codes per tenant by design), so a bare `REFERENCES service_providers(code)` would " +
      "throw 'foreign key mismatch' on EVERY statement against partners. system_association stays " +
      "NULLABLE — a partner legitimately has no system ('None' in the dropdown) — which is safe " +
      "because SQLite's standard composite-FK NULL semantics exempt a row from enforcement entirely " +
      "when ANY column of the composite key is NULL: this covers both a NULL system_association AND " +
      "the one pre-multi-tenant legacy partner row found on the live database during this migration's " +
      "pre-flight check (tenant_id NULL, system_association 'WHISH') the same way v154 exempted " +
      "financial_services' own NULL-tenant_id legacy rows — proved with an explicit test (a NULL " +
      "system_association insert/update succeeds untouched by the FK). Verified against a copy of " +
      "the real accumulated production database: every tenant-scoped partner's system_association " +
      "already matches a real service_providers(tenant_id, code) row, including the owner's own " +
      "'SYRIA' provider/partner pair — zero rows needed nulling out, zero data lost. " +
      "SQLite can't ALTER a column into a table-level FK, so like v105/v106/v123/v154 this is a full " +
      "table rebuild: read partners' OWN live CREATE-TABLE text from sqlite_master (never retyped " +
      "from memory), append the new table-level composite FK, copy every row with INSERT...SELECT * " +
      "(column count/order never hand-retyped), drop, rename. partners carries no named indexes " +
      "beyond its own UNIQUE(tenant_id, name) constraint's autoindex (sqlite_autoindex_partners_1, " +
      "verified against both create_db.sql and the real DB — SQLite recreates this automatically from " +
      "the UNIQUE clause in the rebuilt table, nothing to replay) and no triggers, both verified empty; " +
      "the code stays defensive and would recreate any named index/trigger it found, mirroring v154. " +
      "The concrete bug this closes is guarded on BOTH sides per the plan: " +
      "ServiceProviderRepository.deleteProvider (this same change) now refuses to delete a provider " +
      "still named in any partner's system_association, naming the referencing partner(s) in a clear " +
      "error BEFORE the DELETE statement runs — this migration's FK is the backstop for any path that " +
      "skips the repository method (e.g. a future raw script), turning what would otherwise be a " +
      "silent dangling reference into a loud SQLITE_CONSTRAINT instead. Self-guards with an explicit " +
      "PRAGMA foreign_key_check after the rebuild (mirrors v123 §4 / v154) since FK enforcement is OFF " +
      "for the whole migration batch. A gotcha inherited from v154: after `ALTER TABLE … RENAME TO`, " +
      "SQLite re-serializes the stored CREATE TABLE text with the table name double-quoted " +
      '(`CREATE TABLE "partners" (`) — the table-name swap regex below matches both the quoted and ' +
      "unquoted forms, or down() would silently fail to rename its rebuild target and collide with " +
      "the live table. Unlike v154's own down(), this down() is data-lossless: reverting " +
      "system_association to unconstrained TEXT can represent every value already stored (including " +
      "a post-migration 'SYRIA'-style association added after this shipped) — there is no CHECK to " +
      "fail to satisfy on rollback, so nothing needs deleting.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const hasPartners = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partners'`,
        )
        .get();
      const hasServiceProviders = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'service_providers'`,
        )
        .get();
      if (!hasPartners || !hasServiceProviders) {
        console.log(
          "Migration v155 skipped: 'partners' or 'service_providers' table not present",
        );
        return;
      }

      const tbl = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='partners'`,
        )
        .get() as { sql: string };

      const FK_MARKER =
        "FOREIGN KEY (tenant_id, system_association) REFERENCES service_providers";
      if (tbl.sql.includes(FK_MARKER)) {
        console.log(
          "Migration v155 skipped: partners.system_association FK already present",
        );
        return;
      }

      if (!tbl.sql.includes("system_association")) {
        throw new Error(
          "Migration v155: expected 'system_association' column not found verbatim in the live " +
            "partners DDL — schema drift from what this migration was written against. Aborting " +
            "rather than guessing at the column list (this is partner data).",
        );
      }

      // Capture index + trigger DDL before the table is dropped. partners has
      // no named indexes beyond its own UNIQUE(tenant_id, name) autoindex
      // (recreated automatically by the UNIQUE clause in the rebuilt table)
      // and no triggers today (verified) — this stays defensive for
      // future-proofing, mirroring v154.
      const idx = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='partners' AND sql IS NOT NULL`,
        )
        .all() as { sql: string }[];
      const triggers = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='partners' AND sql IS NOT NULL`,
        )
        .all() as { sql: string }[];

      // Table-name swap handles BOTH the unquoted form (first time this table
      // is rebuilt) and the double-quoted form SQLite re-serializes into
      // sqlite_master after any prior `ALTER TABLE … RENAME TO` — see the
      // description above.
      let newSql = tbl.sql.replace(
        /^CREATE TABLE (IF NOT EXISTS )?"?partners"?\s*\(/,
        "CREATE TABLE partners_new (",
      );
      newSql = newSql.replace(
        /\)\s*$/,
        ",\n    FOREIGN KEY (tenant_id, system_association) REFERENCES service_providers(tenant_id, code)\n)",
      );

      db.exec(newSql);
      db.exec(`INSERT INTO partners_new SELECT * FROM partners;`);
      db.exec(`DROP TABLE partners;`);
      db.exec(`ALTER TABLE partners_new RENAME TO partners;`);
      for (const r of idx) db.exec(r.sql);
      for (const r of triggers) db.exec(r.sql);

      // Self-guard: fail loudly if the rebuild left any FK dangling (mirrors
      // v123 §4 / v154) — foreign_keys enforcement is OFF for the whole
      // migration batch, so this is the only thing that would catch a broken
      // FK here.
      const fkViolations = db.pragma("foreign_key_check") as unknown[];
      if (fkViolations.length > 0) {
        throw new Error(
          `Migration v155: foreign_key_check found ${fkViolations.length} violation(s) after rebuild: ${JSON.stringify(fkViolations)}`,
        );
      }

      console.log(
        "Migration v155: partners.system_association relaxed to a composite FK (tenant_id, " +
          "system_association) -> service_providers(tenant_id, code); all rows copied, " +
          "foreign_key_check clean",
      );
    },
    down(db: Database.Database) {
      const hasPartners = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partners'`,
        )
        .get();
      if (!hasPartners) {
        console.log(
          "Migration v155 rollback skipped: 'partners' table not present",
        );
        return;
      }

      const tbl = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='partners'`,
        )
        .get() as { sql: string };

      const FK_SUFFIX =
        ",\n    FOREIGN KEY (tenant_id, system_association) REFERENCES service_providers(tenant_id, code)\n)";
      if (!tbl.sql.includes(FK_SUFFIX)) {
        console.log(
          "Migration v155 rollback skipped: partners.system_association FK not present " +
            "(migration was never applied, or already rolled back)",
        );
        return;
      }

      const idx = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='partners' AND sql IS NOT NULL`,
        )
        .all() as { sql: string }[];
      const triggers = db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='partners' AND sql IS NOT NULL`,
        )
        .all() as { sql: string }[];

      // Unlike v154's down(), no rows are ever deleted here: reverting to
      // unconstrained TEXT can represent every value already stored (see the
      // description above) — there is no CHECK to fail to satisfy.
      let revertedSql = tbl.sql
        .replace(
          /^CREATE TABLE (IF NOT EXISTS )?"?partners"?\s*\(/,
          "CREATE TABLE partners_old (",
        )
        .replace(FK_SUFFIX, ")");

      db.exec(revertedSql);
      db.exec(`INSERT INTO partners_old SELECT * FROM partners;`);
      db.exec(`DROP TABLE partners;`);
      db.exec(`ALTER TABLE partners_old RENAME TO partners;`);
      for (const r of idx) db.exec(r.sql);
      for (const r of triggers) db.exec(r.sql);

      console.log(
        "Migration v155 rolled back: partners.system_association FK removed, column reverted to " +
          "unconstrained TEXT",
      );
    },
  },
  {
    version: 156,
    name: "add_exchange_lot_settlement_tables",
    description:
      "EXCHANGE_LOT_SETTLEMENT.md Phase 1 — schema only, no behaviour change (nothing reads or " +
      "writes these tables yet; the FIFO engine is a follow-up change). Introduces cost-basis " +
      "lot tracking for exotic-currency (non-USD, non-LBP) exchange positions, replacing the " +
      "current half-spread-vs-mid-market profit snapshot for those currencies (Q1/Q8 of the " +
      "decision record). `exchange_lots` is one row per acquisition (an EXCHANGE_BUY leg, a " +
      "foreign-currency drawer top-up, or an admin ADJUSTMENT); `source_table`/`source_id` are " +
      "real ownership columns pointing at the row that created the lot, never a metadata_json id " +
      "list (TransactionRepository ~:3013 precedent). `exchange_lot_settlements` is one row per " +
      "(lot x consuming SELL event) — `lot_id` is nullable and `basis_source='MARKET'` marks the " +
      "Q6 uncovered-oversell slice (no lot backing it, basis = that day's stamped market rate). " +
      "`exchange_position_adjustments` is the Q15 admin drift-correction escape hatch (add at a " +
      "stated basis, or write off at zero profit); it moves no money and ties to no unified " +
      "transaction (justified in the plan's FEATURE_GUIDE §13 walkthrough, item 1). " +
      "currency_code uses the SAME composite FK shape as v154/v155 — FOREIGN KEY (tenant_id, " +
      "currency_code) REFERENCES currencies(tenant_id, code) — deliberately not a bare " +
      "`REFERENCES currencies(code)`, which would throw 'foreign key mismatch' on every " +
      "statement against these tables: currencies only carries UNIQUE(tenant_id, code) " +
      "(create_db.sql:148), not a unique index on code alone, since multi-tenant seeds the same " +
      "currency codes per tenant by design. tenant_id stays nullable on all three tables, " +
      "matching every other tenant-scoped table in this schema (exchange_transactions, " +
      "financial_services, partners, service_providers); SQLite's standard composite-FK NULL " +
      "semantics exempt a NULL-tenant_id row from the currency check entirely, same as v154/v155. " +
      "The FIFO index on exchange_lots is (tenant_id, currency_code, acquired_at, id) — id is the " +
      "tiebreak because created_at/acquired_at are only as precise as their stamped datetime and " +
      "two lots can share one (rule 15's second-granularity trap, applied here to lot ordering " +
      "rather than transaction ordering). No modules/currency_modules/currency_drawers rows: this " +
      "is not a new module, it hooks into the existing Exchange module's write path.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS exchange_lots (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id      INTEGER REFERENCES tenants(id),
          currency_code  TEXT NOT NULL,
          drawer_name    TEXT NOT NULL DEFAULT 'General',
          source_type    TEXT NOT NULL CHECK(source_type IN ('EXCHANGE_BUY', 'DRAWER_TOPUP', 'ADJUSTMENT')),
          source_table   TEXT,
          source_id      INTEGER,
          original_qty   REAL NOT NULL,
          remaining_qty  REAL NOT NULL,
          unit_cost_usd  REAL NOT NULL,
          acquired_at    DATETIME NOT NULL,
          is_voided      INTEGER NOT NULL DEFAULT 0,
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code)
        );
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_exchange_lots_tenant_id ON exchange_lots(tenant_id);`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_exchange_lots_fifo ON exchange_lots(tenant_id, currency_code, acquired_at, id);`,
      );

      db.exec(`
        CREATE TABLE IF NOT EXISTS exchange_lot_settlements (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id          INTEGER REFERENCES tenants(id),
          lot_id             INTEGER REFERENCES exchange_lots(id) ON DELETE SET NULL,
          basis_source       TEXT NOT NULL CHECK(basis_source IN ('LOT', 'MARKET')),
          settled_by_table   TEXT NOT NULL,
          settled_by_id      INTEGER NOT NULL,
          qty                REAL NOT NULL,
          unit_cost_usd      REAL NOT NULL,
          unit_proceeds_usd  REAL NOT NULL,
          profit_usd         REAL NOT NULL,
          is_refunded        INTEGER NOT NULL DEFAULT 0,
          refunded_at        TEXT,
          created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_exchange_lot_settlements_tenant_id ON exchange_lot_settlements(tenant_id);`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_exchange_lot_settlements_lot ON exchange_lot_settlements(tenant_id, lot_id);`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_exchange_lot_settlements_settled_by ON exchange_lot_settlements(tenant_id, settled_by_table, settled_by_id);`,
      );

      db.exec(`
        CREATE TABLE IF NOT EXISTS exchange_position_adjustments (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id      INTEGER REFERENCES tenants(id),
          currency_code  TEXT NOT NULL,
          qty            REAL NOT NULL,
          unit_cost_usd  REAL,
          note           TEXT,
          created_by     TEXT,
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code)
        );
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_exchange_position_adjustments_tenant_id ON exchange_position_adjustments(tenant_id);`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_exchange_position_adjustments_currency ON exchange_position_adjustments(tenant_id, currency_code);`,
      );

      console.log(
        "Migration v156: exchange_lots, exchange_lot_settlements, exchange_position_adjustments " +
          "tables created (schema only — no reads/writes wired up yet)",
      );
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS exchange_lot_settlements;`);
      db.exec(`DROP TABLE IF EXISTS exchange_position_adjustments;`);
      db.exec(`DROP TABLE IF EXISTS exchange_lots;`);
      console.log(
        "Migration v156 rolled back: exchange_lots, exchange_lot_settlements, " +
          "exchange_position_adjustments tables dropped",
      );
    },
  },
  {
    version: 157,
    name: "add_product_imei_units_and_warranty",
    description:
      "LIRA-143 phase 1 (current_sprint.md, owner-interviewed 2026-08-23) — schema only, no " +
      "behaviour change (nothing reads or writes product_units yet; ProductUnitRepository and " +
      "the sale/refund wiring are follow-up changes). Introduces `product_units`, one row per " +
      "physical IMEI-tracked unit of a product MODEL (decision #1: ONE product row per model, " +
      "e.g. 'iPhone 13' at stock N with a shared cost/price, not one product row per phone). " +
      "status IN_STOCK/SOLD; sale_item_id is the link to the sale line that sold it, nulled on " +
      "FK ON DELETE SET NULL rather than blocking a sale_items delete; is_defective and " +
      "warranty_override_until back decision #10's refund-time phone UI (operator may flag a " +
      "returned unit defective and/or set a forward warranty expiry by hand — an override, not " +
      "a computed value, per decision #11's lookup precedence: override beats the sale's own " +
      "stamp, which is voided outright on refund). The partial unique index " +
      "idx_product_units_active_imei enforces decision #3 (duplicate IMEI blocked) scoped to " +
      "`WHERE status = 'IN_STOCK'` only: a SOLD unit's IMEI may be re-registered on a different " +
      "product row (a legitimate correction path), and a refund flips the SAME row back to " +
      "IN_STOCK rather than inserting a new one, so that path can never collide with itself. " +
      "product_id/sale_item_id are bare single-column FOREIGN KEYs (not the v154/v155/v156 " +
      "composite-tenant-FK shape) because both target the PRIMARY KEY of their table — the " +
      "composite-FK requirement only applies to FKs targeting a non-PK unique column such as " +
      'currencies(tenant_id, code); do not "fix" this to a composite FK. Also: `warranty_months` ' +
      "on products (NULL = no warranty; decision #4 — the clock starts at sale time, not " +
      "intake, so it lives on the product as a duration, not a date); `tracks_imei_units` on " +
      "product_categories, backfilled to 1 for the row literally named 'Phones' only (decision " +
      "#9 — the seeded category, create_db.sql:277; a tenant who renamed it gets no auto-flag " +
      "by design, their path is the Settings toggle, not this migration); `warranty_until` on " +
      "sale_items (decision #4 — stamped per sale LINE at checkout as sale date + " +
      "warranty_months, because the sale is the event that starts the warranty clock, not the " +
      "product). Does NOT touch products.imei (stays as today's single free-text column this " +
      "phase) and does NOT remove products.warranty_expiry (the column stays; only " +
      "ProductRepository's projection of it is retired in this same change, per decision #4's " +
      "dead-column retirement). Each of the three ALTER TABLE ADD COLUMN blocks is guarded by " +
      "a sqlite_master table-existence check (not just the column-existence PRAGMA), since " +
      "some minimal migration-runner test DBs are built from a slice of migrations with no " +
      "create_db.sql base and may not have products/product_categories/sale_items yet — " +
      "PRAGMA table_info on a missing table returns an empty array rather than erroring, so " +
      "the naive column guard alone would walk straight into an ALTER on a table that isn't " +
      "there. Same house pattern as v154/v155's hasFinancialServices/hasPartners checks.",
    type: "typescript" as const,
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_units (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id                INTEGER REFERENCES tenants(id),
          product_id               INTEGER NOT NULL REFERENCES products(id),
          imei                     TEXT NOT NULL,
          status                   TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK', 'SOLD')),
          sale_item_id             INTEGER REFERENCES sale_items(id) ON DELETE SET NULL,
          is_defective             INTEGER NOT NULL DEFAULT 0,
          warranty_override_until  TEXT,
          created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      // Partial unique index: duplicate IMEI blocked only among in-stock
      // units (decision #3). A SOLD unit's IMEI may be re-registered; a
      // refund flips the SAME row back to IN_STOCK so no dup ever arises
      // on that path.
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_active_imei ON product_units(tenant_id, imei) WHERE status = 'IN_STOCK';`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_product_units_tenant_id ON product_units(tenant_id);`,
      );
      // All statuses (not just IN_STOCK) — backs the sold-unit lookup (decision #7).
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_product_units_imei ON product_units(tenant_id, imei);`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units(tenant_id, product_id, status);`,
      );
      // Refund-flip lookup: find the unit(s) sold on a given sale_items row.
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_product_units_sale_item ON product_units(sale_item_id);`,
      );

      // Some minimal test/runner DBs are built from a slice of migrations
      // alone (no create_db.sql base) and may not have products /
      // product_categories / sale_items yet — PRAGMA table_info on a
      // missing table returns an EMPTY array (not an error), so the naive
      // `.some(...)` guard above would read as "column missing" and walk
      // straight into `ALTER TABLE <missing> ...`, which throws. Check
      // table existence first and skip-with-log when absent, same house
      // pattern as v154/v155 (e.g. ~:8394-8408).
      const hasTable = (name: string): boolean =>
        db
          .prepare(
            `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
          )
          .get(name) !== undefined;

      if (hasTable("products")) {
        const productsCols = db
          .prepare("PRAGMA table_info(products)")
          .all() as { name: string }[];
        if (!productsCols.some((c) => c.name === "warranty_months")) {
          db.exec(`ALTER TABLE products ADD COLUMN warranty_months INTEGER;`);
        }
      } else {
        console.log(
          "Migration v157: 'products' table not present — warranty_months skipped",
        );
      }

      if (hasTable("product_categories")) {
        const categoryCols = db
          .prepare("PRAGMA table_info(product_categories)")
          .all() as { name: string }[];
        if (!categoryCols.some((c) => c.name === "tracks_imei_units")) {
          db.exec(
            `ALTER TABLE product_categories ADD COLUMN tracks_imei_units INTEGER NOT NULL DEFAULT 0;`,
          );
          // Decision #9 — name-matched by design, no tenant filter: every
          // tenant's own seeded "Phones" row (COLLATE NOCASE) gets flagged.
          // A tenant who renamed their "Phones" category gets no auto-flag —
          // accepted; their path is the Settings toggle, not this backfill.
          db.exec(
            `UPDATE product_categories SET tracks_imei_units = 1 WHERE name = 'Phones';`,
          );
        }
      } else {
        console.log(
          "Migration v157: 'product_categories' table not present — tracks_imei_units skipped",
        );
      }

      if (hasTable("sale_items")) {
        const saleItemsCols = db
          .prepare("PRAGMA table_info(sale_items)")
          .all() as { name: string }[];
        if (!saleItemsCols.some((c) => c.name === "warranty_until")) {
          db.exec(`ALTER TABLE sale_items ADD COLUMN warranty_until TEXT;`);
        }
      } else {
        console.log(
          "Migration v157: 'sale_items' table not present — warranty_until skipped",
        );
      }

      console.log(
        "Migration v157: product_units table created; products.warranty_months, " +
          "product_categories.tracks_imei_units (backfilled for 'Phones'), and " +
          "sale_items.warranty_until columns added (where their base tables exist)",
      );
    },
    down(db: Database.Database) {
      db.exec(`DROP TABLE IF EXISTS product_units;`);

      // This better-sqlite3 build's bundled SQLite supports DROP COLUMN
      // (3.35+) — same precedent as v136/v141 (source_ref_table/
      // source_ref_id, is_primary) — and none of these three columns is
      // indexed or FK-referenced, so a straight DROP COLUMN is safe. Same
      // hasTable guard as up() — table_info on a missing table is an empty
      // array, so `.some(...)` is already false and each ALTER is skipped
      // as a clean no-op; the explicit hasTable check just makes that
      // intent visible rather than relying on the empty-array side effect.
      const hasTable = (name: string): boolean =>
        db
          .prepare(
            `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
          )
          .get(name) !== undefined;

      if (hasTable("products")) {
        const productsCols = db
          .prepare("PRAGMA table_info(products)")
          .all() as { name: string }[];
        if (productsCols.some((c) => c.name === "warranty_months")) {
          db.exec(`ALTER TABLE products DROP COLUMN warranty_months;`);
        }
      }

      if (hasTable("product_categories")) {
        const categoryCols = db
          .prepare("PRAGMA table_info(product_categories)")
          .all() as { name: string }[];
        if (categoryCols.some((c) => c.name === "tracks_imei_units")) {
          db.exec(
            `ALTER TABLE product_categories DROP COLUMN tracks_imei_units;`,
          );
        }
      }

      if (hasTable("sale_items")) {
        const saleItemsCols = db
          .prepare("PRAGMA table_info(sale_items)")
          .all() as { name: string }[];
        if (saleItemsCols.some((c) => c.name === "warranty_until")) {
          db.exec(`ALTER TABLE sale_items DROP COLUMN warranty_until;`);
        }
      }

      console.log(
        "Migration v157 rolled back: product_units table dropped; " +
          "products.warranty_months, product_categories.tracks_imei_units, " +
          "sale_items.warranty_until columns dropped (where their base tables exist)",
      );
    },
  },
  {
    version: 158,
    name: "add_custom_services_partner_mode_and_fulfillment",
    description:
      "D4.1 (owner-decided 2026-08-29) — schema for the NEW 'Via partner' custom-service mode, " +
      "an ADDITIONAL second mode alongside the existing 'For Partner' flow (unchanged: no " +
      "payment collected, full price booked to partner_ledger as a FOR_CUSTOM_SERVICE debit — " +
      "the partner owes us). In the new 'Via partner' mode the PARTNER performs the service: " +
      "the walk-in customer pays US, now, through the normal payment form exactly like a " +
      "non-partner custom service (money moves into our drawer as usual), and we owe the " +
      "PARTNER the COST (not the price) — shop profit is unchanged: price - cost. This " +
      "migration is schema only, zero behaviour change: nothing reads or writes these columns " +
      "yet (repository/service/UI wiring is a follow-up change) and every existing row reads " +
      "NULL, which keeps today's behaviour exactly. Adds three nullable columns to " +
      "custom_services: partner_mode ('FOR' | 'VIA') is the UI-facing label only — 'FOR' names " +
      "the existing flow for symmetry, 'VIA' the new one. This is DELIBERATELY NOT the same " +
      "string as the partner_ledger transaction_type the follow-up change will book for the " +
      "'VIA' mode, which is 'THROUGH_CUSTOM_SERVICE': PartnerRepository.getBalanceBreakdown " +
      "buckets ledger rows by `LIKE 'FOR_%'` / `LIKE 'THROUGH_%'` with an explicit 'neither' " +
      "fallback (~PartnerRepository.ts:834-845) — a 'VIA_' ledger prefix would silently fall " +
      "into that fallback and mis-report the partner balance. It is also semantically correct: " +
      "this repo already uses THROUGH = 'we use THEIR system' and FOR = 'they use OUR system' " +
      "(FinancialServiceRepository partner_mode, migration v83), and via-partner is exactly " +
      "THROUGH. Two different strings ON PURPOSE — column value 'VIA', ledger transaction_type " +
      "'THROUGH_CUSTOM_SERVICE' — do not 'fix' one to match the other. fulfillment_status " +
      "('ORDERED'|'ISSUED'|'RECEIVED'|'DELIVERED') deliberately has NO 'CANCELLED' value: " +
      "cancellation is DERIVED from the existing custom_services.is_refunded, already stamped " +
      "by the generic refund path via TransactionRepository._markSourceRefunded's " +
      "'custom_services' whitelist entry. fulfillment_status/fulfilled_at are UNUSED by this " +
      "change — they belong to the follow-up LIRA-155 fulfillment-tracking ticket and ship now " +
      "only so there is one migration instead of two. All three columns are defaultless/" +
      "DEFAULT NULL ALTERs (v104 prod-brick lesson: SQLite rejects a non-constant default such " +
      "as CURRENT_TIMESTAMP on ADD COLUMN — NULL is a constant default, and a NULL-valued " +
      "column passes its own CHECK per SQLite's NULL-is-not-a-violation rule, same precedent as " +
      "v83's financial_services.partner_mode). Each ALTER is guarded by a sqlite_master " +
      "table-existence check plus a PRAGMA table_info column-existence check (v152/v157 house " +
      "pattern) so a minimal migration-runner test DB without custom_services yet does not " +
      "throw, and re-running up() is a clean no-op.",
    type: "typescript" as const,
    up(db: Database.Database) {
      const hasCustomServices = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'custom_services'`,
        )
        .get();
      if (!hasCustomServices) {
        console.log(
          "Migration v158 skipped: 'custom_services' table not present",
        );
        return;
      }

      const cols = db.prepare("PRAGMA table_info(custom_services)").all() as {
        name: string;
      }[];

      if (!cols.some((c) => c.name === "partner_mode")) {
        db.exec(
          `ALTER TABLE custom_services ADD COLUMN partner_mode TEXT DEFAULT NULL CHECK(partner_mode IN ('FOR', 'VIA'));`,
        );
      }
      if (!cols.some((c) => c.name === "fulfillment_status")) {
        db.exec(
          `ALTER TABLE custom_services ADD COLUMN fulfillment_status TEXT DEFAULT NULL CHECK(fulfillment_status IN ('ORDERED', 'ISSUED', 'RECEIVED', 'DELIVERED'));`,
        );
      }
      if (!cols.some((c) => c.name === "fulfilled_at")) {
        db.exec(
          `ALTER TABLE custom_services ADD COLUMN fulfilled_at TEXT DEFAULT NULL;`,
        );
      }

      console.log(
        "Migration v158: custom_services.partner_mode, fulfillment_status, fulfilled_at " +
          "added (all nullable, existing rows NULL -> unchanged behaviour)",
      );
    },
    down(db: Database.Database) {
      const hasCustomServices = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'custom_services'`,
        )
        .get();
      if (!hasCustomServices) {
        console.log(
          "Migration v158 rollback skipped: 'custom_services' table not present",
        );
        return;
      }

      const cols = db.prepare("PRAGMA table_info(custom_services)").all() as {
        name: string;
      }[];

      if (cols.some((c) => c.name === "fulfilled_at")) {
        db.exec(`ALTER TABLE custom_services DROP COLUMN fulfilled_at;`);
      }
      if (cols.some((c) => c.name === "fulfillment_status")) {
        db.exec(`ALTER TABLE custom_services DROP COLUMN fulfillment_status;`);
      }
      if (cols.some((c) => c.name === "partner_mode")) {
        db.exec(`ALTER TABLE custom_services DROP COLUMN partner_mode;`);
      }

      console.log(
        "Migration v158 rolled back: custom_services.partner_mode, fulfillment_status, " +
          "fulfilled_at columns dropped",
      );
    },
  },
  {
    version: 159,
    name: "reprice_annual_sell_days_lbp",
    description:
      "Owner-confirmed 2026-08-29: reprices the 365-day days-only sale from 2,300,000 to " +
      "1,780,000 LBP, deepening the annual bulk discount from ~24% to ~41% off the 8,333 " +
      "LBP/day rate the 30/60/90-day tiers run at (4,877 LBP/day for the year). This is a " +
      "PRICING decision, not a correction: v147's 2,300,000 was arithmetically fine, the shop " +
      "simply charges less for the year. Only the days SELL line moves — cost_lbp, credits, " +
      "days_cost_lbp and the credit-cost rate R are all untouched, so what a card costs the " +
      "shop is unchanged and only the reported days margin shrinks (by 520,000 per card). " +
      "Verified against the live catalog before shipping: all six 365-day credit-bearing rows " +
      "(the 77.28 card across iPick, Katsh and WHISH_APP) still price days ABOVE days_cost_lbp " +
      "at the new price, thinnest margin +620,800 on the iPick 7,728,000 row — no 365-day card " +
      "sells its days at a loss, which is the same guard rail v147's 10-day price was chosen " +
      "for. Scoped narrowly on purpose: it rewrites ONLY rows still holding EXACTLY the old " +
      "2,300,000 table price on a 365-day credit-bearing item, mirroring v147's down(), so any " +
      "annual price an operator has already hand-tuned is preserved rather than stomped. " +
      "Fresh databases never run this path — create_db.sql seeds sell_days_lbp as NULL and " +
      "v147 fills it from TELECOM_DAYS_SELL_PRICE_LBP, which now carries the new figure " +
      "(rule 14: the curve stays defined once, in telecomCredit.ts).",
    type: "typescript" as const,
    up(db: Database.Database) {
      // Pinned LITERALS, deliberately not TELECOM_DAYS_SELL_PRICE_LBP[365]
      // (v146's OLD_RATE convention). A migration must keep doing the same
      // thing forever; reading the live table would silently re-target this
      // UPDATE the next time the owner reprices the year, so an old database
      // catching up would rewrite rows this migration never meant to touch.
      // House pattern (every other migration does this): a migration must be a
      // no-op on a database that has no such table, or it throws and takes the
      // whole runner down with it. Added 2026-08-30 after this migration broke
      // PartnersSystemAssociationFkMigrationViaRunner's rollback round-trip
      // with "no such table: mobile_service_items".
      const hasItems = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='mobile_service_items'",
        )
        .get();
      if (!hasItems) {
        console.log(
          "Migration v159: mobile_service_items not present - repricing skipped",
        );
        return;
      }

      const OLD_ANNUAL_LBP = 2_300_000; // v147's price
      const NEW_ANNUAL_LBP = 1_780_000; // owner-confirmed 2026-08-29

      const result = db
        .prepare(
          `UPDATE mobile_service_items
              SET sell_days_lbp = ?, updated_at = CURRENT_TIMESTAMP
            WHERE sell_days_lbp = ?
              AND validity_days = 365
              AND credits > 0`,
        )
        .run(NEW_ANNUAL_LBP, OLD_ANNUAL_LBP);

      console.log(
        `Migration v159: annual sell_days_lbp repriced ${OLD_ANNUAL_LBP} -> ` +
          `${NEW_ANNUAL_LBP} on ${result.changes} row(s)`,
      );
    },
    down(db: Database.Database) {
      // Symmetric to up(): only rows still holding exactly the new price go
      // back, so a price edited after this ran survives the rollback.
      // Pinned LITERALS, deliberately not TELECOM_DAYS_SELL_PRICE_LBP[365]
      // (v146's OLD_RATE convention). A migration must keep doing the same
      // thing forever; reading the live table would silently re-target this
      // UPDATE the next time the owner reprices the year, so an old database
      // catching up would rewrite rows this migration never meant to touch.
      // Same no-op guard as up() - see there for why a migration must be
      // inert on a database that lacks the table.
      const hasItems = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='mobile_service_items'",
        )
        .get();
      if (!hasItems) {
        console.log(
          "Migration v159 rollback: mobile_service_items not present - skipped",
        );
        return;
      }

      const OLD_ANNUAL_LBP = 2_300_000; // v147's price
      const NEW_ANNUAL_LBP = 1_780_000; // owner-confirmed 2026-08-29

      const result = db
        .prepare(
          `UPDATE mobile_service_items
              SET sell_days_lbp = ?, updated_at = CURRENT_TIMESTAMP
            WHERE sell_days_lbp = ?
              AND validity_days = 365
              AND credits > 0`,
        )
        .run(OLD_ANNUAL_LBP, NEW_ANNUAL_LBP);

      console.log(
        `Migration v159 rolled back: annual sell_days_lbp restored to ` +
          `${OLD_ANNUAL_LBP} on ${result.changes} row(s)`,
      );
    },
  },
  {
    version: 160,
    name: "add_max_returned_credits_override",
    description:
      "Owner interview 2026-08-30 — per-card override of the returnable credit maximum. " +
      "maxReturnableCredits() models a BARE card (nothing on the line but the card's own " +
      "credit) and for the alfa 77.28 card that yields $73.00: 24 messages x $3.16 spends " +
      "$75.84, leaves $1.44, and a final $1.50 message needs $1.66. In practice the " +
      "customer's line holds a little of their own credit, and $0.22 of it closes that gap, " +
      "so the shop gets $73.50 back. The computed figure is right about the physics and " +
      "wrong about the shop, hence a per-card override rather than a change to the formula. " +
      "Adds mobile_service_items.max_returned_credits_usd (nullable REAL): NULL means 'use " +
      "the computed value', which is every row's behaviour today and stays the default. The " +
      "override is UPWARD-ONLY and capped at one CREDIT_TRANSFER_STEP_USD above the computed " +
      "maximum — the catalog-wide shortfall runs $0.03 (iPick mtc 3.79) to $0.49 (iPick " +
      "1.67), all within a single step, and the cap blocks the typo class (83 for 73.5) that " +
      "would otherwise book $9.50 of credit the shop never received on every sale of a card. " +
      "The bound is enforced on the WRITE path (MobileServiceItemService rejects a save that " +
      "strands an override, in EITHER direction — editing the override, or editing `credits` " +
      "underneath a stored one); the READ path (resolveMaxReturnedCredits) ignores an " +
      "out-of-range value rather than trusting it, so a row that went stale still prices " +
      "sales correctly. BACKFILL IS DELIBERATELY NARROW: only the six 365-day 77.28 rows " +
      "(iPick x2, Katsh x2, WHISH_APP x2) get 73.5, because that is the only card with " +
      "counter experience behind it. Every other card computes bare until an operator sets " +
      "it by hand, even though all 12 catalog card types would gain half a dollar from a " +
      "plausible customer balance. NOT retroactive: profit is stamped at sale time, so " +
      "existing Only-Days sales keep the figure they booked; only sales made after this " +
      "book the higher recovery (+0.5 x R = +42,500 LBP on the 77.28 card).",
    type: "typescript" as const,
    up(db: Database.Database) {
      // The table is not guaranteed to exist. Migration tests build minimal
      // databases holding only the tables their own migration touches, and the
      // runner walks EVERY migration over them — so a bare ALTER TABLE here
      // fails an unrelated test (v155's round-trip runner test caught exactly
      // that). Same shape as v157/v158, which skip when their base table is
      // absent rather than assuming a full schema.
      const hasTable = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mobile_service_items'`,
        )
        .get();
      if (!hasTable) {
        console.log(
          "Migration v160 skipped: 'mobile_service_items' table not present",
        );
        return;
      }

      // Pinned LITERALS, not the catalog constants (v146 OLD_RATE / v159
      // convention): a migration must keep doing the same thing forever, and
      // both the card and its override are historical facts about THIS change.
      const CARD_FACE_CREDITS = 77.28;
      const CARD_VALIDITY_DAYS = 365;
      const BACKFILL_RETURNED_USD = 73.5;

      const cols = db
        .prepare("PRAGMA table_info(mobile_service_items)")
        .all() as { name: string }[];

      if (!cols.some((c) => c.name === "max_returned_credits_usd")) {
        db.exec(
          `ALTER TABLE mobile_service_items ADD COLUMN max_returned_credits_usd REAL`,
        );
      }

      const result = db
        .prepare(
          `UPDATE mobile_service_items
              SET max_returned_credits_usd = ?, updated_at = CURRENT_TIMESTAMP
            WHERE credits = ?
              AND validity_days = ?
              AND max_returned_credits_usd IS NULL`,
        )
        .run(BACKFILL_RETURNED_USD, CARD_FACE_CREDITS, CARD_VALIDITY_DAYS);

      console.log(
        `Migration v160: max_returned_credits_usd added; backfilled ` +
          `${BACKFILL_RETURNED_USD} on ${result.changes} row(s)`,
      );
    },
    down(db: Database.Database) {
      // Symmetric to up(): a database that never had the table has nothing to
      // roll back. PRAGMA on a missing table returns an empty list rather than
      // throwing, so this would already be a no-op — the explicit guard is here
      // so the two halves read the same and neither drifts.
      const hasTable = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mobile_service_items'`,
        )
        .get();
      if (!hasTable) {
        console.log(
          "Migration v160 rollback skipped: 'mobile_service_items' table not present",
        );
        return;
      }

      const cols = db
        .prepare("PRAGMA table_info(mobile_service_items)")
        .all() as { name: string }[];

      if (cols.some((c) => c.name === "max_returned_credits_usd")) {
        db.exec(
          `ALTER TABLE mobile_service_items DROP COLUMN max_returned_credits_usd`,
        );
      }

      console.log(
        "Migration v160 rolled back: mobile_service_items.max_returned_credits_usd dropped",
      );
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

  // HOTFIX: loto_settlements was missing from create_db.sql when v52 was
  // seeded as "applied", so some databases never got this table created.
  db.exec(`
    CREATE TABLE IF NOT EXISTS loto_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_date TEXT NOT NULL,
      checkpoint_ids TEXT NOT NULL,
      total_sales REAL NOT NULL DEFAULT 0,
      total_commission REAL NOT NULL DEFAULT 0,
      total_cash_prizes REAL NOT NULL DEFAULT 0,
      net_settlement REAL NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

  // Disable FK constraints during rollback — mirrors runMigrations' own
  // bracket (line ~8899 above) and for the identical reason: a down() that
  // rebuilds a table (DROP + RENAME) which OTHER tables reference via FK —
  // discovered by migration v155's down() rebuilding `partners`, which
  // `financial_services.partner_id`/`partner_ledger.partner_id` reference —
  // otherwise fails with "FOREIGN KEY constraint failed" on the DROP
  // TABLE step whenever any such referencing row exists (verified against a
  // copy of the real accumulated production database, which has both).
  // v154's own down() never exposed this gap because financial_services
  // itself is not the FK target of any other table. PRAGMA foreign_keys
  // cannot be changed inside a transaction, so — exactly like
  // runMigrations — this is set here, outside the per-migration
  // transactions below.
  db.pragma("foreign_keys = OFF");

  try {
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
  } finally {
    // Always re-enable FK constraints, even if a rollback fails — mirrors
    // runMigrations' own finally block.
    db.pragma("foreign_keys = ON");
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
