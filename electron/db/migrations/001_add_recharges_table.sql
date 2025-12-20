-- Migration: Add recharges table for mobile carrier recharges
-- Date: 2025-12-18
-- Description: Track Touch and Alfa mobile recharges for MTC/Alfa drawers

CREATE TABLE IF NOT EXISTS recharges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    carrier TEXT CHECK(carrier IN ('Touch', 'Alfa')) NOT NULL,
    amount_usd DECIMAL(10, 2) NOT NULL,
    phone_number TEXT,
    client_name TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries by carrier and date
CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
