-- Consolidated Database Schema for LiraTek
-- Includes Baseline, Recharges, Multi-Drawer, Suppliers, and Performance Indexes

-- =============================================================================
-- 1. Core System Tables
-- =============================================================================

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_name TEXT UNIQUE NOT NULL,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed default settings
INSERT OR IGNORE INTO system_settings (key_name, value) VALUES
  ('shop_name', 'Corner Tech'),
  ('default_debt_term_days', '30');

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

-- Unified Transaction Table (accounting journal)
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
    client_name     TEXT,
    client_phone    TEXT,
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

-- Currencies
CREATE TABLE IF NOT EXISTS currencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL, -- e.g., USD, LBP, EUR
    name TEXT NOT NULL,
    symbol TEXT NOT NULL DEFAULT '',        -- e.g., $, €, LBP
    decimal_places INTEGER NOT NULL DEFAULT 2,  -- 2 for USD/EUR, 0 for LBP
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO currencies (code, name, symbol, decimal_places, is_active) VALUES ('USD', 'US Dollar', '$', 2, 1);
INSERT OR IGNORE INTO currencies (code, name, symbol, decimal_places, is_active) VALUES ('LBP', 'Lebanese Pound', 'LBP', 0, 1);
INSERT OR IGNORE INTO currencies (code, name, symbol, decimal_places, is_active) VALUES ('EUR', 'Euro', '€', 2, 1);
INSERT OR IGNORE INTO currencies (code, name, symbol, decimal_places, is_active) VALUES ('USDT', 'Tether USD', 'USDT', 2, 0);

-- Exchange Rates (v30 schema: one row per non-USD currency)
-- Universal formula: rate = market_rate + is_stronger × (action × delta)
--   action = GIVE_USD (+1): we give USD out (buying customer's currency)
--   action = TAKE_USD (-1): we receive USD (selling our currency to customer)
--
-- is_stronger = +1: USD is stronger (rate = units per 1 USD, e.g. LBP)
-- is_stronger = -1: currency is stronger (rate = USD per 1 unit, e.g. EUR)
CREATE TABLE IF NOT EXISTS exchange_rates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    to_code     TEXT    NOT NULL UNIQUE,
    market_rate REAL    NOT NULL,
    buy_rate    REAL    NOT NULL,
    sell_rate   REAL    NOT NULL,
    is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
    updated_at  TEXT    DEFAULT (datetime('now'))
);

-- Seed default exchange rates
-- LBP: 1 USD = 89,500 LBP market, buy 89,000, sell 90,000
INSERT OR IGNORE INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
VALUES ('LBP', 89500, 89000, 90000, 1);

-- EUR: 1 EUR = 1.18 USD market, buy 1.16, sell 1.20
INSERT OR IGNORE INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
VALUES ('EUR', 1.18, 1.16, 1.20, -1);

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
  module_key TEXT DEFAULT NULL REFERENCES modules(key) ON DELETE SET NULL,
  provider TEXT DEFAULT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Products
CREATE TABLE IF NOT EXISTS products (
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
);

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
    ('Services', 5);

