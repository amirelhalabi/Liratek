-- Migration 002: Add missing columns to products table

-- Add category (e.g., 'Phones', 'Accessories')
ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'General';



-- Add min_stock_level for low stock alerts
ALTER TABLE products ADD COLUMN min_stock_level INTEGER DEFAULT 5;

-- Add image_url for product images
ALTER TABLE products ADD COLUMN image_url TEXT;

-- Note: cost_price_usd and selling_price_usd already exist, 
-- we will map the frontend 'cost_price' and 'retail_price' to these in the handler.
