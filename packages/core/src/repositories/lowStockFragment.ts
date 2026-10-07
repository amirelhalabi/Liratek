/**
 * The ONE definition of "this product is low on stock" (rule 14) — shared by
 * the TopBar low-stock notification (`ProductRepository.findLowStock`) and
 * the Dashboard's low-stock count (`SalesRepository.getDashboardStats`).
 *
 * A minimum stock of 0 means "no minimum set", so it never alerts. Without
 * the `min_stock_level > 0` guard, `0 <= 0` flags every product whose
 * stock and minimum are both 0 — which is every product right after a
 * Reset Data (owner decision 2026-10-07: a reset zeroes both columns, see
 * `RESET_ZERO_TABLES`).
 *
 * Unqualified column names: callers query `products` without an alias.
 */
export const LOW_STOCK_PREDICATE_SQL =
  "(min_stock_level > 0 AND stock_quantity <= min_stock_level)";
