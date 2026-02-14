-- Migration: Add binance_transactions table
-- Date: 2026-02-13

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

CREATE INDEX IF NOT EXISTS idx_binance_transactions_created_at ON binance_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_binance_transactions_type_created_at ON binance_transactions(type, created_at);
