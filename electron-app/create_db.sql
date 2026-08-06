-- Consolidated Database Schema for LiraTek
-- Includes Baseline, Recharges, Multi-Drawer, Suppliers, and Performance Indexes

-- =============================================================================
-- 0. Tenants (multi-tenancy foundation)
-- =============================================================================

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
);

-- Seed the Default tenant. Desktop (Electron) is single-tenant and always
-- runs as tenant 1. Web tenants are provisioned explicitly later (id >= 2)
-- via TenantProvisioningService — this seed only exists for the desktop
-- fresh-install path.
INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (1, 'Default', 'default', 'active');

-- =============================================================================
-- 1. Core System Tables
-- =============================================================================

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    key_name TEXT NOT NULL,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, key_name)
);

-- Seed default settings
INSERT OR IGNORE INTO system_settings (tenant_id, key_name, value) VALUES
  (1, 'shop_name', 'Corner Tech'),
  (1, 'default_debt_term_days', '30'),
  (1, 'shop_base_system', 'OMT'),
  (1, 'allow_out_of_stock_sales', '0'),
  -- v140 (LIRA-090): default credit sell price (LBP per $1) backing the
  -- §2.4 resale decision-aid table on telecom catalog items.
  (1, 'telecom_credit_sell_price_lbp', '100000'),
  -- v144 (TELECOM_DAYS_COST_PLAN.md §6 step 7a): R, the shop's cost of $1 of
  -- credit (LBP), owner-confirmed 2026-08-04. A fresh install marks v144's
  -- migration "applied" (see schema_migrations below) BEFORE the frontend
  -- catalog seed ever runs, so this setting must be seeded here directly —
  -- the migration's own INSERT OR IGNORE never gets a chance to run against
  -- this table on a fresh DB.
  (1, 'telecom_credit_cost_rate_lbp', '85000');

-- Users
-- NOTE: username stays GLOBALLY unique (committed decision — login has no
-- tenant hint yet). tenant_id is NULL for the platform/super_admin realm.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'staff',
    is_active BOOLEAN DEFAULT 1
);

-- Seed admin user if not exists
INSERT OR IGNORE INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (1, 1, 'admin', '', 'admin', 1);

-- Sessions (for unified session management across Electron and Web)
-- NOTE: token is random-unique already; tenant_id is just added (denormalized
-- from user) — not part of any constraint.
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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
    tenant_id       INTEGER REFERENCES tenants(id),
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
    profit_usd      REAL NOT NULL DEFAULT 0,
    profit_lbp      REAL NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id
  ON transactions(tenant_id);

-- Currencies
CREATE TABLE IF NOT EXISTS currencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    code TEXT NOT NULL, -- e.g., USD, LBP, EUR
    name TEXT NOT NULL,
    symbol TEXT NOT NULL DEFAULT '',        -- e.g., $, €, LBP
    decimal_places INTEGER NOT NULL DEFAULT 2,  -- 2 for USD/EUR, 0 for LBP
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, code)
);

INSERT OR IGNORE INTO currencies (tenant_id, code, name, symbol, decimal_places, is_active) VALUES (1, 'USD', 'US Dollar', '$', 2, 1);
INSERT OR IGNORE INTO currencies (tenant_id, code, name, symbol, decimal_places, is_active) VALUES (1, 'LBP', 'Lebanese Pound', 'LBP', 0, 1);
INSERT OR IGNORE INTO currencies (tenant_id, code, name, symbol, decimal_places, is_active) VALUES (1, 'EUR', 'Euro', '€', 2, 1);
INSERT OR IGNORE INTO currencies (tenant_id, code, name, symbol, decimal_places, is_active) VALUES (1, 'USDT', 'Tether USD', 'USDT', 2, 1);

-- Exchange Rates (v30 schema: one row per non-USD currency)
-- Universal formula: rate = market_rate + is_stronger × (action × delta)
--   action = GIVE_USD (+1): we give USD out (buying customer's currency)
--   action = TAKE_USD (-1): we receive USD (selling our currency to customer)
--
-- is_stronger = +1: USD is stronger (rate = units per 1 USD, e.g. LBP)
-- is_stronger = -1: currency is stronger (rate = USD per 1 unit, e.g. EUR)
CREATE TABLE IF NOT EXISTS exchange_rates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id   INTEGER REFERENCES tenants(id),
    to_code     TEXT    NOT NULL,
    market_rate REAL    NOT NULL,
    buy_rate    REAL    NOT NULL,
    sell_rate   REAL    NOT NULL,
    is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
    updated_at  TEXT    DEFAULT (datetime('now')),
    UNIQUE (tenant_id, to_code)
);

-- Seed default exchange rates
-- LBP: 1 USD = 89,500 LBP market, buy 89,000, sell 90,000
INSERT OR IGNORE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger)
VALUES (1, 'LBP', 89500, 89000, 90000, 1);

-- EUR: 1 EUR = 1.18 USD market, buy 1.16, sell 1.20
INSERT OR IGNORE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger)
VALUES (1, 'EUR', 1.18, 1.16, 1.20, -1);

-- =============================================================================
-- 2. Business Entity Tables
-- =============================================================================

-- Clients
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    full_name TEXT NOT NULL,
    phone_number TEXT,
    notes TEXT,
    whatsapp_opt_in BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_clients_tenant_id ON clients(tenant_id);

-- Suppliers
-- NOTE: module_key's FK is composite (tenant_id, module_key) because
-- modules' primary key became (tenant_id, key) — a plain module_key
-- reference would no longer resolve to a unique parent key.
CREATE TABLE IF NOT EXISTS suppliers (
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
);

