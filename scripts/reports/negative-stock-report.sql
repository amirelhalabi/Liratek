-- ============================================================================
-- Negative-stock report (READ-ONLY)
--
-- Why: before the POS stock-oversell guard shipped, two concurrent sales of the
-- last unit(s) could both decrement stock, driving `products.stock_quantity`
-- NEGATIVE. The guard stops NEW oversells but does not heal rows that already
-- went negative — and those products can no longer be sold (the guard's
-- `stock_quantity >= qty` check blocks them) until the count is reconciled.
--
-- This report lists every product currently at negative stock, per tenant, so
-- the shop can recount and correct. It only SELECTs — it changes nothing.
--
-- Run against a tenant/shared DB (plaintext SQLite):
--     sqlite3 "/path/to/liratek.db" < scripts/reports/negative-stock-report.sql
--
-- Virtual recharge items (Virtual_MTC / Virtual_Alfa) are excluded — they are
-- not POS-sold physical stock and are unaffected by the oversell bug.
-- ============================================================================

.headers on
.mode box

-- 1) Summary — how many products are negative, per tenant, and total shortfall.
SELECT
  p.tenant_id                        AS tenant_id,
  t.name                             AS tenant,
  COUNT(*)                           AS negative_products,
  -SUM(p.stock_quantity)             AS total_units_oversold
FROM products p
LEFT JOIN tenants t ON t.id = p.tenant_id
WHERE p.stock_quantity < 0
  AND COALESCE(p.is_deleted, 0) = 0
  AND p.item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
GROUP BY p.tenant_id, t.name
ORDER BY total_units_oversold DESC;

-- 2) Detail — each oversold product (most negative first) so counts can be fixed.
SELECT
  p.tenant_id                        AS tenant_id,
  t.name                             AS tenant,
  p.id                               AS product_id,
  p.name                             AS product,
  p.barcode                          AS barcode,
  p.stock_quantity                   AS stock,        -- negative
  -p.stock_quantity                  AS oversold_by,   -- units to reconcile
  p.is_active                        AS is_active
FROM products p
LEFT JOIN tenants t ON t.id = p.tenant_id
WHERE p.stock_quantity < 0
  AND COALESCE(p.is_deleted, 0) = 0
  AND p.item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
ORDER BY p.tenant_id, p.stock_quantity ASC;
