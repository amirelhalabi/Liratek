import type { ServiceItem } from "@/contexts/MobileServiceItemsContext";

export type {
  ProviderKey,
  ServiceItem,
} from "@/contexts/MobileServiceItemsContext";
export { useMobileServiceItemsContext as useMobileServiceItems } from "@/contexts/MobileServiceItemsContext";

/**
 * THE single canonical display name for a catalog item (iPick / Katsh / Whish /
 * …). Use this everywhere the item surfaces to a human so the string never
 * drifts across screens:
 *   - the customer-session cart label + Session Checkout modal,
 *   - the transaction summary (backend wraps this as `${provider}: <name> — <amount>`),
 *   - the single-item debt note (backend wraps this as `${provider} service: <name>`).
 *
 * Format: `category: label (subcategory)`; the `(subcategory)` is dropped when
 * blank. Context-specific extras — quantity (`xN`) for the aggregated cart line,
 * amount for the transaction — are appended by each caller and are NOT part of
 * the name. (The multi-item *session-basket* debt keeps its own "Session…"
 * recorder note; this helper is only the per-item name.)
 */
export function formatCatalogItemName(
  item: Pick<ServiceItem, "category" | "label" | "subcategory">,
): string {
  const sub = item.subcategory?.trim();
  return `${item.category}: ${item.label}${sub ? ` (${sub})` : ""}`;
}