-- Products
CREATE TABLE IF NOT EXISTS products (
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
);

CREATE TABLE IF NOT EXISTS product_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    name TEXT NOT NULL COLLATE NOCASE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
);

INSERT OR IGNORE INTO product_categories (tenant_id, name, sort_order) VALUES
    (1, 'Accessories', 0),
    (1, 'Phones', 1),
    (1, 'Chargers', 2),
    (1, 'Audio', 3),
    (1, 'Parts', 4),
    (1, 'Services', 5);

-- Product Suppliers (normalised inventory supplier names)
CREATE TABLE IF NOT EXISTS product_suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    name TEXT NOT NULL COLLATE NOCASE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    supplier_id INTEGER REFERENCES suppliers(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
);

-- =============================================================================
-- 3. Transactional Tables
-- =============================================================================

-- Sales
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    edited_by TEXT DEFAULT NULL,
    edited_at TEXT DEFAULT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Sale Items
CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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

CREATE INDEX IF NOT EXISTS idx_sale_items_tenant_id ON sale_items(tenant_id);

-- Debt Ledger (Clients)
CREATE TABLE IF NOT EXISTS debt_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    client_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL,
    amount_usd DECIMAL(10, 2),
    amount_lbp DECIMAL(15, 2),
    transaction_id INTEGER,
    due_date TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    edited_by TEXT DEFAULT NULL,
    edited_at TEXT DEFAULT NULL,
    is_refunded INTEGER DEFAULT 0,
    refunded_at TEXT DEFAULT NULL,
    session_id INTEGER,
    -- DBT-1: repayment FIFO coverage of module-debt charges (v129)
    covered_usd REAL NOT NULL DEFAULT 0,
    covered_lbp REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_debt_ledger_tenant_id ON debt_ledger(tenant_id);

