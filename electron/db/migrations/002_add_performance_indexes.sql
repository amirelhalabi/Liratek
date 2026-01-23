-- Migration: Add performance indexes
-- Date: 2025-12-30
-- Description: Add missing indexes for high-traffic queries

-- sales: common filters by status/date and joins by client_id
CREATE INDEX IF NOT EXISTS idx_sales_status_created_at ON sales(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_client_id_created_at ON sales(client_id, created_at);

-- sale_items: joins by sale_id and lookups by product_id
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);

-- products: barcode lookup and search
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);

-- debt_ledger: history by client_id and filtering by type/date
CREATE INDEX IF NOT EXISTS idx_debt_ledger_client_id_created_at ON debt_ledger(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_transaction_type_created_at ON debt_ledger(transaction_type, created_at);

-- expenses: filtering by expense_date
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);

-- activity_logs: dashboard/activity viewer
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id_created_at ON activity_logs(user_id, created_at);

-- maintenance: filtering and ordering
CREATE INDEX IF NOT EXISTS idx_maintenance_status_created_at ON maintenance(status, created_at);

-- exchange_transactions: history ordering
CREATE INDEX IF NOT EXISTS idx_exchange_transactions_created_at ON exchange_transactions(created_at);

-- financial_services: filters by provider/service_type and ordering
CREATE INDEX IF NOT EXISTS idx_financial_services_provider_type_created_at ON financial_services(provider, service_type, created_at);
CREATE INDEX IF NOT EXISTS idx_financial_services_created_at ON financial_services(created_at);

-- daily_closings: lookup by closing_date
CREATE INDEX IF NOT EXISTS idx_daily_closings_date ON daily_closings(closing_date);
