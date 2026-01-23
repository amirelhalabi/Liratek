-- Migration: Add suppliers + supplier_ledger for dual-currency supplier debt
-- Date: 2025-12-31

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  phone TEXT,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Ledger stores deltas (positive means we owe more; negative means we paid down)
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

CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id_created_at ON supplier_ledger(supplier_id, created_at);