-- Customer Visit Sessions
CREATE TABLE IF NOT EXISTS customer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  customer_name TEXT,
  customer_phone TEXT,
  customer_notes TEXT,
  user_id INTEGER REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  started_by TEXT NOT NULL,
  closed_by TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  checkout_at TEXT,
  checkout_total REAL,
  checkout_currency TEXT DEFAULT 'USD',
  checkout_total_usd REAL NOT NULL DEFAULT 0,
  checkout_total_lbp REAL NOT NULL DEFAULT 0,
  checkout_profit_usd REAL NOT NULL DEFAULT 0,
  checkout_profit_lbp REAL NOT NULL DEFAULT 0,
  CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS customer_session_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  session_id INTEGER NOT NULL,
  transaction_type TEXT NOT NULL, -- 'sale', 'recharge', 'expense', 'omt', 'whish', 'exchange', 'maintenance'
  transaction_id INTEGER NOT NULL,
  unified_transaction_id INTEGER,
  amount_usd REAL NOT NULL DEFAULT 0,
  amount_lbp REAL NOT NULL DEFAULT 0,
  profit_usd REAL NOT NULL DEFAULT 0,
  profit_lbp REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (unified_transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_active ON customer_sessions(is_active, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_user ON customer_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_tenant_id ON customer_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_session_transactions_session ON customer_session_transactions(session_id);

CREATE TABLE IF NOT EXISTS session_cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  session_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  module TEXT NOT NULL,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  form_data TEXT NOT NULL DEFAULT '{}',
  ipc_channel TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_cart_items_session ON session_cart_items(session_id);
CREATE INDEX IF NOT EXISTS idx_session_cart_items_user ON session_cart_items(user_id);

-- Supplier Ledger
CREATE TABLE IF NOT EXISTS supplier_ledger (
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
  -- LIRA-091 (v136): back-link from an auto-generated sibling row to the
  -- PARENT transaction's own source row (mirrors source_ref_table/id to
  -- transactions.source_table/source_id, e.g. 'financial_services'/<fs id>).
  source_ref_table TEXT DEFAULT NULL,
  source_ref_id INTEGER DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Supplier Purchases (delivery batches for FIFO payment coverage)
CREATE TABLE IF NOT EXISTS supplier_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  total_usd REAL NOT NULL CHECK(total_usd > 0),
  paid_usd  REAL NOT NULL DEFAULT 0,
  note      TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_purchases_supplier_id ON supplier_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_purchases_created_at  ON supplier_purchases(created_at);

-- Maintenance / Repairs
CREATE TABLE IF NOT EXISTS maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    client_id INTEGER,
    client_name TEXT,
    device_name TEXT NOT NULL,
    issue_description TEXT,
    cost_usd DECIMAL(10, 2) DEFAULT 0,
    price_usd DECIMAL(10, 2) DEFAULT 0,
    cost_lbp DECIMAL(15, 2) DEFAULT 0,
    price_lbp DECIMAL(15, 2) DEFAULT 0,
    discount_usd DECIMAL(10, 2) DEFAULT 0,
    final_amount_usd DECIMAL(10, 2) DEFAULT 0,
    final_amount_lbp DECIMAL(15, 2) DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    paid_usd DECIMAL(10, 2) DEFAULT 0,
    paid_lbp DECIMAL(15, 2) DEFAULT 0,
    exchange_rate DECIMAL(15, 2),
    status TEXT DEFAULT 'Received',
    paid_by TEXT DEFAULT 'CASH',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    edited_by TEXT DEFAULT NULL,
    edited_at TEXT DEFAULT NULL,
    is_refunded INTEGER DEFAULT 0,
    refunded_at TEXT DEFAULT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    description TEXT,
    category TEXT,
    expense_type TEXT,
    amount_usd DECIMAL(10, 2),
    amount_lbp DECIMAL(15, 2),
    paid_by_method TEXT DEFAULT 'CASH',
    status TEXT NOT NULL DEFAULT 'active',
    expense_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    note TEXT DEFAULT NULL,
    edited_by TEXT DEFAULT NULL,
    edited_at TEXT DEFAULT NULL,
    is_refunded INTEGER DEFAULT 0,
    refunded_at TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Mobile Recharges
CREATE TABLE IF NOT EXISTS recharges (
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

-- Exchange Transactions (v30: includes per-leg rate and profit tracking)
CREATE TABLE IF NOT EXISTS exchange_transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id        INTEGER REFERENCES tenants(id),
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
    created_by       INTEGER,
    edited_by        TEXT DEFAULT NULL,
    edited_at        TEXT DEFAULT NULL,
    is_refunded INTEGER DEFAULT 0,
    refunded_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_exchange_transactions_tenant_id ON exchange_transactions(tenant_id);

-- Financial Services (OMT, Whish, iPick, Katsh, Wish App, Binance, etc.)
CREATE TABLE IF NOT EXISTS financial_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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
    partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
    -- v115: 1 = legacy row that booked a per-sale SALE_COST supplier debt
    -- (individually settleable); 0 = prepaid-units model (debt booked at top-up)
    supplier_debt_booked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_financial_services_is_settled
  ON financial_services(is_settled);
CREATE INDEX IF NOT EXISTS idx_financial_services_provider_settled
  ON financial_services(provider, is_settled);
CREATE INDEX IF NOT EXISTS idx_financial_services_tenant_id
  ON financial_services(tenant_id);

-- Partners (agents/counterparties for financial service transactions)
CREATE TABLE IF NOT EXISTS partners (
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
);

-- Partner Ledger (tracks debits/credits per partner)
CREATE TABLE IF NOT EXISTS partner_ledger (
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    -- PFT-6: settlement coverage applied FIFO to FOR_% rows (v128)
    covered_amount REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_partner_ledger_partner_id ON partner_ledger(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_ledger_created_at ON partner_ledger(created_at);

-- Custom Services (standalone ad-hoc services with cost/price/profit tracking)
CREATE TABLE IF NOT EXISTS custom_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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
    category TEXT DEFAULT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    edited_by TEXT DEFAULT NULL,
    edited_at TEXT DEFAULT NULL,
    is_refunded INTEGER DEFAULT 0,
    refunded_at TEXT DEFAULT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_custom_services_tenant_id ON custom_services(tenant_id);

-- Service Presets (reusable templates for digital accounts, repairs, etc.)
CREATE TABLE IF NOT EXISTS service_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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

-- Default service presets
INSERT OR IGNORE INTO service_presets (tenant_id, name, category, cost_usd, price_usd, sort_order) VALUES
    (1, 'Netflix Premium 1 Month', 'digital_account', 7, 9, 0),
    (1, 'Netflix Standard 1 Month', 'digital_account', 5, 7, 1),
    (1, 'Spotify Premium 1 Month', 'digital_account', 3, 5, 2),
    (1, 'Shahid VIP 1 Month', 'digital_account', 4, 6, 3);

-- Item Costs (saved default costs for frequently-sold items)
CREATE TABLE IF NOT EXISTS item_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    provider TEXT NOT NULL,
    category TEXT NOT NULL,
    item_key TEXT NOT NULL,
    cost DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'USD' NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, provider, category, item_key, currency)
);

-- Voucher Images (per-item image associations for mobileServices.json items)
-- tenant_id added: each tenant maintains its own image catalog, so
-- (provider, category, item_key) alone could collide across tenants.
CREATE TABLE IF NOT EXISTS voucher_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    provider TEXT NOT NULL,
    category TEXT NOT NULL,
    item_key TEXT NOT NULL,
    image_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, provider, category, item_key)
);

-- Mobile Service Items (dynamic catalog — replaces hardcoded mobileServices.ts)
-- tenant_id added: each tenant maintains its own catalog, so
-- (provider, category, subcategory, label) alone could collide across tenants.
CREATE TABLE IF NOT EXISTS mobile_service_items (
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
    -- v135: structured validity/credits (nullable — most catalog items have
    -- neither; mtc Prepaid vouchers/cards carry one or the other).
    validity_days INTEGER,
    credits REAL,
    -- v140 (LIRA-090): Only Days credit-return split — nullable, an item
    -- without these keeps today's manual returnedCreditsUsd behaviour.
    -- days_cost_lbp: the item's own validity-only cost component (subtracted
    -- from cost_lbp to get the credit's cost). sell_days_lbp: customer price
    -- when only the days are sold. sell_credit_lbp: decision-aid price for
    -- resold recovered credit (§2.4 of TELECOM_DAYS_VALIDITY_PLAN.md).
    days_cost_lbp REAL,
    sell_days_lbp REAL,
    sell_credit_lbp REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, provider, category, subcategory, label)
);
CREATE INDEX IF NOT EXISTS idx_msi_provider ON mobile_service_items(provider);
CREATE INDEX IF NOT EXISTS idx_msi_provider_category ON mobile_service_items(provider, category);
CREATE INDEX IF NOT EXISTS idx_msi_active ON mobile_service_items(is_active);

