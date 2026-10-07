/**
 * The ONE "does this custom service have a selling price?" rule (rule 14),
 * shared by the custom-service writer (`CustomServiceRepository`), the
 * session cart-add writer (`CustomerSessionRepository.addCartItem`) and the
 * session checkout (`SessionCheckoutService`).
 *
 * Owner rule (2026-10-07): the selling price is the total the payment form
 * asks for; with no selling price there is nothing to pay, so the sale — and,
 * for a session basket, adding the line to the cart — is refused. Never the
 * cost.
 *
 * Browser-safe leaf (rule 29): imports nothing.
 */

/** The plain refusal a custom service with no selling price gets. */
export const NO_SELLING_PRICE_ERROR = "Enter a selling price first.";

/** The session-cart channels the checkout replays as a custom service —
 *  the current one and the legacy spelling older baskets may still hold. */
export const CUSTOM_SERVICE_CART_CHANNELS: readonly string[] = [
  "custom-services:add",
  "customService:create",
];

/** True when a cart line will be replayed as a custom service. Decided by the
 *  channel the checkout dispatches on, never the caller-chosen module label. */
export function isCustomServiceCartChannel(channel: unknown): boolean {
  return (
    typeof channel === "string" && CUSTOM_SERVICE_CART_CHANNELS.includes(channel)
  );
}

function positive(v: unknown): boolean {
  return typeof v === "number" && v > 0;
}

/** True when a selling price was entered in either currency. */
export function hasSellingPrice(
  data: { price_usd?: unknown; price_lbp?: unknown } | null | undefined,
): boolean {
  return !!data && (positive(data.price_usd) || positive(data.price_lbp));
}

/**
 * True when a custom-service cart line's form data carries a selling price.
 * A `_batch` line replays every sub-item under the parent's channel, so every
 * sub-item needs one (an empty batch has nothing to pay for). Anything that is
 * not an object reads as no price.
 */
export function customServiceCartLineHasSellingPrice(
  formData: unknown,
): boolean {
  if (!formData || typeof formData !== "object") return false;
  const fd = formData as Record<string, unknown>;
  if (fd._batch === true) {
    if (!Array.isArray(fd.items) || fd.items.length === 0) return false;
    return fd.items.every((sub) =>
      hasSellingPrice(sub as Record<string, unknown> | null),
    );
  }
  return hasSellingPrice(fd);
}
