import { z } from "zod";
import { sessionCheckoutSchema } from "./session.js";
import { createFinancialServiceSchema } from "./financial.js";
import { transactionTimeSchema } from "./common.js";

/**
 * LIRA-326 — Mobile Recharge basket checkout: items picked on the iPick,
 * Katsh and Whish App grids, from two or more providers, paid ONCE.
 *
 * The server records it as an automatic walk-in customer session
 * (RechargeBasketService) and checks it out through SessionCheckoutService —
 * so this envelope IS the session checkout envelope, minus `sessionId` (the
 * service creates the session), plus the walk-in customer's phone. One
 * definition shared by the IPC handler and the REST route (rule 14).
 *
 * cartItems stay opaque here, as in session checkout; RechargeBasketService
 * enforces the basket-specific shape (only `financial:create` `_batch`
 * entries for the modules below, one provider per entry) before any write.
 */
export const RECHARGE_BASKET_MODULES = ["ipick", "katsh", "whish_app"] as const;
export type RechargeBasketModule = (typeof RECHARGE_BASKET_MODULES)[number];

/** The provider a module's sub-items must carry (`financial_services.provider`). */
export const RECHARGE_BASKET_MODULE_PROVIDER: Readonly<
  Record<RechargeBasketModule, string>
> = {
  ipick: "iPick",
  katsh: "Katsh",
  whish_app: "WHISH_APP",
};

/**
 * LIRA-327 — the modules whose bills can ride the basket. A bill is its own
 * cart entry (not a `_batch`): the same `financial:create` shape KatshForm
 * puts in a customer session for a bill — serviceType "BILL",
 * cost = price = amount, commission 0 — so checkout books it through the same
 * FinancialService call as a bill paid on its own.
 */
export const RECHARGE_BASKET_BILL_MODULES = ["ipick", "katsh"] as const;

export const rechargeBasketCheckoutSchema = sessionCheckoutSchema
  .omit({ sessionId: true })
  .extend({
    clientPhone: z.string().optional(),
  });

export type RechargeBasketCheckoutInput = z.infer<
  typeof rechargeBasketCheckoutSchema
>;
/** Rule 21 — what a caller SENDS (both transports), derived from the schema. */
export type RechargeBasketCheckoutPayload = z.input<
  typeof rechargeBasketCheckoutSchema
>;

/**
 * LIRA-327 — "For Partner" across the Mobile Recharge basket: every
 * provider's partner sales (iPick / Katsh card sales and bills, Whish App
 * units) submitted ONCE and booked all-or-nothing by
 * RechargePartnerOrderService.
 *
 * Each sale is exactly today's per-tab partner call
 * (`createFinancialServiceSchema`, rule 14) WITHOUT partnerId / partnerMode:
 * the order's `partnerId` is stamped on every sale with partnerMode "FOR".
 * The service refuses (before any write) a provider outside the basket, a
 * bill off iPick / Katsh, a RECEIVE, a customer payment leg or a walk-in
 * customer — a partner order collects no counter cash.
 */
export const rechargePartnerOrderSchema = z.object({
  partnerId: z.number().int().positive(),
  sales: z.array(createFinancialServiceSchema).min(1),
  transaction_time: transactionTimeSchema,
  /** The operator — overwritten by both transports with the authenticated user. */
  userId: z.number().int().positive(),
});

export type RechargePartnerOrderInput = z.infer<
  typeof rechargePartnerOrderSchema
>;
/** Rule 21 — what a caller SENDS (both transports), derived from the schema. */
export type RechargePartnerOrderPayload = z.input<
  typeof rechargePartnerOrderSchema
>;
