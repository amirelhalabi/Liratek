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

-- Clients
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone_number TEXT UNIQUE,
    notes TEXT,
    whatsapp_opt_in BOOLEAN DEFAULT 1,
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
    FOREIGN KEY (sale_id) REFERENCES sales(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Debt Ledger
CREATE TABLE IF NOT EXISTS debt_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL,
    amount_usd DECIMAL(10, 2),
    amount_lbp DECIMAL(15, 2),
    sale_id INTEGER,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (sale_id) REFERENCES sales(id)
);

-- Maintenance Jobs
CREATE TABLE IF NOT EXISTS maintenance_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    device_model TEXT,
    issue_description TEXT,
    cost_parts_usd DECIMAL(10, 2),
    cost_labor_usd DECIMAL(10, 2),
    price_to_client_usd DECIMAL(10, 2),
    status TEXT DEFAULT 'Received',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
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

-- Seed admin user if not exists (simple username, role)
INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (1, 'admin', '', 'admin', 1);

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

-- Daily Closing Amounts (per drawer and currency)
CREATE TABLE IF NOT EXISTS daily_closing_amounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closing_id INTEGER NOT NULL,
    drawer_name TEXT NOT NULL, -- General, OMT, MTC, Alfa
    currency_code TEXT NOT NULL,
    opening_amount REAL DEFAULT 0,
    physical_amount REAL DEFAULT 0,
    UNIQUE(closing_id, drawer_name, currency_code),
    FOREIGN KEY (closing_id) REFERENCES daily_closings(id)
);

-- Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    table_name TEXT,
    record_id INTEGER,
    details_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Currencies (for Exchange)
CREATE TABLE IF NOT EXISTS currencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL, -- e.g., USD, LBP, EUR
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Exchange Rates (cross-rate matrix)
CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_code TEXT NOT NULL,
    to_code TEXT NOT NULL,
    rate REAL NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_code, to_code)
);

-- Exchange Transactions
CREATE TABLE IF NOT EXISTS exchange_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT CHECK(type IN ('BUY', 'SELL')) NOT NULL, -- BUY = Client gives Source, Gets Target. SELL = Client gives Target, Gets Source (Legacy, now just BUY/SELL relative to shop?)
    -- Let's simplify: We record what came IN and what went OUT
    from_currency TEXT NOT NULL, -- USD, LBP, EUR
    to_currency TEXT NOT NULL,   -- USD, LBP, EUR
    amount_in DECIMAL(15, 2) NOT NULL,
    amount_out DECIMAL(15, 2) NOT NULL,
    rate DECIMAL(15, 2) NOT NULL,
    client_name TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Financial Services (OMT, Whish, etc.)
CREATE TABLE IF NOT EXISTS financial_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER')) NOT NULL,
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

-- Maintenance / Repairs
CREATE TABLE IF NOT EXISTS maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    client_name TEXT, -- Fallback if no ID
    device_name TEXT NOT NULL,
    issue_description TEXT,
    cost_usd DECIMAL(10, 2) DEFAULT 0, -- Internal Cost
    price_usd DECIMAL(10, 2) DEFAULT 0, -- Price to Client
    
    -- Payment Details
    discount_usd DECIMAL(10, 2) DEFAULT 0,
    final_amount_usd DECIMAL(10, 2) DEFAULT 0,
    paid_usd DECIMAL(10, 2) DEFAULT 0,
    paid_lbp DECIMAL(15, 2) DEFAULT 0,
    exchange_rate DECIMAL(15, 2),
    
    status TEXT DEFAULT 'Received', -- Draft, Received, In_Progress, Ready, Delivered
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);