-- Carrier Lines (v135 — LIRA W6.a): the shop's own alfa/mtc SIM numbers,
-- tracked for remaining credits + validity expiry. Informational only — no
-- drawer legs, no checkout/closing involvement. Stores the expiry DATE
-- (validity_expires_at); days-remaining is derived at render time so the
-- figure never goes stale.
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
    -- v140 (LIRA-090): the line that receives automated Only Days returns
    -- and self-charges by default, per carrier. At most one per
    -- (tenant, carrier) — enforced by the partial unique index below.
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_carrier_lines_carrier ON carrier_lines(carrier);
CREATE INDEX IF NOT EXISTS idx_carrier_lines_tenant_id ON carrier_lines(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_carrier_lines_one_primary_per_carrier
    ON carrier_lines(tenant_id, carrier)
    WHERE is_primary = 1;

-- Carrier Line Movements (v140 — LIRA-090): the rule-20 reversal owner for
-- every automated carrier_lines credit/validity mutation (Only Days
-- credit-return, self-charge). The generic void/refund path reverses a
-- line's credits/validity by transaction_id instead of leaving it
-- permanently decremented after a void (carrier_lines has no is_refunded
-- column and is absent from TransactionRepository._markSourceRefunded's
-- whitelist).
CREATE TABLE IF NOT EXISTS carrier_line_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    carrier_line_id INTEGER NOT NULL,
    transaction_id INTEGER,
    credits_delta REAL NOT NULL DEFAULT 0,
    validity_days_delta INTEGER NOT NULL DEFAULT 0,
    -- v141 (LIRA-090 M2 fix): the line's validity_expires_at exactly as it
    -- stood immediately BEFORE this movement's mutation. reverseMovement
    -- restores this verbatim instead of re-deriving a date via day-math,
    -- which cannot correctly undo the "already-expired extends from today"
    -- extension rule on reversal.
    previous_validity_expires_at TEXT,
    reason TEXT NOT NULL,
    is_reversed INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (carrier_line_id) REFERENCES carrier_lines(id) ON DELETE CASCADE,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_carrier_line_movements_tenant_id ON carrier_line_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_carrier_line_movements_carrier_line_id ON carrier_line_movements(carrier_line_id);
CREATE INDEX IF NOT EXISTS idx_carrier_line_movements_transaction_id ON carrier_line_movements(transaction_id);

-- =============================================================================
-- 4. Financial Management (Drawers & Closings)
-- =============================================================================

-- Payments (Multi-method tracking)
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  transaction_id INTEGER,
  session_id INTEGER,
  method TEXT NOT NULL,
  drawer_name TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);

-- Drawer Balances (Running totals)
CREATE TABLE IF NOT EXISTS drawer_balances (
  tenant_id INTEGER REFERENCES tenants(id),
  drawer_name TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, drawer_name, currency_code)
);

-- Seed Initial Drawer Balances
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'OMT_System', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'OMT_System', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'OMT_App', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'OMT_App', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Whish_App', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Whish_App', 'LBP', 0);
-- Binance holds crypto (USDT), so its drawer is denominated in USDT, not USD.
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Binance', 'USDT', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'MTC', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Alfa', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'iPick', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'iPick', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Katsh', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Katsh', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Whish_System', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Whish_System', 'LBP', 0);

-- Drawer Top-ups
CREATE TABLE IF NOT EXISTS drawer_topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  amount_usd REAL DEFAULT 0,
  amount_lbp REAL DEFAULT 0,
  notes TEXT,
  source_drawer TEXT DEFAULT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Drawer Cash-Outs (v137): the owner pulls physical cash OUT of the General
-- drawer for a reason that is neither a business expense (no `expenses` row,
-- so net_profit never moves) nor a drawer-to-drawer transfer. Mirrors
-- drawer_topups with the sign flipped — see DrawerCashoutRepository.
CREATE TABLE IF NOT EXISTS drawer_cashouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  amount_usd REAL DEFAULT 0,
  amount_lbp REAL DEFAULT 0,
  notes TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drawer_cashouts_tenant_id ON drawer_cashouts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_drawer_cashouts_created_at ON drawer_cashouts(created_at);

-- Wallet Exchanges (v138): convert a provider wallet's OWN USD balance to LBP
-- or vice versa (OMT_App / Whish_App drawer only, never General) at an
-- operator-entered rate — see WalletExchangeRepository.
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
);
CREATE INDEX IF NOT EXISTS idx_wallet_exchanges_tenant_id ON wallet_exchanges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wallet_exchanges_created_at ON wallet_exchanges(created_at);

-- Drawer Transfers (v140, rebuilt from v139's system_float_topups): a
-- generic, reversible cash move between any two of the shop's own drawers —
-- General <-> the primary cash drawer (OMT_System / Whish_System, whichever
-- is primary per shop_base_system) is the pair the UI exposes, both
-- directions legal (Primary Cash Drawer plan §8.6). OMT_System/Whish_System
-- are no longer a spendable float held inside the provider's system — they
-- ARE the physical cash drawer at the counter, countable at closing like any
-- cash box (plan §1). No CHECK on from_drawer/to_drawer: SQLite cannot ALTER
-- a CHECK, and the old system_float_topups.target_drawer CHECK forbade the
-- PCD->General direction this feature adds. Own is_refunded/refunded_at,
-- reversible via the generic void/refund path — see
-- DrawerTopUpRepository.transferBetweenDrawers.
CREATE TABLE IF NOT EXISTS drawer_transfers (
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
);
CREATE INDEX IF NOT EXISTS idx_drawer_transfers_tenant_id ON drawer_transfers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_drawer_transfers_created_at ON drawer_transfers(created_at);

-- Daily Closings
CREATE TABLE IF NOT EXISTS daily_closings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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
-- NOTE: no rebuild needed — UNIQUE already includes closing_id, which is
-- globally unique (daily_closings.id), so no cross-tenant collision is
-- possible. tenant_id is just an added column here.
CREATE TABLE IF NOT EXISTS daily_closing_amounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    closing_id INTEGER NOT NULL,
    drawer_name TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    opening_amount REAL DEFAULT 0,
    physical_amount REAL DEFAULT 0,
    UNIQUE(closing_id, drawer_name, currency_code),
    FOREIGN KEY (closing_id) REFERENCES daily_closings(id)
);

