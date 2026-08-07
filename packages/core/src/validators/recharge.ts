import { z } from "zod";
import { positiveDecimalSchema, transactionTimeSchema } from "./common.js";
import { TOP_UP_PROVIDERS } from "../constants/rechargeProviders.js";

/**
 * Recharge validation schemas (MTC, Alfa)
 */

/**
 * THE single recharge-processing contract — shared by the desktop IPC handler
 * (`recharge:process`, via `electron-app/schemas/index.ts`'s `RechargeSchema`
 * re-export) and the REST route (`POST /api/recharge/process`).
 * CARRIER_LINES_VALIDITY_PLAN.md Phase 6a consolidated the two (rules 14 + 19b).
 *
 * WHY THIS MATTERS — the bug the consolidation fixed:
 * `backend/src/middleware/validation.ts` does `req.body = schema.parse(req.body)`
 * and Zod strips unknown keys. Until Phase 6a this schema had NO `payments`
 * field, so every REST recharge silently lost its split payment legs and fell
 * into `RechargeRepository`'s legacy single-method fallback, which routes the
 * FULL price to one drawer picked from `paid_by_method` alone. `clientName`,
 * `default_price_to_client` and the `ALFA_GIFT` type were stripped the same
 * way. Guarded by `backend/src/api/__tests__/recharge.api.test.ts`.
 *
 * ANY new field the recharge form sends MUST be added HERE — there is no
 * second copy to fall back on.
 */
export const createRechargeSchema = z.object({
  provider: z.enum(["MTC", "Alfa"]),
  // ALFA_GIFT came from the IPC copy; without it a REST Alfa-gift 400s.
  // `TOP_UP` is deliberately absent: it is a `RechargeData["type"]` the
  // repository writes internally (top-up paths), never a client-submitted one.
  // `CREDIT_BUYBACK` (CARRIER_LINES_VALIDITY_PLAN.md Phase 6): the shop-line
  // detection flip — routed to `RechargeRepository.processCreditBuyback`
  // instead of the normal sale body. Client-submitted, unlike TOP_UP.
  type: z.enum([
    "CREDIT_TRANSFER",
    "VOUCHER",
    "DAYS",
    "ALFA_GIFT",
    "CREDIT_BUYBACK",
  ]),
  // The IPC copy's `positive()` wins over the old REST `nonnegative()`: a
  // zero-amount recharge is meaningless for every type (0 credits, 0 days,
  // a $0 gift) and still writes a transaction row. The shipped desktop
  // contract has rejected it since forever.
  amount: z.number().positive(),
  cost: z.number().min(0).default(0),
  price: positiveDecimalSchema,
  default_price_to_client: z.number().nonnegative().optional(),
  currency: z.string().min(1).default("USD"),
  // Deliberately NOT `phoneNumberSchema`: the desktop IPC copy has always
  // accepted a free-form string here, so applying the Lebanese regex would
  // start rejecting formats the live telecom form accepts today (spaces,
  // separators). It is a display/lookup label on the recharge row, not money.
  phoneNumber: z.string().optional(),
  paid_by_method: z.string().min(1).default("CASH"),
  clientId: z.number().int().positive().optional(),
  // Walk-in name when no client record is selected (rule 11: the form's
  // client fields must reach the repository, not die at the schema).
  clientName: z.string().optional(),
  note: z.string().max(500).optional(),
  /**
   * Multi-payment legs. Legs WITHOUT `direction` are IN legs (customer-paid);
   * `direction: "OUT"` marks a leg the repository's shared end-of-transaction
   * OUT loop owns (change handed back) — see CLAUDE.md rule 16 and
   * `utils/payments.ts`'s `partitionLegs`.
   *
   * Shape note for the coming buy-back (plan Phase 6): a money-OUT payout is
   * carried by ordinary IN legs with the transaction-level direction flipped,
   * NOT by `direction: "OUT"` legs — so this shape already carries a payout
   * and needs no further schema change. `amount` stays an unconstrained
   * `z.number()` (as the IPC copy had it; the repository applies `Math.abs`).
   */
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        currencyCode: z.string().min(1),
        amount: z.number(),
        /** Set when method === 'GIFT_CARD' — the voucher code being redeemed. */
        voucherCode: z.string().optional(),
        direction: z.enum(["IN", "OUT"]).optional(),
      }),
    )
    .optional(),
  // T3 keep-change (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-3): kept (not
  // returned) change per currency → added to the transaction's profit stamp.
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
  transaction_time: transactionTimeSchema,
  // PFT-3a (Partner FOR-Transactions): the unpaid remainder routes to
  // partner_ledger instead of the client's debt_ledger when set. Only "FOR"
  // is valid for recharges.
  partnerId: z.number().int().positive().optional(),
  partnerMode: z.enum(["FOR"]).optional(),
  // Payment-Legs Integrity plan (false-reject fix, 2026-07-2x): the USD→LBP
  // rate MultiPaymentInput actually converted the customer's tender at (may
  // differ from the stamped sell-rate-of-record — see RechargeRepository's
  // `tender_exchange_rate` doc). Used ONLY for leg reconciliation, never to
  // stamp `transactions.exchange_rate`.
  tender_exchange_rate: z.number().positive().optional(),
  // NOTE — `deferPayment` is deliberately NOT accepted over the wire, on
  // either transport. It tells the repository "the session basket owns the
  // customer-cash inflow, book only the stock leg", and it is injected
  // server-side by `SessionCheckoutService` after validation. Exposing it
  // here would let any caller book a recharge that consumes provider credit
  // and collects nothing.
});

