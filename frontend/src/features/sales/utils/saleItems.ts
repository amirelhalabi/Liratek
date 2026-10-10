/**
 * LIRA-296 (rule 22) — the ONE place a POS cart becomes a sale's item lines.
 * Every path that sends a sale (draft autosave, Save Draft, Complete Sale)
 * calls this, so the lines can never drift between them.
 */
import type { CartItem, SaleRequest } from "@liratek/ui";

export function toSaleItems(cartItems: CartItem[]): SaleRequest["items"] {
  return cartItems.map((item) => ({
    product_id: item.id,
    quantity: item.quantity,
    price: item.retail_price,
    imei: item.imei || "",
    // `exactOptionalPropertyTypes`: omit optional keys rather than send
    // `undefined`.
    ...(item.product_unit_id != null
      ? { product_unit_id: item.product_unit_id }
      : {}),
    // Only a length the cashier actually set at the till (0 included).
    ...(item.warranty_months_edit != null
      ? { warranty_months: item.warranty_months_edit }
      : {}),
  }));
}
