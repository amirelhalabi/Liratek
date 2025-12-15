-- Migration 003: Remove whish_price and add created_at

-- Remove whish_price column (SQLite 3.35+ supports DROP COLUMN)
ALTER TABLE products DROP COLUMN whish_price;

-- Add created_at column (Nullable initially, populated via app logic)
ALTER TABLE products ADD COLUMN created_at DATETIME;
