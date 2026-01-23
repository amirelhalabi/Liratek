-- Migration: Add imei to sale_items
-- Date: Jan 23, 2026

ALTER TABLE sale_items ADD COLUMN imei TEXT;
