/**
 * Expenses (rest) fixtures (band 8 → ids 8501…). Convention: ../bindingFixtures.ts.
 * Agent B (LIRA-306 Phase 6). `seedSql` was produced by running the real
 * services once on a fresh real-schema database whose AUTOINCREMENT
 * sequences started at the band, so every row (and every id inside
 * metadata_json) is in the band; clock columns normalised to 2026-10-09.
 * Shared config (drawer balances) is only ever UPDATEd.
 */
import type { BindingFixture } from "../bindingFixtures";

const SEED = `
PRAGMA foreign_keys = OFF;
INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, exchange_rate, client_id, client_name, client_phone, reverses_id, profit_usd, profit_lbp, summary, metadata_json, device_id, created_at) VALUES (8501, 1, 'EXPENSE', 'ACTIVE', 'expenses', 8501, 1, -20, 0, 89750, NULL, NULL, NULL, NULL, 0, 0, 'Expense: Rent - Fixture rent', '{"category":"Rent","paid_by":"CASH","expense_date":"2026-10-09"}', NULL, '2026-10-09 10:00:00');
INSERT INTO products (id, tenant_id, barcode, name, item_type, category, category_id, description, supplier, supplier_id, unit, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity, imei, color, image_url, warranty_expiry, warranty_months, status, is_active, is_deleted, updated_at, created_at) VALUES (8501, 1, NULL, 'Fixture Tape 8501', 'Product', 'General', NULL, NULL, NULL, NULL, NULL, 2, 4, 5, 10, NULL, NULL, NULL, NULL, NULL, 'Active', 1, 0, NULL, '2026-10-09 10:00:00');
INSERT INTO expenses (id, tenant_id, description, category, expense_type, amount_usd, amount_lbp, paid_by_method, status, expense_date, note, edited_by, edited_at, is_refunded, refunded_at, source_ref_table, source_ref_id, item_source, item_id, item_quantity, stock_restored, created_at, updated_at) VALUES (8501, 1, 'Fixture rent', 'Rent', NULL, 20, 0, 'CASH', 'active', '2026-10-09', NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0, '2026-10-09 10:00:00', '2026-10-09 10:00:00');
INSERT INTO payments (id, tenant_id, transaction_id, session_id, method, drawer_name, currency_code, amount, note, created_by, created_at) VALUES (8501, 1, 8501, NULL, 'CASH', 'General', 'USD', -20, 'Rent: Fixture rent', 1, '2026-10-09 10:00:00');
PRAGMA foreign_keys = ON;
`;

export const FIXTURES: readonly BindingFixture[] = [
  { channel: "expenses:add-stock-use", seedSql: SEED, payload: { source: "INVENTORY", item_id: 8501, quantity: 1, category: "Shop use", expense_date: "2026-10-10" } },
  { channel: "expenses:update-metadata", payload: { id: 8501, note: "edited offline", description: "Fixture rent (Oct)" } },
  { channel: "db:delete-expense", payload: { id: 8501 } },
];