export const getRechargeStockSchema = z.object({
  // No parameters needed - empty schema for consistency
});

/**
 * CARRIER_LINES_VALIDITY_PLAN.md Phase 8.4 — the four remaining top-up arms
 * (`topUpApp`, `topUpFromSupplier`, `topUpFromPartner`, `topUpFromClient`)
 * lift their contracts here so the desktop IPC handler
 * (`electron-app/schemas/index.ts`'s re-export) and the new REST routes
 * (`backend/src/api/recharge.ts`) validate against ONE schema (rules 14 +
 * 19b) — the same pattern Phase 6a established for `createRechargeSchema`.
 *
 * `topUpAppSchema` is new: the IPC handler (`recharge:top-up-app`) had NO
 * Zod validation at all before this phase — closing that gap on both
 * transports at once, rather than moving a schema that didn't exist yet.
 */
export const topUpAppSchema = z.object({
  provider: z.enum(TOP_UP_PROVIDERS),
  // .positive(), not positiveDecimalSchema (which is actually .nonnegative()
  // despite the name) — matches the electron-app handler's existing
  // (unvalidated) contract: a zero-amount top-up moves nothing and is
  // meaningless.
  amount: z.number().positive(),
  currency: z.enum(["USD", "LBP"]),
  sourceDrawer: z.string().min(1),
});

export const topUpFromSupplierSchema = z.object({
  provider: z.enum(["iPick", "Katsh"]),
  amount: z.number().positive(),
  currency: z.enum(["USD", "LBP"]),
});

export const topUpFromPartnerSchema = z.object({
  provider: z.literal("WHISH_APP"),
  partnerId: z.number().int().positive(),
  amount: z.number().positive(),
  currency: z.enum(["USD", "LBP"]),
});

export const topUpFromClientSchema = z.object({
  amount: z.number().positive(),
  cashPaid: z.number().nonnegative(),
  currency: z.enum(["USD", "LBP"]),
  clientName: z.string().optional(),
  clientId: z.number().int().positive().optional(),
});

export type CreateRechargeInput = z.infer<typeof createRechargeSchema>;
export type GetRechargeStockInput = z.infer<typeof getRechargeStockSchema>;
export type TopUpAppInput = z.infer<typeof topUpAppSchema>;
export type TopUpFromSupplierInput = z.infer<typeof topUpFromSupplierSchema>;
export type TopUpFromPartnerInput = z.infer<typeof topUpFromPartnerSchema>;
export type TopUpFromClientInput = z.infer<typeof topUpFromClientSchema>;
