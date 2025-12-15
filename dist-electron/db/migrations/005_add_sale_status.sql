-- Migration 005
-- Status column already exists in schema (default 'Completed'), so we skip adding it.
-- We update existing records to lowercase 'completed' to match our app logic.
UPDATE sales SET status = 'completed' WHERE status = 'Completed';
ALTER TABLE sales ADD COLUMN note TEXT;
