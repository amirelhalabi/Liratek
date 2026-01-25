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
} from "@liratek/core";

// Re-export for convenience
export type { SafeUser, ProductEntity, ClientEntity };

// Product with aliased field names for frontend compatibility
export interface Product extends Omit<ProductEntity, 'selling_price_usd' | 'cost_price_usd'> {
  retail_price: number;
  cost_price: number;
}

// Client type alias
export type Client = ClientEntity;

// CartItem represents a product in the shopping cart
// It flattens Product fields for easier access in UI
export interface CartItem extends Omit<Product, 'id'> {
  id: number;
  quantity: number;
  price_usd: number;
  retail_price: number;
  cost_price: number;
  imei?: string;
}
