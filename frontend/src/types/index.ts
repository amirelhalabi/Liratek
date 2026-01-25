/**
 * Renderer-facing types.
 *
 * Source of truth is now @liratek/core (packages/shared).
 * Keep this file as a thin re-export to avoid churn in UI imports.
 */

export type {
  ProductEntity,
  ClientEntity,
  SaleItem,
  SaleRequest,
  Expense,
} from "@liratek/core";

// Product with aliased field names for frontend compatibility
export interface Product extends Omit<ProductEntity, 'selling_price_usd' | 'cost_price_usd'> {
  retail_price: number;
  cost_price: number;
}

// Client type alias
export type Client = ClientEntity;
export interface CartItem {
  id: number;
  product: Product;
  quantity: number;
  price_usd: number;
  retail_price: number;
}
