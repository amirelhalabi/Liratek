-- Migration 003: Add IPEC, Katch, Wish App providers
-- Expands the financial_services provider CHECK constraint and adds new drawer balances.

-- SQLite does not support ALTER TABLE ... ALTER COLUMN, so the CHECK constraint
-- is enforced at INSERT/UPDATE time.  For existing databases that already have the
-- old CHECK, we recreate the table via rename + copy pattern.

-- Step 1: Rename old table
ALTER TABLE financial_services RENAME TO financial_services_old;

-- Step 2: Create new table with expanded CHECK
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

-- Step 3: Copy data
INSERT INTO financial_services SELECT * FROM financial_services_old;

-- Step 4: Drop old table
DROP TABLE financial_services_old;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_financial_services_provider_type_created_at ON financial_services(provider, service_type, created_at);
CREATE INDEX IF NOT EXISTS idx_financial_services_created_at ON financial_services(created_at);

-- Step 6: Add new drawer balances
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('IPEC', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('IPEC', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katch', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katch', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Wish_App_Money', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Wish_App_Money', 'LBP', 0);
