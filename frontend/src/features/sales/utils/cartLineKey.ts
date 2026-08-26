import type { CartItem } from "@liratek/ui";

/**
 * LIRA-143 phase 6a — `CartItem.id` is the PRODUCT's id everywhere else in
 * the app (sessions cart, drafts, checkout), so React keys and the
 * update/remove handlers in POS's Cart.tsx historically matched lines by
 * `id` — fine while a product could only ever have ONE cart line. Once a
 * unit-tracked product can have several qty-1 lines (one per physical
 * IMEI), those lines all share the same `id`, so matching by `id` would
 * update/remove/react-key ALL of them at once. `cartLineId` is the
 * disambiguator: POS/index.tsx stamps one on every unit-picker line;
 * everything else (drift-mode "none" and flag-off lines, and every other
 * CartItem producer in the app) leaves it unset and this falls back to
 * `id`, unchanged from before.
 */
export function getCartLineKey(item: CartItem): string {
  return item.cartLineId ?? String(item.id);
}

let counter = 0;

/** Generates a cart-line id that is unique within this render session. */
export function generateCartLineId(): string {
  counter += 1;
  return `unit-line-${Date.now()}-${counter}`;
}