-- Daily Closing Carrier Lines (v148 — carrier-lines-validity Phase 3, D2)
-- Per-line credits + validity-expiry snapshot for a checkpoint. The
-- daily_closing_amounts grain above has nowhere to store a DATE and nowhere
-- to store a per-line breakdown, so the SIM count lives here.
-- expected_* are read off carrier_lines server-side at count time (never
-- trusted from the client); counted_* are what the operator entered.
-- Credits are deliberately duplicated with daily_closing_amounts' provider
-- USD row — createCheckpoint writes both from ONE value (the post-count
-- getCarrierCreditsSum, §0.1) and a core test asserts they agree.
-- Both FKs CASCADE: a CHECKPOINT transaction is non-reversible by design
-- (rule 20), so these rows have a cascade owner rather than a reversal owner.
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
);
CREATE INDEX IF NOT EXISTS idx_dccl_tenant_id ON daily_closing_carrier_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dccl_closing_id ON daily_closing_carrier_lines(closing_id);

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
CREATE INDEX IF NOT EXISTS idx_daily_closings_drawer_id ON daily_closings(drawer_name, id DESC);
CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_drawer_currency ON payments(drawer_name, currency_code, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_session_id ON payments(session_id);
CREATE INDEX IF NOT EXISTS idx_drawer_balances_drawer ON drawer_balances(drawer_name);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_source_ref ON supplier_ledger(source_ref_table, source_ref_id);

-- Multi-tenancy indexes (high-volume tables)
CREATE INDEX IF NOT EXISTS idx_sales_tenant_id ON sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tenant_id ON maintenance(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_id ON expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recharges_tenant_id ON recharges(tenant_id);

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
-- NOTE: key's primary key became (tenant_id, key) — every tenant seeds the
-- same module keys, so the key alone is no longer globally unique.
CREATE TABLE IF NOT EXISTS modules (
    tenant_id   INTEGER REFERENCES tenants(id),
    key         TEXT NOT NULL,                   -- e.g. 'pos', 'omt_whish'
    label       TEXT NOT NULL,                   -- Display name: 'Point of Sale'
    icon        TEXT NOT NULL DEFAULT '',         -- Lucide icon name: 'ShoppingCart'
    route       TEXT NOT NULL,                   -- React Router path: '/pos'
    sort_order  INTEGER NOT NULL DEFAULT 0,      -- Sidebar display order
    is_enabled  INTEGER NOT NULL DEFAULT 1,      -- 1 = visible in sidebar, 0 = hidden
    admin_only  INTEGER NOT NULL DEFAULT 0,      -- 1 = only admins see this module
    is_system   INTEGER NOT NULL DEFAULT 0,      -- 1 = cannot be disabled
    PRIMARY KEY (tenant_id, key)
);

-- System modules (always visible, not toggleable)
INSERT OR IGNORE INTO modules (tenant_id, key, label, icon, route, sort_order, is_enabled, admin_only, is_system) VALUES
  (1, 'dashboard',  'Dashboard',  'LayoutDashboard', '/',          0,  1, 0, 1),
  (1, 'closing',    'Closing',    'SquareActivity',  '',          99,  1, 1, 1),
  (1, 'audit',      'Audit & Transactions', 'Shield', '/audit',   97,  1, 1, 1),
  (1, 'settings',   'Settings',   'Settings',        '/settings', 100, 1, 1, 1);

-- Toggleable modules (can be enabled/disabled from Settings > Modules)
INSERT OR IGNORE INTO modules (tenant_id, key, label, icon, route, sort_order, is_enabled, admin_only, is_system) VALUES
  (1, 'pos',         'Point of Sale','ShoppingCart',  '/pos',           1,  1, 0, 0),
  (1, 'debts',       'Accounts',     'BookOpen',      '/debts',         2,  1, 0, 0),
  (1, 'inventory',   'Inventory',    'Package',       '/products',      3,  1, 0, 0),
  (1, 'clients',     'Clients',      'Users',         '/clients',       4,  1, 0, 0),
  (1, 'exchange',    'Exchange',     'RefreshCw',     '/exchange',      5,  1, 0, 0),
  (1, 'omt_whish',   'OMT/Whish',   'Send',          '/services',      6,  1, 0, 0),
  (1, 'recharge',    'MTC/Alfa',     'Smartphone',    '/recharge',      7,  0, 0, 0),
  (1, 'expenses',    'Expenses',     'Banknote',      '/expenses',      8,  1, 0, 0),
  (1, 'maintenance', 'Maintenance',  'Wrench',        '/maintenance',   9,  1, 0, 0),
  (1, 'binance',     'Binance',      'Bitcoin',       '/recharge',     10,  0, 0, 0),
  (1, 'ipec_katch',  'iPick/Katsh',  'Zap',           '/recharge',     11,  0, 0, 0),
  (1, 'custom_services','Services', 'Briefcase',     '/custom-services',12, 1, 0, 0),
  (1, 'profits',        'Profits',  'TrendingUp',    '/profits',        13, 1, 1, 0),
  (1, 'customer_sessions','Sessions','UserCheck',    '/customer-sessions',14, 1, 0, 0),
  (1, 'partners',       'Partners', 'Handshake',     '/partners',       15, 1, 0, 0),
  (1, 'loto',           'Loto',     'Ticket',        '/loto',           16, 1, 0, 0),
  (1, 'suppliers',      'Suppliers','Truck',         '/suppliers',      17, 1, 0, 0),
  (1, 'vouchers',       'Vouchers', 'Gift',          '/vouchers',       18, 1, 0, 0);

-- Currency–Module junction (which currencies are allowed in which modules)
-- NOTE: composite FKs — both currencies.code and modules.key lost their
-- standalone uniqueness (both became tenant-scoped), so the parent key for
-- each FK must include tenant_id too.
CREATE TABLE IF NOT EXISTS currency_modules (
    tenant_id     INTEGER REFERENCES tenants(id),
    currency_code TEXT NOT NULL,
    module_key    TEXT NOT NULL,
    PRIMARY KEY (tenant_id, currency_code, module_key),
    FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, module_key)    REFERENCES modules(tenant_id, key)     ON DELETE CASCADE
);

-- USD: enabled for all financial modules
INSERT OR IGNORE INTO currency_modules (tenant_id, currency_code, module_key) VALUES
  (1, 'USD', 'pos'), (1, 'USD', 'debts'), (1, 'USD', 'exchange'),
  (1, 'USD', 'omt_whish'), (1, 'USD', 'recharge'), (1, 'USD', 'expenses'),
  (1, 'USD', 'maintenance'), (1, 'USD', 'binance'), (1, 'USD', 'ipec_katch'),
  (1, 'USD', 'custom_services'), (1, 'USD', 'closing'), (1, 'USD', 'loto'),
  (1, 'USD', 'vouchers');

-- LBP: enabled for most modules except OMT/Whish, Binance
INSERT OR IGNORE INTO currency_modules (tenant_id, currency_code, module_key) VALUES
  (1, 'LBP', 'pos'), (1, 'LBP', 'debts'), (1, 'LBP', 'exchange'),
  (1, 'LBP', 'expenses'), (1, 'LBP', 'maintenance'), (1, 'LBP', 'ipec_katch'),
  (1, 'LBP', 'custom_services'), (1, 'LBP', 'recharge'), (1, 'LBP', 'closing'),
  (1, 'LBP', 'loto');

-- EUR: exchange only (by default)
INSERT OR IGNORE INTO currency_modules (tenant_id, currency_code, module_key) VALUES
  (1, 'EUR', 'exchange');

-- Currency–Drawer junction (which currencies are shown per drawer)
CREATE TABLE IF NOT EXISTS currency_drawers (
    tenant_id     INTEGER REFERENCES tenants(id),
    currency_code TEXT NOT NULL,
    drawer_name   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, currency_code, drawer_name),
    FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code) ON DELETE CASCADE
);

