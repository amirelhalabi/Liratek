-- Migration: Add payments + drawer_balances for per-method drawers and running expected balances
-- Date: 2025-12-31
-- Description:
-- - payments: detailed payment rows (method + currency + amount) tied to a source record (sale/service)
-- - drawer_balances: running balances per drawer/currency (carry-over across days)

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,          -- SALE, FINANCIAL_SERVICE, EXCHANGE, EXPENSE, RECHARGE, ...
  source_id INTEGER NOT NULL,
  method TEXT NOT NULL,               -- CASH, OMT, WHISH, BINANCE
  drawer_name TEXT NOT NULL,          -- General, OMT, Whish, Binance, MTC, Alfa
  currency_code TEXT NOT NULL,        -- USD, LBP (others later)
  amount REAL NOT NULL,               -- positive for inflow, negative for outflow
  note TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_source ON payments(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_payments_drawer_currency ON payments(drawer_name, currency_code, created_at);

CREATE TABLE IF NOT EXISTS drawer_balances (
  drawer_name TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (drawer_name, currency_code)
);

CREATE INDEX IF NOT EXISTS idx_drawer_balances_drawer ON drawer_balances(drawer_name);

-- ---------------------------------------------------------------------------
-- Backfill drawer_balances from the latest recorded Closing snapshot
-- Strategy (Option A):
-- - Find the most recent closing date that has daily_closing_amounts.
-- - For each (drawer_name, currency_code), prefer physical_amount if present; otherwise opening_amount.
-- - Insert into drawer_balances only if missing.
--
-- Note: if there is no closing data yet, balances remain at 0 until the operator sets an Opening.
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance)
SELECT
  dca.drawer_name,
  dca.currency_code,
  COALESCE(NULLIF(dca.physical_amount, 0), dca.opening_amount, 0) as balance
FROM daily_closing_amounts dca
JOIN daily_closings dc ON dc.id = dca.closing_id
WHERE dc.closing_date = (
  SELECT MAX(dc2.closing_date)
  FROM daily_closings dc2
  JOIN daily_closing_amounts dca2 ON dca2.closing_id = dc2.id
);

-- Ensure key drawers exist (even if no closings exist yet)
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Binance', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Binance', 'LBP', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('MTC', 'USD', 0);
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Alfa', 'USD', 0);