-- Product Suppliers (normalised inventory supplier names)
CREATE TABLE IF NOT EXISTS product_suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
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
    drawer_name TEXT DEFAULT 'General',
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
    refunded_quantity INTEGER DEFAULT 0,
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
    transaction_id INTEGER,
    due_date TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
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
  checkout_at TEXT,
  checkout_total REAL,
  checkout_currency TEXT DEFAULT 'USD',
  CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS customer_session_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  transaction_type TEXT NOT NULL, -- 'sale', 'recharge', 'expense', 'omt', 'whish', 'exchange', 'maintenance'
  transaction_id INTEGER NOT NULL,
  unified_transaction_id INTEGER,
  amount_usd REAL NOT NULL DEFAULT 0,
  amount_lbp REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (unified_transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_active ON customer_sessions(is_active, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_session_transactions_session ON customer_session_transactions(session_id);

-- Supplier Ledger
CREATE TABLE IF NOT EXISTS supplier_ledger (
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
    paid_by TEXT DEFAULT 'CASH',
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
    paid_by_method TEXT DEFAULT 'CASH',
    status TEXT NOT NULL DEFAULT 'active',
    expense_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Mobile Recharges
CREATE TABLE IF NOT EXISTS recharges (
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

-- Exchange Transactions (v30: includes per-leg rate and profit tracking)
CREATE TABLE IF NOT EXISTS exchange_transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT CHECK(type IN ('BUY', 'SELL')) NOT NULL,
    from_currency    TEXT NOT NULL,
    to_currency      TEXT NOT NULL,
    amount_in        DECIMAL(15, 2) NOT NULL,
    amount_out       DECIMAL(15, 2) NOT NULL,
    rate             DECIMAL(15, 2) NOT NULL,       -- leg1 rate (backward compat)
    base_rate        DECIMAL(15, 2),                -- leg1 market rate (backward compat)
    profit_usd       DECIMAL(15, 2),                -- total profit in USD (backward compat)
    -- Leg tracking (v30+)
    leg1_rate        REAL,                           -- actual rate used for leg 1
    leg1_market_rate REAL,                           -- market rate for leg 1 (audit)
    leg1_profit_usd  REAL,                           -- profit on leg 1
    leg2_rate        REAL,                           -- actual rate for leg 2 (cross-currency only)
    leg2_market_rate REAL,                           -- market rate for leg 2
    leg2_profit_usd  REAL,                           -- profit on leg 2
    via_currency     TEXT,                           -- 'USD' for cross-currency, NULL for direct
    client_name      TEXT,
    note             TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by       INTEGER
);

-- Financial Services (OMT, Whish, iPick, Katsh, Wish App, Binance, etc.)
CREATE TABLE IF NOT EXISTS financial_services (
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
    created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_financial_services_is_settled
  ON financial_services(is_settled);
CREATE INDEX IF NOT EXISTS idx_financial_services_provider_settled
  ON financial_services(provider, is_settled);

-- Custom Services (standalone ad-hoc services with cost/price/profit tracking)
CREATE TABLE IF NOT EXISTS custom_services (
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

-- Item Costs (saved default costs for frequently-sold items)
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

-- Voucher Images (per-item image associations for mobileServices.json items)
CREATE TABLE IF NOT EXISTS voucher_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    category TEXT NOT NULL,
    item_key TEXT NOT NULL,
    image_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, category, item_key)
);

-- Mobile Service Items (dynamic catalog — replaces hardcoded mobileServices.ts)
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
);
CREATE INDEX IF NOT EXISTS idx_msi_provider ON mobile_service_items(provider);
CREATE INDEX IF NOT EXISTS idx_msi_provider_category ON mobile_service_items(provider, category);
CREATE INDEX IF NOT EXISTS idx_msi_active ON mobile_service_items(is_active);

-- =============================================================================
-- 4. Financial Management (Drawers & Closings)
-- =============================================================================

-- Payments (Multi-method tracking)
CREATE TABLE IF NOT EXISTS payments (
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
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katch', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katch', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_System', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_System', 'LBP', 0);

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
CREATE INDEX IF NOT EXISTS idx_maintenance_status_created_at ON maintenance(status, created_at);
CREATE INDEX IF NOT EXISTS idx_exchange_transactions_created_at ON exchange_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_financial_services_provider_type_created_at ON financial_services(provider, service_type, created_at);
CREATE INDEX IF NOT EXISTS idx_financial_services_created_at ON financial_services(created_at);
CREATE INDEX IF NOT EXISTS idx_financial_services_paid_by ON financial_services(paid_by);
CREATE INDEX IF NOT EXISTS idx_financial_services_client_id ON financial_services(client_id);
CREATE INDEX IF NOT EXISTS idx_custom_services_created_at ON custom_services(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_custom_services_client_id ON custom_services(client_id);
CREATE INDEX IF NOT EXISTS idx_daily_closings_date ON daily_closings(closing_date);
CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
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

-- =============================================================================
-- 8. Modules System
-- =============================================================================

-- Modules (sidebar navigation items, toggleable features)
CREATE TABLE IF NOT EXISTS modules (
    key         TEXT PRIMARY KEY,                -- e.g. 'pos', 'omt_whish'
    label       TEXT NOT NULL,                   -- Display name: 'Point of Sale'
    icon        TEXT NOT NULL DEFAULT '',         -- Lucide icon name: 'ShoppingCart'
    route       TEXT NOT NULL,                   -- React Router path: '/pos'
    sort_order  INTEGER NOT NULL DEFAULT 0,      -- Sidebar display order
    is_enabled  INTEGER NOT NULL DEFAULT 1,      -- 1 = visible in sidebar, 0 = hidden
    admin_only  INTEGER NOT NULL DEFAULT 0,      -- 1 = only admins see this module
    is_system   INTEGER NOT NULL DEFAULT 0       -- 1 = cannot be disabled
);

-- System modules (always visible, not toggleable)
INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system) VALUES
  ('dashboard',  'Dashboard',  'LayoutDashboard', '/',          0,  1, 0, 1),
  ('closing',    'Closing',    'SquareActivity',  '',          99,  1, 1, 1),
  ('settings',   'Settings',   'Settings',        '/settings', 100, 1, 1, 1);

-- Toggleable modules (can be enabled/disabled from Settings > Modules)
INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system) VALUES
  ('pos',         'Point of Sale','ShoppingCart',  '/pos',           1,  1, 0, 0),
  ('debts',       'Debts',        'BookOpen',      '/debts',         2,  1, 0, 0),
  ('inventory',   'Inventory',    'Package',       '/products',      3,  1, 0, 0),
  ('clients',     'Clients',      'Users',         '/clients',       4,  1, 0, 0),
  ('exchange',    'Exchange',     'RefreshCw',     '/exchange',      5,  1, 0, 0),
  ('omt_whish',   'OMT/Whish',   'Send',          '/services',      6,  1, 0, 0),
  ('recharge',    'MTC/Alfa',     'Smartphone',    '/recharge',      7,  0, 0, 0),
  ('expenses',    'Expenses',     'Banknote',      '/expenses',      8,  1, 0, 0),
  ('maintenance', 'Maintenance',  'Wrench',        '/maintenance',   9,  1, 0, 0),
  ('binance',     'Binance',      'Bitcoin',       '/recharge',     10,  0, 0, 0),
  ('ipec_katch',  'iPick/Katsh',  'Zap',           '/recharge',     11,  0, 0, 0),
  ('custom_services','Services', 'Briefcase',     '/custom-services',12, 1, 0, 0),
  ('profits',        'Profits',  'TrendingUp',    '/profits',        13, 1, 1, 0),
  ('loto',           'Loto',     'Ticket',        '/loto',           16, 1, 0, 0);
  -- REMOVED: reports, transactions (redundant with Dashboard & Profits)

-- Currency–Module junction (which currencies are allowed in which modules)
CREATE TABLE IF NOT EXISTS currency_modules (
    currency_code TEXT NOT NULL,
    module_key    TEXT NOT NULL,
    PRIMARY KEY (currency_code, module_key),
    FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE CASCADE,
    FOREIGN KEY (module_key)    REFERENCES modules(key)     ON DELETE CASCADE
);

-- USD: enabled for all financial modules
INSERT OR IGNORE INTO currency_modules (currency_code, module_key) VALUES
  ('USD', 'pos'), ('USD', 'debts'), ('USD', 'exchange'),
  ('USD', 'omt_whish'), ('USD', 'recharge'), ('USD', 'expenses'),
  ('USD', 'maintenance'), ('USD', 'binance'), ('USD', 'ipec_katch'),
  ('USD', 'custom_services'), ('USD', 'closing'), ('USD', 'loto');

-- LBP: enabled for most modules except OMT/Whish, Binance
INSERT OR IGNORE INTO currency_modules (currency_code, module_key) VALUES
  ('LBP', 'pos'), ('LBP', 'debts'), ('LBP', 'exchange'),
  ('LBP', 'expenses'), ('LBP', 'maintenance'), ('LBP', 'ipec_katch'),
  ('LBP', 'custom_services'), ('LBP', 'recharge'), ('LBP', 'closing'),
  ('LBP', 'loto');

-- EUR: exchange only (by default)
INSERT OR IGNORE INTO currency_modules (currency_code, module_key) VALUES
  ('EUR', 'exchange');

-- Currency–Drawer junction (which currencies are shown per drawer)
CREATE TABLE IF NOT EXISTS currency_drawers (
    currency_code TEXT NOT NULL,
    drawer_name   TEXT NOT NULL,
    PRIMARY KEY (currency_code, drawer_name),
    FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE CASCADE
);

-- Seed drawer-currency mappings (matches drawer_balances seed data)
INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES
  ('USD', 'General'),    ('LBP', 'General'),
  ('USD', 'OMT_System'), ('LBP', 'OMT_System'),
  ('USD', 'OMT_App'),    ('LBP', 'OMT_App'),
  ('USD', 'Whish_App'),  ('LBP', 'Whish_App'),
  ('USD', 'Binance'),
  ('USD', 'MTC'),
  ('USD', 'Alfa'),
  ('USD', 'iPick'),       ('LBP', 'iPick'),
  ('USD', 'Katsh'),       ('LBP', 'Katsh'),
  ('USD', 'Whish_System'), ('LBP', 'Whish_System');

-- Debt ledger indexes
CREATE INDEX IF NOT EXISTS idx_debt_ledger_client_type ON debt_ledger(client_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_due_date ON debt_ledger(due_date);

-- =============================================================================
-- 9. Payment Methods
-- =============================================================================

CREATE TABLE IF NOT EXISTS payment_methods (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT NOT NULL UNIQUE,           -- e.g. 'CASH', 'OMT', 'WHISH'
    label          TEXT NOT NULL,                   -- Display name: 'Cash', 'OMT Wallet'
    drawer_name    TEXT NOT NULL,                   -- Which drawer this method affects
    affects_drawer INTEGER NOT NULL DEFAULT 1,      -- 0 = DEBT (no drawer impact)
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1,
    is_system      INTEGER NOT NULL DEFAULT 0,      -- 1 = cannot be deleted (CASH, DEBT)
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed default payment methods
INSERT OR IGNORE INTO payment_methods (code, label, drawer_name, affects_drawer, sort_order, is_system, is_active) VALUES
  ('CASH',    'Cash',          'General',    1, 0, 1, 1),
  ('OMT',     'OMT Wallet',    'OMT_App',    1, 1, 0, 1),
  ('WHISH',   'Whish Wallet',  'Whish_App',  1, 2, 0, 1),
  ('BINANCE', 'Binance',       'Binance',    1, 3, 0, 1),
  ('DEBT',    'Debt (On Tab)', 'General',    0, 4, 1, 0);

-- Seed system suppliers (linked to modules)
INSERT OR IGNORE INTO suppliers (name, module_key, provider, is_system) VALUES
  ('iPick',         'ipec_katch', 'iPick',         1),
  ('Katch',        'ipec_katch', 'KATCH',        1),
  ('OMT',          'omt_whish',  'OMT',          1),
  ('Whish',        'omt_whish',  'WHISH',        1),
  ('OMT App',      'ipec_katch', 'OMT_APP',      1),
  ('Whish App',    'ipec_katch', 'WHISH_APP',    1);

-- =============================================================================
-- 9b. Loto Module
-- =============================================================================

-- Loto tickets (sold tickets tracking)
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
    checkpoint_id INTEGER REFERENCES loto_checkpoints(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loto_tickets_sale_date ON loto_tickets(sale_date);
CREATE INDEX IF NOT EXISTS idx_loto_tickets_is_winner ON loto_tickets(is_winner);
CREATE INDEX IF NOT EXISTS idx_loto_tickets_checkpoint ON loto_tickets(checkpoint_id);

-- Loto settings (commission rate, monthly fee, etc.)
CREATE TABLE IF NOT EXISTS loto_settings (
    key_name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Seed default loto settings
INSERT OR IGNORE INTO loto_settings (key_name, value, description) VALUES
  ('commission_rate', '0.0445', 'Commission rate (4.45%)'),
  ('monthly_fee_amount', '1400000', 'Monthly machine fee in LBP'),
  ('auto_record_monthly_fee', '1', 'Enable/disable auto-recording of monthly fee');

-- Loto monthly fees (machine rental fees)
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
);

-- Seed Loto supplier
INSERT OR IGNORE INTO suppliers (name, provider, is_active) VALUES ('Loto Liban', 'LOTO', 1);

-- Seed Loto module
INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
VALUES ('loto', 'Loto', 'Ticket', '/loto', 16, 0);

-- Add currency-modules for Loto
INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
VALUES ('USD', 'loto'), ('LBP', 'loto');

-- Add currency-drawers for Loto
INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
VALUES ('USD', 'Loto'), ('LBP', 'Loto');

-- Loto checkpoints (scheduled checkpoint tracking)
CREATE TABLE IF NOT EXISTS loto_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checkpoint_date TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    total_sales REAL NOT NULL DEFAULT 0,
    total_commission REAL NOT NULL DEFAULT 0,
    total_tickets INTEGER NOT NULL DEFAULT 0,
    total_prizes REAL NOT NULL DEFAULT 0,
    total_cash_prizes REAL NOT NULL DEFAULT 0,
    total_cash_prizes_count INTEGER NOT NULL DEFAULT 0,
    is_settled INTEGER NOT NULL DEFAULT 0,
    settled_at TEXT,
    settlement_id INTEGER,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loto_checkpoints_date ON loto_checkpoints(checkpoint_date);
CREATE INDEX IF NOT EXISTS idx_loto_checkpoints_is_settled ON loto_checkpoints(is_settled);
CREATE INDEX IF NOT EXISTS idx_loto_checkpoints_period ON loto_checkpoints(period_start, period_end);

-- Cash prizes table for Loto module
CREATE TABLE IF NOT EXISTS loto_cash_prizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number TEXT,
    prize_amount REAL NOT NULL,
    customer_name TEXT,
    prize_date TEXT NOT NULL,
    is_reimbursed INTEGER NOT NULL DEFAULT 0,
    reimbursed_date TEXT,
    reimbursed_in_settlement_id INTEGER,
    checkpoint_id INTEGER REFERENCES loto_checkpoints(id),
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loto_cash_prizes_date ON loto_cash_prizes(prize_date);
CREATE INDEX IF NOT EXISTS idx_loto_cash_prizes_reimbursed ON loto_cash_prizes(is_reimbursed);
CREATE INDEX IF NOT EXISTS idx_loto_cash_prizes_checkpoint ON loto_cash_prizes(checkpoint_id);

-- Loto settlements table
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
);

-- =============================================================================
-- 10. Audit Log
-- =============================================================================

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
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- =============================================================================
-- 11. Migration Tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Mark all migrations as applied (schema is already at latest state for fresh installs)
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES
    (9,  'add_payment_methods_table'),
    (10, 'seed_shop_name'),
    (11, 'supplier_module_linking'),
    (12, 'recharge_consolidation'),
    (13, 'add_whish_app_supplier'),
    (14, 'financial_services_cost_price_columns'),
    (15, 'add_custom_services_module'),
    (16, 'maintenance_paid_by_column'),
    (17, 'unified_transactions_table'),
    (18, 'debt_aging_support'),
    (19, 'schema_cleanup'),
    (20, 'soft_delete_support'),
    (21, 'add_profits_module'),
    (22, 'add_financial_service_phone_and_omt_type'),
    (23, 'rename_legacy_drawer_names'),
    (24, 'expand_recharges_table'),
    (25, 'merge_binance_into_financial_services'),
    (26, 'remove_bill_payment_add_western_union'),
    (27, 'update_omt_service_types'),
    (28, 'add_fee_calculation_fields'),
    (29, 'remove_analytics_commissions_module'),
    (30, 'exchange_rates_universal_formula_schema'),
    (31, 'add_settlement_tracking_to_financial_services'),
    (32, 'add_whish_fee_to_financial_services'),
    (33, 'add_payment_method_fee_columns'),
    (34, 'add_supplier_id_to_products'),
    (35, 'add_unit_to_products'),
    (36, 'replace_supplier_id_with_supplier_text'),
    (37, 'create_product_categories'),
    (38, 'add_category_id_fk_to_products'),
    (39, 'setup_wizard_feature_flags'),
    (40, 'create_product_suppliers'),
    (41, 'fix_category_cascade_to_set_null'),
    (42, 'add_reports_and_transactions_modules'),
    (43, 'add_soft_delete_to_products'),
    (44, 'add_refunded_quantity_to_sale_items'),
    (45, 'remove_reports_transactions_modules'),
    (46, 'add_sender_receiver_fields'),
    (47, 'add_loto_module'),
    (48, 'update_provider_drawer_names'),
    (49, 'reorder_modules_loto_services_profits_v49'),
    (50, 'add_loto_checkpoints_table'),
    (51, 'add_loto_cash_prizes_table'),
    (52, 'add_loto_settlements_table'),
    (53, 'create_mobile_service_items'),
    (54, 'create_audit_log'),
    (55, 'remove_login_transactions'),
    (56, 'add_cash_prize_entry_type'),
    (57, 'link_cash_prizes_to_checkpoints'),
    (58, 'add_checkpoint_id_to_loto_tickets'),
    (59, 'replace_delta_with_buy_sell_rates');