-- Seed drawer-currency mappings (matches drawer_balances seed data)
INSERT OR IGNORE INTO currency_drawers (tenant_id, currency_code, drawer_name) VALUES
  (1, 'USD', 'General'),    (1, 'LBP', 'General'),
  (1, 'USD', 'OMT_System'), (1, 'LBP', 'OMT_System'),
  (1, 'USD', 'OMT_App'),    (1, 'LBP', 'OMT_App'),
  (1, 'USD', 'Whish_App'),  (1, 'LBP', 'Whish_App'),
  (1, 'USDT', 'Binance'),
  (1, 'USD', 'MTC'),
  (1, 'USD', 'Alfa'),
  (1, 'USD', 'iPick'),       (1, 'LBP', 'iPick'),
  (1, 'USD', 'Katsh'),       (1, 'LBP', 'Katsh'),
  (1, 'USD', 'Whish_System'), (1, 'LBP', 'Whish_System');

-- Debt ledger indexes
CREATE INDEX IF NOT EXISTS idx_debt_ledger_client_type ON debt_ledger(client_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_due_date ON debt_ledger(due_date);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_session_id ON debt_ledger(session_id);

-- =============================================================================
-- 9. Payment Methods
-- =============================================================================

CREATE TABLE IF NOT EXISTS payment_methods (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id      INTEGER REFERENCES tenants(id),
    code           TEXT NOT NULL,                   -- e.g. 'CASH', 'OMT', 'WHISH'
    label          TEXT NOT NULL,                   -- Display name: 'Cash', 'OMT Wallet'
    drawer_name    TEXT NOT NULL,                   -- Which drawer this method affects
    affects_drawer INTEGER NOT NULL DEFAULT 1,      -- 0 = no drawer impact (e.g. CUSTOMER_ACCOUNT)
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1,
    is_system      INTEGER NOT NULL DEFAULT 0,      -- 1 = cannot be deleted (CASH, CUSTOMER_ACCOUNT)
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, code)
);

-- Seed default payment methods
INSERT OR IGNORE INTO payment_methods (tenant_id, code, label, drawer_name, affects_drawer, sort_order, is_system, is_active) VALUES
  (1, 'CASH',             'Cash',                'General',   1, 0, 1, 1),
  (1, 'OMT',              'OMT Wallet',          'OMT_App',   1, 1, 0, 1),
  (1, 'WHISH',            'Whish Wallet',        'Whish_App', 1, 2, 0, 1),
  (1, 'BINANCE',          'Binance',             'Binance',   1, 3, 0, 1),
  (1, 'CUSTOMER_ACCOUNT', 'Customer Account',    'General',   0, 4, 1, 1),
  (1, 'GIFT_CARD',        'Gift Card / Voucher', 'General',   0, 5, 1, 1);

