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

/**
 * LIRA-363 (owner decisions 2026-10-30) — a custom service the cashier ticks
 * "Free — no charge" (`is_free`) saves with price 0: nothing is collected,
 * profit is −cost, and a via-partner job still books the partner the cost.
 * The tick is the only way to price 0 — an empty price without it is still
 * "type it first" (the 2026-10-07 rule above).
 *
 * The ONE free-job rule (rule 14), used by the schema (both transports) and
 * by `CustomServiceRepository.createService`. Returns why the job can't be
 * free, or null when it can (or is not marked free).
 */
export function freeJobProblem(data: {
  is_free?: boolean | undefined;
  cost_usd?: number | undefined;
  cost_lbp?: number | undefined;
  price_usd?: number | undefined;
  price_lbp?: number | undefined;
  paid_by?: string | undefined;
  payments?: readonly unknown[] | undefined;
  kept_change_usd?: number | undefined;
  kept_change_lbp?: number | undefined;
  extra_usd?: number | undefined;
  extra_lbp?: number | undefined;
  discount_usd?: number | undefined;
  discount_lbp?: number | undefined;
  partnerMode?: string | undefined;
  direction?: string | undefined;
  deferPayment?: boolean | undefined;
}): string | null {
  if (!data.is_free) return null;
  if (data.partnerMode === "FOR") {
    return "A job done for a partner can't be free — the partner is booked its price.";
  }
  if (data.direction === "OUT") return "A payout can't be free.";
  if (hasSellingPrice(data)) return "A free job has no selling price.";
  if (!positive(data.cost_usd) && !positive(data.cost_lbp)) {
    return "Enter the cost of the free job.";
  }
  if (
    (data.payments?.length ?? 0) > 0 ||
    data.paid_by === "CUSTOMER_ACCOUNT" ||
    data.paid_by === "GIFT_CARD" ||
    positive(data.kept_change_usd) ||
    positive(data.kept_change_lbp) ||
    positive(data.extra_usd) ||
    positive(data.extra_lbp) ||
    positive(data.discount_usd) ||
    positive(data.discount_lbp)
  ) {
    return "A free job takes no payment.";
  }
  if (data.deferPayment) {
    return "A free job is saved on its own, not in a session basket.";
  }
  return null;
}
