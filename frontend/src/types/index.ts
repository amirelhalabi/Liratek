/**
 * Renderer-facing types.
 *
 * Source of truth is now @liratek/core (packages/shared).
 * Keep this file as a thin re-export to avoid churn in UI imports.
 */

import type {
  ProductEntity,
  ClientEntity,
  SafeUser,
  SaleRequest,
  SaleItem,
} from "@liratek/core";

// Re-export for convenience
export type { SafeUser, ProductEntity, ClientEntity, SaleRequest, SaleItem };

// Product with aliased field names for frontend compatibility
export interface Product extends Omit<ProductEntity, 'selling_price_usd' | 'cost_price_usd'> {
  retail_price: number;
  cost_price: number;
}

// Client type alias
export type Client = ClientEntity;

// CartItem represents an entry in the shopping cart.
// Keep this intentionally permissive: different code paths construct cart items
// from either ProductEntity rows or simplified objects.
export type CartItem = Partial<ProductEntity> & {
  id: number;
  name: string;
  barcode: string;
  category: string;
  quantity: number;
  retail_price: number;
  cost_price: number;
  // Some code paths don't set these immediately
  price_usd?: number;
  imei?: string | null;
};