-- Seed system suppliers (linked to modules)
INSERT OR IGNORE INTO suppliers (tenant_id, name, module_key, provider, is_system) VALUES
  (1, 'iPick',         'ipec_katch', 'iPick',         1),
  (1, 'Katsh',        'ipec_katch', 'Katsh',        1),
  (1, 'OMT',          'omt_whish',  'OMT',          1),
  (1, 'Whish',        'omt_whish',  'WHISH',        0),
  (1, 'OMT App',      'ipec_katch', 'OMT_APP',      1),
  (1, 'Whish App',    'ipec_katch', 'WHISH_APP',    1);

-- =============================================================================
-- 9a. Vouchers (Gift Cards)
-- =============================================================================

CREATE TABLE IF NOT EXISTS vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    code TEXT NOT NULL,                       -- GIFT-A3F9-K2M1
    client_id INTEGER NOT NULL,              -- owner (required for partial-redemption credit)
    client_name TEXT NOT NULL,               -- snapshot at creation
    client_phone TEXT,                       -- snapshot
    amount DECIMAL(10, 2) NOT NULL,          -- face value (USD)
    currency_code TEXT NOT NULL DEFAULT 'USD',
    expiry_date TEXT,                        -- ISO date, NULL = no expiry
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'expired', 'cancelled')),
    redeemed_at TEXT,
    redeemed_by INTEGER,
    redeemed_in_transaction TEXT,            -- 'sale' | 'custom_service' | 'recharge' | 'session'
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
);

CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
CREATE INDEX IF NOT EXISTS idx_vouchers_client_id ON vouchers(client_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_created_at ON vouchers(created_at);

-- =============================================================================
-- 9b. Loto Module
-- =============================================================================

-- Loto tickets (sold tickets tracking)
CREATE TABLE IF NOT EXISTS loto_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    client_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    edited_by TEXT DEFAULT NULL,
    edited_at TEXT DEFAULT NULL,
    is_refunded INTEGER DEFAULT 0,
    refunded_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_loto_tickets_sale_date ON loto_tickets(sale_date);
CREATE INDEX IF NOT EXISTS idx_loto_tickets_is_winner ON loto_tickets(is_winner);
CREATE INDEX IF NOT EXISTS idx_loto_tickets_checkpoint ON loto_tickets(checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_loto_tickets_client_id ON loto_tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_loto_tickets_tenant_id ON loto_tickets(tenant_id);

-- Loto settings (commission rate, monthly fee, etc.)
CREATE TABLE IF NOT EXISTS loto_settings (
    tenant_id INTEGER REFERENCES tenants(id),
    key_name TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, key_name)
);

-- Seed default loto settings
INSERT OR IGNORE INTO loto_settings (tenant_id, key_name, value, description) VALUES
  (1, 'commission_rate', '0.0445', 'Commission rate (4.45%)'),
  (1, 'monthly_fee_amount', '1400000', 'Monthly machine fee in LBP'),
  (1, 'auto_record_monthly_fee', '1', 'Enable/disable auto-recording of monthly fee');

-- Loto monthly fees (machine rental fees)
CREATE TABLE IF NOT EXISTS loto_monthly_fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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
INSERT OR IGNORE INTO suppliers (tenant_id, name, provider, is_active, is_system) VALUES (1, 'Loto Liban', 'LOTO', 1, 1);

-- Seed Loto module
INSERT OR IGNORE INTO modules (tenant_id, key, label, icon, route, sort_order, admin_only)
VALUES (1, 'loto', 'Loto', 'Ticket', '/loto', 16, 0);

-- Add currency-modules for Loto
INSERT OR IGNORE INTO currency_modules (tenant_id, currency_code, module_key)
VALUES (1, 'USD', 'loto'), (1, 'LBP', 'loto');

-- Add currency-drawers for Loto
INSERT OR IGNORE INTO currency_drawers (tenant_id, currency_code, drawer_name)
VALUES (1, 'USD', 'Loto'), (1, 'LBP', 'Loto');

-- Loto checkpoints (scheduled checkpoint tracking)
CREATE TABLE IF NOT EXISTS loto_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
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
    tenant_id INTEGER REFERENCES tenants(id),
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
    tenant_id INTEGER REFERENCES tenants(id),
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
    tenant_id INTEGER REFERENCES tenants(id),
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
    -- Set only on rows written during an impersonated session: the real
    -- super_admin acting behind the tenant-admin identity in user_id.
    impersonator_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id ON audit_log(tenant_id);

-- =============================================================================
-- 11. Hold Money
-- =============================================================================

CREATE TABLE IF NOT EXISTS hold_money (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    client_name TEXT NOT NULL,
    phone_number TEXT,
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

CREATE INDEX IF NOT EXISTS idx_hold_money_status ON hold_money(status);
CREATE INDEX IF NOT EXISTS idx_hold_money_created_at ON hold_money(created_at);

-- =============================================================================
-- 13. Stock Adjustments (LIRA-077 audit trail)
-- =============================================================================

-- Audit trail for manual stock corrections (InventoryService.adjustStock /
-- adjustStockDelta). Written in the SAME transaction as the products
-- stock_quantity UPDATE — see ProductRepository.adjustStock/adjustStockDelta.
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
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product_id ON stock_adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_created_at ON stock_adjustments(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_tenant_id ON stock_adjustments(tenant_id);

-- =============================================================================
-- 12. Migration Tracking
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
    (59, 'replace_delta_with_buy_sell_rates'),
    (60, 'add_client_name_phone_to_transactions'),
    (61, 'add_checkout_columns_to_customer_sessions'),
    (62, 'add_session_cart_items'),
    (63, 'add_user_id_to_sessions_and_cart'),
    (64, 'add_customer_sessions_module'),
    (65, 'session_checkout_currency_split_and_profit'),
    (66, 'add_voucher_images_table'),
    (67, 'add_item_costs_table'),
    (68, 'add_edit_history_table'),
    (69, 'add_note_to_recharges'),
    (70, 'add_note_to_expenses'),
    (71, 'add_profit_columns_to_transactions_and_session_transactions'),
    (72, 'add_default_price_to_client_to_recharges'),
    (73, 'add_category_to_custom_services'),
    (74, 'create_service_presets_table'),
    (75, 'seed_customer_account_payment_method'),
    (76, 'rename_debt_to_customer_account'),
    (77, 'create_partners_system'),
    (78, 'add_partner_system_association'),
    (79, 'add_loto_prizes_and_fees'),
    (80, 'add_shop_base_system_setting'),
    (81, 'add_expenses_created_at_updated_at'),
    (82, 'add_partners_and_audit_modules'),
    (83, 'add_partner_mode_and_transaction_types'),
    (84, 'add_suppliers_module'),
    (85, 'heal_expenses_note_column'),
    (86, 'consolidate_customer_account_code'),
    (87, 'add_paid_amount_currency_to_financial_services'),
    (88, 'fix_katsh_supplier_provider_name'),
    (89, 'add_vouchers_module'),
    (90, 'heal_unredeemed_gift_card_credit'),
    (91, 'per_drawer_checkpoint_index'),
    (92, 'maintenance_lbp_pricing'),
    (93, 'binance_drawer_usdt_currency'),
    (94, 'loto_tickets_add_client_fields'),
    (95, 'usdt_currency_activate'),
    (96, 'rename_supplier_katch_to_katsh'),
    (97, 'widen_recharges_carrier_constraint'),
    (98, 'add_whish_topup_partner_ledger_type'),
    (99, 'add_sale_cost_entry_type'),
    (100, 'add_session_id_to_payments'),
    (101, 'backfill_custom_maintenance_profit_into_transactions'),
    (102, 'remove_secondary_system_supplier_ledger_pollution'),
    (103, 'add_supplier_pays_us_entry_type'),
    (104, 'add_updated_at_to_sales'),
    (105, 'rename_wish_app_to_whish_app'),
    (106, 'add_bill_to_financial_service_type'),
    (107, 'fix_loto_liban_is_system'),
    (108, 'link_product_suppliers_to_suppliers'),
    (109, 'add_supplier_purchases'),
    (110, 'supplier_ledger_is_auto'),
    (111, 'add_hold_money'),
    (112, 'add_phone_to_hold_money'),
    (113, 'normalize_staff_role'),
    (114, 'allow_alfa_gift_recharge_type'),
    (115, 'prepaid_units_supplier_debt_booked'),
    (116, 'normalize_iso_created_at'),
    (117, 'rename_mtc_cards_to_face_value'),
    (118, 'rename_alfa_cards_to_face_value'),
    (119, 'flip_loto_supplier_ledger_sign'),
    (120, 'add_supplier_ledger_refund_flag'),
    (121, 'add_session_id_to_debt_ledger'),
    (122, 'rename_debts_module_to_accounts'),
    (123, 'add_multi_tenancy'),
    (124, 'name_home_tenant_from_shop'),
    (125, 'add_allow_out_of_stock_sales_setting'),
    (126, 'zero_sale_txn_amount_lbp_tender_dup'),
    (127, 'drop_partner_ledger_type_check'),
    (128, 'add_partner_ledger_covered_amount'),
    (129, 'add_debt_ledger_covered_amounts'),
    (130, 'backfill_supplier_payment_is_auto_metadata'),
    (131, 'add_discount_entry_type_supplier_ledger'),
    (132, 'add_stock_adjustments_table'),
    -- v133/v134 are data-only repairs (phantom wallet-provider ledger rows /
    -- C3-era under-booked OMT/WHISH SEND debt) — nothing to do on a fresh DB.
    (133, 'delete_wallet_provider_phantom_ledger'),
    (134, 'trueup_omt_whish_send_ledger_fee'),
    (135, 'add_carrier_lines_and_mobile_item_validity'),
    (136, 'add_supplier_ledger_source_ref'),
    (137, 'add_drawer_cashouts_table'),
    (138, 'add_wallet_exchanges_table'),
    (139, 'add_system_float_topups_table'),
    (140, 'rebuild_system_float_topups_as_drawer_transfers'),
    (141, 'add_telecom_days_credit_validity_schema'),
    (142, 'add_carrier_line_movement_previous_validity'),
    -- v143 is a data-only backfill (mobile_service_items.credits on existing
    -- installs) — nothing to do on a fresh DB, since the frontend catalog
    -- seed (parseCatalogToSeedData, which reads the already-patched
    -- mobileServices.ts) supplies credits directly the first time it runs.
    (143, 'backfill_credits_on_prepaid_cards'),
    (144, 'seed_telecom_credit_cost_rate_and_backfill_days_cost'),
    (145, 'backfill_alfa_prepaid_validity_days'),
    (146, 'reanchor_telecom_credit_cost_rate'),
    (147, 'seed_sell_days_lbp_from_validity_days'),
    (148, 'add_daily_closing_carrier_lines'),
    (149, 'allow_credit_buyback_recharge_type');
