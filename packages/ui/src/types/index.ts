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
export interface Product extends Omit<
  ProductEntity,
  "selling_price_usd" | "cost_price_usd"
> {
  retail_price: number;
  cost_price: number;
  // LIRA-143 v157: mirrors ProductRepository's ProductDTO (findAllProducts
  // is the source for POS/Inventory product lists). tracks_imei_units is
  // inherited from the category (0 for uncategorized); warranty_months is
  // NULL when the product has no warranty.
  tracks_imei_units: number;
  warranty_months: number | null;
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
  // LIRA-143 phase 6a: carried from the Product row (the `Product` DTO type
  // above, not raw ProductEntity — these are computed/joined, not columns)
  // at add-to-cart time so the POS cart can gate the IMEI UI on the
  // product's own flag instead of sniffing `category` text (Cart.tsx's old
  // `category.includes("phone")` heuristic false-positived on things like
  // "Headphones" and missed every real phone category not literally named
  // "phone" — see resolveCartLineMode in
  // frontend/src/features/sales/utils/cartGate.ts).
  tracks_imei_units?: number;
  warranty_months?: number | null;
  /** The specific IN_STOCK `product_units` row this line sells. Only
   *  meaningful when `tracks_imei_units` is truthy AND the product has
   *  registered units — see resolveCartLineMode. Set by the operator
   *  picking a unit, or pre-filled by a resolved barcode/IMEI scan. */
  product_unit_id?: number;
  /** POS-local unique key for this cart LINE, distinct from `id` (the
   *  product's id, which repeats across multiple unit-tracked lines of the
   *  SAME product — each physical unit is its own qty-1 line). Only
   *  POS/index.tsx sets this (on a unit-tracked line); every other CartItem
   *  producer (sessions, maintenance) leaves it undefined and keeps using
   *  `id` to key/match lines, unaffected. */
  cartLineId?: string;
};
