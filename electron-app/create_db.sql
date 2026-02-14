-- Consolidated Database Schema for LiraTek
-- Includes Baseline, Recharges, Multi-Drawer, Suppliers, and Performance Indexes

-- =============================================================================
-- 1. Core System Tables
-- =============================================================================

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    key_name TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'staff',
    is_active BOOLEAN DEFAULT 1
);

-- Seed admin user if not exists
INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (1, 'admin', '', 'admin', 1);

-- Sessions (for unified session management across Electron and Web)
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    device_type TEXT DEFAULT 'unknown',
    device_info TEXT,
    ip_address TEXT,
    remember_me INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at);

-- Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    table_name TEXT,
    record_id INTEGER,
    details_json TEXT, -- Added via migration consolidation
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Currencies
CREATE TABLE IF NOT EXISTS currencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL, -- e.g., USD, LBP, EUR
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO currencies (code, name, is_active) VALUES ('USD', 'US Dollar', 1);
INSERT OR IGNORE INTO currencies (code, name, is_active) VALUES ('LBP', 'Lebanese Pound', 1);

-- Exchange Rates
CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_code TEXT NOT NULL,
    to_code TEXT NOT NULL,
    rate REAL NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_code, to_code)
);

-- =============================================================================
-- 2. Business Entity Tables
-- =============================================================================

-- Clients
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone_number TEXT UNIQUE,
    notes TEXT,
    whatsapp_opt_in BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  phone TEXT,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Products
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    item_type TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    description TEXT,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 3. Transactional Tables
-- =============================================================================

-- Sales
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    total_amount_usd DECIMAL(10, 2),
    discount_usd DECIMAL(10, 2) DEFAULT 0,
    final_amount_usd DECIMAL(10, 2),
    paid_usd DECIMAL(10, 2) DEFAULT 0,
    paid_lbp DECIMAL(15, 2) DEFAULT 0,
    change_given_usd DECIMAL(10, 2) DEFAULT 0,
    change_given_lbp DECIMAL(15, 2) DEFAULT 0,
    exchange_rate_snapshot DECIMAL(15, 2),
    drawer_name TEXT DEFAULT 'General_Drawer_B',
    status TEXT DEFAULT 'completed',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Sale Items
CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    sold_price_usd DECIMAL(10, 2),
    cost_price_snapshot_usd DECIMAL(10, 2),
    is_refunded BOOLEAN DEFAULT 0,
    imei TEXT,
    FOREIGN KEY (sale_id) REFERENCES sales(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Debt Ledger (Clients)
CREATE TABLE IF NOT EXISTS debt_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL,
    amount_usd DECIMAL(10, 2),
    amount_lbp DECIMAL(15, 2),
    sale_id INTEGER,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER, -- Added via migration consolidation
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (sale_id) REFERENCES sales(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Customer Visit Sessions
CREATE TABLE IF NOT EXISTS customer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_notes TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  started_by TEXT NOT NULL,
  closed_by TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS customer_session_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  transaction_type TEXT NOT NULL, -- 'sale', 'recharge', 'expense', 'omt', 'whish', 'exchange', 'maintenance'
  transaction_id INTEGER NOT NULL,
  amount_usd REAL NOT NULL DEFAULT 0,
  amount_lbp REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_active ON customer_sessions(is_active, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_session_transactions_session ON customer_session_transactions(session_id);

-- Supplier Ledger
CREATE TABLE IF NOT EXISTS supplier_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'PAYMENT', 'ADJUSTMENT')),
  amount_usd REAL NOT NULL DEFAULT 0,
  amount_lbp REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Maintenance / Repairs
CREATE TABLE IF NOT EXISTS maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    client_name TEXT,
    device_name TEXT NOT NULL,
    issue_description TEXT,
    cost_usd DECIMAL(10, 2) DEFAULT 0,
    price_usd DECIMAL(10, 2) DEFAULT 0,
    discount_usd DECIMAL(10, 2) DEFAULT 0,
    final_amount_usd DECIMAL(10, 2) DEFAULT 0,
    paid_usd DECIMAL(10, 2) DEFAULT 0,
    paid_lbp DECIMAL(15, 2) DEFAULT 0,
    exchange_rate DECIMAL(15, 2),
    status TEXT DEFAULT 'Received',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT,
    category TEXT,
    expense_type TEXT,
    amount_usd DECIMAL(10, 2),
    amount_lbp DECIMAL(15, 2),
    expense_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Mobile Recharges
CREATE TABLE IF NOT EXISTS recharges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    carrier TEXT CHECK(carrier IN ('Touch', 'Alfa')) NOT NULL,
    amount_usd DECIMAL(10, 2) NOT NULL,
    phone_number TEXT,
    client_name TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Exchange Transactions
CREATE TABLE IF NOT EXISTS exchange_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT CHECK(type IN ('BUY', 'SELL')) NOT NULL,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    amount_in DECIMAL(15, 2) NOT NULL,
    amount_out DECIMAL(15, 2) NOT NULL,
    rate DECIMAL(15, 2) NOT NULL,
    client_name TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Binance Transactions (Send/Receive)
CREATE TABLE IF NOT EXISTS binance_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT CHECK(type IN ('SEND', 'RECEIVE')) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'USDT',
    description TEXT,
    client_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Financial Services (OMT, Whish, IPEC, Katch, Wish App, etc.)
CREATE TABLE IF NOT EXISTS financial_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'IPEC', 'KATCH', 'WISH_APP')) NOT NULL,
    service_type TEXT CHECK(service_type IN ('SEND', 'RECEIVE', 'BILL_PAYMENT')) NOT NULL,
    amount_usd DECIMAL(10, 2) DEFAULT 0,
    amount_lbp DECIMAL(15, 2) DEFAULT 0,
    commission_usd DECIMAL(10, 2) DEFAULT 0,
    commission_lbp DECIMAL(15, 2) DEFAULT 0,
    client_name TEXT,
    reference_number TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 4. Financial Management (Drawers & Closings)
