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
  /**
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F wire contract (frozen): only
   * meaningful on a `direction: "OUT"` leg — IN legs never carry it. The
   * session checkout modal emits charge lines (IN, no `kind`), change lines
   * (OUT, `kind: "CHANGE"`), and per-currency operator-chosen payout legs
   * (OUT, `kind: "PAYOUT"`, e.g. a session RECEIVE/Loto-prize cashout).
   * Absent on an OUT leg = legacy behavior (treated as change) — every
   * pre-Phase-F payload parses unchanged.
   */
  kind: z.enum(["PAYOUT", "CHANGE"]).optional(),
  /**
   * Owner decision #11-A (2026-09-24, netted session checkout): meaningful
   * ONLY on a `kind: "PAYOUT"` leg. "SYSTEM" = an OMT/Whish SYSTEM
   * money-transfer-box payout — always routes 100% to the primary cash
   * drawer, NEVER netted against the basket's charge. "GENERAL" = a
   * General-drawer payout (loto prize, wallet/Binance cash-out) — routes
   * 100% to General; the frontend only ever sends the EXCESS left after
   * netting the CASH-routed portion against the charge (see
   * `netCashPayoutAgainstCharge`, binanceCart.ts). Absent = legacy
   * behavior: split by the session's blended primary-system payout share
   * (`SessionPaymentService.ratioForCurrency`) — every pre-#11-A payload
   * parses unchanged.
   */
  payoutOrigin: z.enum(["SYSTEM", "GENERAL"]).optional(),
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
/**
 * Rule 21 — what a caller SENDS to session checkout (both transports), derived
 * from the schema: `ApiAdapter.session.checkout`, `processSessionCheckout`
 * and the Electron adapter type their payload as this, never a hand copy.
 */
export type SessionCheckoutPayload = z.input<typeof sessionCheckoutSchema>;
export type SessionCheckoutPaymentInput = z.infer<
  typeof sessionCheckoutPaymentSchema
>;

// ---------------------------------------------------------------------------
// LIRA-297 item 3 (rule 21/23) — the non-checkout session write paths. Each
// schema covers the UNION of keys a transport forwards today (key sets diffed
// against preload.ts, sessionHandlers.ts and backend/src/api/sessions.ts), so
// putting it in front of a channel drops nothing. Actor fields are NOT part
// of the caller contract: both transports stamp the authenticated user.
// ---------------------------------------------------------------------------

/**
 * Start a customer session (`session:start` / `POST /api/sessions/start`).
 * `customer_name` is not `.min(1)` — neither transport enforced that before
 * (the modal trims and refuses a blank name itself).
 */
export const startSessionSchema = z.object({
  customer_name: z.string(),
  customer_phone: z.string().optional(),
  customer_notes: z.string().optional(),
});
export type StartSessionInput = z.input<typeof startSessionSchema>;

/**
 * The IPC handler's wider envelope: the desktop adapter also sends
 * `started_by` (the handler's fallback when the user row has no username).
 * `user_id` is deliberately absent — the handler overwrites it with the
 * authenticated user, so nothing a client sends there is ever used.
 */
export const startSessionIpcSchema = startSessionSchema.extend({
  started_by: z.string().optional(),
});
export type StartSessionIpcInput = z.input<typeof startSessionIpcSchema>;

/** Edit a session's customer info (`session:update` / `PUT /api/sessions/:id`). */
export const updateSessionSchema = z.object({
  customer_name: z.string().optional(),
  customer_phone: z.string().optional(),
  customer_notes: z.string().optional(),
});
export type UpdateSessionInput = z.input<typeof updateSessionSchema>;

/**
 * Persist one basket line (`session:cart:add` / `POST /api/sessions/:id/cart`).
 * `user_id` is absent on purpose: both transports overwrite it with the
 * authenticated user. `amount` is a plain number (no sign rule existed).
 */
export const sessionCartAddSchema = z.object({
  item_id: z.string().min(1),
  module: z.string().min(1),
  label: z.string(),
  amount: z.number(),
  currency: z.string().min(1),
  form_data: z.string(),
  ipc_channel: z.string().min(1),
});
export type SessionCartAddInput = z.input<typeof sessionCartAddSchema>;

/**
 * Link an already-booked transaction to a session
 * (`session:linkTransaction` / `POST /api/sessions/link-transaction`).
 * No `.default(0)` anywhere (rule 22): an absent profit is resolved by the
 * handlers' own `?? 0`, and the amounts are required — every caller sends
 * them. `sessionId` absent = link to the active session.
 */
export const linkSessionTransactionSchema = z.object({
  sessionId: z.number().int().positive().optional(),
  transactionType: z.string().min(1),
  transactionId: z.number().int().positive(),
  amountUsd: z.number(),
  amountLbp: z.number(),
  profitUsd: z.number().optional(),
  profitLbp: z.number().optional(),
});
export type LinkSessionTransactionInput = z.input<
  typeof linkSessionTransactionSchema
>;
