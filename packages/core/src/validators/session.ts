import { z } from "zod";

/**
 * Session checkout contract — the ONE basket payment envelope, shared by the
 * Electron IPC handler (session:checkout) and the REST route
 * (POST /api/sessions/checkout) via the SessionCheckoutService (rule 14).
 *
 * cartItems are validated as opaque (z.unknown) — each item's formData is
 * validated by its own module service when replayed; only the basket-payment
 * envelope is checked here, matching the original IPC schema.
 */

/** One customer-facing basket payment leg (the ONE payment for the whole cart). */
export const sessionCheckoutPaymentSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
  direction: z.enum(["IN", "OUT"]).optional(),
  // Present only for GIFT_CARD legs.
  voucher_code: z.string().optional(),
});

export const sessionCheckoutSchema = z
  .object({
    sessionId: z.number().int().positive(),
    cartItems: z.array(z.unknown()).min(1, "Cart is empty"),
    paidByMethod: z.string().optional(),
    payments: z.array(sessionCheckoutPaymentSchema).optional(),
    exchangeRate: z.number().positive().optional(),
    clientId: z.number().int().positive().optional(),
    clientName: z.string().optional(),
    // T3 keep-change: kept (not returned) change per currency → a standalone
    // KEPT_CHANGE profit row (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-4).
    kept_change_usd: z.number().nonnegative().optional(),
    kept_change_lbp: z.number().nonnegative().optional(),
    userId: z.number().int(),
  })
  .passthrough();

export type SessionCheckoutInput = z.infer<typeof sessionCheckoutSchema>;
export type SessionCheckoutPaymentInput = z.infer<
  typeof sessionCheckoutPaymentSchema
>;
