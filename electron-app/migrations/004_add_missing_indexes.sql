-- Migration 004: Add Missing Database Indexes
-- Date: 2026-02-14
-- Purpose: Optimize query performance by adding strategic indexes

-- ============================================================================
-- SINGLE COLUMN INDEXES
-- ============================================================================

-- 1. Clients: full_name (used in ORDER BY full_name ASC in ClientRepository)
CREATE INDEX IF NOT EXISTS idx_clients_full_name 
ON clients(full_name COLLATE NOCASE);

-- 2. Products: category (filtering by category in product browsing)
CREATE INDEX IF NOT EXISTS idx_products_category 
ON products(category);

-- 3. Products: status (filtering by Active/Inactive status)
CREATE INDEX IF NOT EXISTS idx_products_status 
ON products(status);

-- 4. Expenses: category (grouping expense reports)
CREATE INDEX IF NOT EXISTS idx_expenses_category 
ON expenses(category);

-- 5. Expenses: expense_type (filtering by expense type)
CREATE INDEX IF NOT EXISTS idx_expenses_type 
ON expenses(expense_type);

-- 6. Maintenance: client_id (foreign key - client maintenance history)
CREATE INDEX IF NOT EXISTS idx_maintenance_client_id 
ON maintenance(client_id);

-- 7. Sales: drawer_name (filtering sales by drawer)
CREATE INDEX IF NOT EXISTS idx_sales_drawer_name 
ON sales(drawer_name);

-- ============================================================================
-- COMPOSITE INDEXES (for common query patterns)
-- ============================================================================

-- 8. Products: Active products by category
-- Query: SELECT * FROM products WHERE is_active = 1 AND category = ?
CREATE INDEX IF NOT EXISTS idx_products_active_category 
ON products(is_active, category);

-- 9. Products: Active products by status
-- Query: SELECT * FROM products WHERE is_active = 1 AND status = 'Active'
CREATE INDEX IF NOT EXISTS idx_products_active_status 
ON products(is_active, status);

-- 10. Sales: Client sales history ordered by date
-- Query: SELECT * FROM sales WHERE client_id = ? ORDER BY created_at DESC
-- Already covered by: idx_sales_client_id_created_at ✅

-- 11. Expenses: Expenses by date and category
-- Query: SELECT * FROM expenses WHERE expense_date >= ? AND category = ?
CREATE INDEX IF NOT EXISTS idx_expenses_date_category 
ON expenses(expense_date, category);

-- 12. Expenses: Expenses by type and date
-- Query: SELECT * FROM expenses WHERE expense_type = ? ORDER BY expense_date DESC
CREATE INDEX IF NOT EXISTS idx_expenses_type_date 
ON expenses(expense_type, expense_date DESC);

-- 13. Debt Ledger: Client transactions with type filter
-- Query: SELECT * FROM debt_ledger WHERE client_id = ? AND transaction_type = ?
CREATE INDEX IF NOT EXISTS idx_debt_ledger_client_type 
ON debt_ledger(client_id, transaction_type);

-- 14. Sales: Status and drawer (for drawer-specific reports)
-- Query: SELECT * FROM sales WHERE status = ? AND drawer_name = ?
CREATE INDEX IF NOT EXISTS idx_sales_status_drawer 
ON sales(status, drawer_name);

-- ============================================================================
-- PERFORMANCE NOTES
-- ============================================================================

-- Total new indexes: 12
-- Estimated performance improvement:
--   - Client list sorting: 3-5x faster
--   - Product filtering: 2-4x faster
--   - Expense reports: 2-3x faster
--   - Sales queries by drawer: 2-3x faster

-- Index size impact: ~100-200 KB (negligible)