-- =============================================================================

-- Payments (Multi-method tracking)
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  method TEXT NOT NULL,
  drawer_name TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Drawer Balances (Running totals)
CREATE TABLE IF NOT EXISTS drawer_balances (
  drawer_name TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (drawer_name, currency_code)
);

-- Seed Initial Drawer Balances
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Binance', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('MTC', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Alfa', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('IPEC', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('IPEC', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katch', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katch', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Wish_App_Money', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Wish_App_Money', 'LBP', 0);

-- Daily Closings
CREATE TABLE IF NOT EXISTS daily_closings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closing_date DATE,
    drawer_name TEXT,
    opening_balance_usd DECIMAL(15, 2),
    opening_balance_lbp DECIMAL(15, 2),
    physical_usd DECIMAL(15, 2),
    physical_lbp DECIMAL(15, 2),
    physical_eur DECIMAL(15, 2),
    system_expected_usd DECIMAL(15, 2),
    system_expected_lbp DECIMAL(15, 2),
    variance_usd DECIMAL(15, 2),
    notes TEXT,
    report_path TEXT,
    created_by INTEGER,
    updated_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- Daily Closing Amounts (Detailed Breakdown)
CREATE TABLE IF NOT EXISTS daily_closing_amounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closing_id INTEGER NOT NULL,
    drawer_name TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    opening_amount REAL DEFAULT 0,
    physical_amount REAL DEFAULT 0,
    UNIQUE(closing_id, drawer_name, currency_code),
    FOREIGN KEY (closing_id) REFERENCES daily_closings(id)
);

-- =============================================================================
-- 5. Sync & Infrastructure
-- =============================================================================

-- Sync Queue
CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT,
    record_id INTEGER,
    action_type TEXT,
    payload_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sync Errors
CREATE TABLE IF NOT EXISTS sync_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT,
    payload_json TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 6. Performance Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_sales_status_created_at ON sales(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_client_id_created_at ON sales(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_client_id_created_at ON debt_ledger(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_transaction_type_created_at ON debt_ledger(transaction_type, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id_created_at ON activity_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_maintenance_status_created_at ON maintenance(status, created_at);
CREATE INDEX IF NOT EXISTS idx_exchange_transactions_created_at ON exchange_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_binance_transactions_created_at ON binance_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_binance_transactions_type_created_at ON binance_transactions(type, created_at);
CREATE INDEX IF NOT EXISTS idx_financial_services_provider_type_created_at ON financial_services(provider, service_type, created_at);
CREATE INDEX IF NOT EXISTS idx_financial_services_created_at ON financial_services(created_at);
CREATE INDEX IF NOT EXISTS idx_daily_closings_date ON daily_closings(closing_date);
CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_source ON payments(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_payments_drawer_currency ON payments(drawer_name, currency_code, created_at);
CREATE INDEX IF NOT EXISTS idx_drawer_balances_drawer ON drawer_balances(drawer_name);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);

-- ============================================================================
-- ADDITIONAL INDEXES (Added 2026-02-14)
-- ============================================================================

-- Client indexes
CREATE INDEX IF NOT EXISTS idx_clients_full_name ON clients(full_name COLLATE NOCASE);

-- Product indexes
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(is_active, category);
CREATE INDEX IF NOT EXISTS idx_products_active_status ON products(is_active, status);

-- Expense indexes
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_type ON expenses(expense_type);
CREATE INDEX IF NOT EXISTS idx_expenses_date_category ON expenses(expense_date, category);
CREATE INDEX IF NOT EXISTS idx_expenses_type_date ON expenses(expense_type, expense_date DESC);

-- Maintenance indexes
CREATE INDEX IF NOT EXISTS idx_maintenance_client_id ON maintenance(client_id);

-- Sales indexes
CREATE INDEX IF NOT EXISTS idx_sales_drawer_name ON sales(drawer_name);
CREATE INDEX IF NOT EXISTS idx_sales_status_drawer ON sales(status, drawer_name);

-- Debt ledger indexes
CREATE INDEX IF NOT EXISTS idx_debt_ledger_client_type ON debt_ledger(client_id, transaction_type);
