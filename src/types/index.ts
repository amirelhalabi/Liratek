/**
 * Renderer-facing types.
 *
 * Source of truth is now @liratek/shared (packages/shared).
 * Keep this file as a thin re-export to avoid churn in UI imports.
 */

export type {
  Product,
  Client,
  CartItem,
  SaleItem,
  SaleRequest,
  Expense,
} from "@liratek/shared";
