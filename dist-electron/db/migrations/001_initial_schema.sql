-- ==========================================
-- PHONE SHOP MANAGEMENT SYSTEM - INITIAL SCHEMA
-- ==========================================

-- ==========================================
-- 1. CONFIGURATION & SETTINGS
-- ==========================================
CREATE TABLE system_settings (
    key_name TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 2. USERS
-- ==========================================
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'staff',
    is_active BOOLEAN DEFAULT 1
);

-- ==========================================
-- 3. CLIENTS MANAGEMENT
-- ==========================================
CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone_number TEXT UNIQUE,
    notes TEXT,
    whatsapp_opt_in BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 4. INVENTORY & SERVICES (PRODUCTS)
-- ==========================================
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    item_type TEXT NOT NULL,
    cost_price_usd DECIMAL(10, 2) DEFAULT 0,
    selling_price_usd DECIMAL(10, 2) DEFAULT 0,
    stock_quantity INTEGER DEFAULT 0,
    imei TEXT,
    color TEXT,
    warranty_expiry DATE,
    status TEXT DEFAULT 'Active',
    is_active BOOLEAN DEFAULT 1
);

-- ==========================================
-- 5. SALES HEADERS (The Receipt)
-- ==========================================
CREATE TABLE sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    total_amount_usd DECIMAL(10, 2),
    discount_usd DECIMAL(10, 2) DEFAULT 0,
    final_amount_usd DECIMAL(10, 2),
    paid_usd DECIMAL(10, 2) DEFAULT 0,
    paid_lbp DECIMAL(15, 2) DEFAULT 0,
    exchange_rate_snapshot DECIMAL(15, 2),
    status TEXT DEFAULT 'Completed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- ==========================================
-- 6. SALE ITEMS (Line Items)
-- ==========================================
CREATE TABLE sale_items (
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

-- ==========================================
-- 7. DEBT LEDGER
-- ==========================================
CREATE TABLE debt_ledger (
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

-- ==========================================
-- 8. MAINTENANCE / REPAIRS
-- ==========================================
CREATE TABLE maintenance_jobs (
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

-- ==========================================
-- 9. EXPENSES & LOSSES
-- ==========================================
CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT,
    category TEXT,
    expense_type TEXT,
    amount_usd DECIMAL(10, 2),
    amount_lbp DECIMAL(15, 2),
    expense_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 10. DAILY CLOSINGS (CHECKPOINTS)
-- ==========================================
CREATE TABLE daily_closings (
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
    notes TEXT
);

-- ==========================================
-- 11. SYNC QUEUE
-- ==========================================
CREATE TABLE sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT,
    record_id INTEGER,
    action_type TEXT,
    payload_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 12. ACTIVITY LOGS (Security & Audit)
-- ==========================================
CREATE TABLE activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    table_name TEXT,
    record_id INTEGER,
    details_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ==========================================
-- SEED DATA
-- ==========================================

-- Insert default admin user (password: admin123 - should be changed)
INSERT INTO users (username, password_hash, role) 
VALUES ('admin', '$2a$10$rKZhW8EqJ3xVxYxJ3xVxJO', 'admin');

-- Insert default system settings
INSERT INTO system_settings (key_name, value) VALUES
('shop_name', 'Corner Tech'),
('default_currency', 'USD'),
('exchange_rate_usd_lbp', '89000'),
('exchange_rate_usd_eur', '0.92');
