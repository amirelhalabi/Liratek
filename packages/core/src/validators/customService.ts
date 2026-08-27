import { z } from "zod";
import { transactionTimeSchema } from "./common.js";

/**
 * Custom Service validation schemas
 */

export const createCustomServiceSchema = z
  .object({
    description: z.string().min(0).max(500).optional().default(""),
    cost_usd: z.coerce.number().min(0).default(0),
    cost_lbp: z.coerce.number().min(0).default(0),
    price_usd: z.coerce.number().min(0).default(0),
    price_lbp: z.coerce.number().min(0).default(0),
    paid_by: z.string().min(1).default("CASH"),
    status: z.enum(["pending", "completed"]).default("completed"),
    client_id: z.coerce.number().int().positive().optional(),
    client_name: z.string().max(255).optional(),
    phone_number: z.string().max(50).optional(),
    note: z.string().max(1000).optional(),
    category: z.string().max(100).optional(),
    transaction_time: transactionTimeSchema,
    // T3 keep-change (KC-3): kept change per currency → profit stamp.
    kept_change_usd: z.coerce.number().min(0).optional(),
    kept_change_lbp: z.coerce.number().min(0).optional(),
    voucher_code: z.string().optional(),
    // Structured payment legs in the currency the customer ACTUALLY paid
    // (split payments, pay-in-other-currency, and change/return legs). Snake
    // case — the form serializes with toSnakeLegs.
    payments: z
      .array(
        z.object({
          method: z.string().min(1),
          currency_code: z.string().min(1),
          amount: z.number(),
          voucher_code: z.string().optional(),
          direction: z.enum(["IN", "OUT"]).optional(),
        }),
      )
      .optional(),
    // Session-basket deferred payment mode: basket owns the customer-cash price
    // inflow + debt; the shop's own cost outflow (General drawer) is still booked.
    deferPayment: z.boolean().optional(),
    // Operator-edited USD↔LBP rate of record, threaded by the session checkout so
    // the unified transaction stores it (the viewer's "@ <rate>" + USD/LBP display).
    exchange_rate: z.coerce.number().positive().optional(),
    // LIRA-081 (PFT-R): a "for partner" custom service — mirrors FOR_RECHARGE.
    // No counter payment; the FULL price (per currency) books to the
    // partner's tab instead. See CustomServiceRepository.createService.
    partnerId: z.number().int().positive().optional(),
    /** Only "FOR" is valid for custom services — the partner analog of CUSTOMER_ACCOUNT. */
    partnerMode: z.enum(["FOR"]).optional(),
    // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 FINAL SPEC: the inventory
    // path is the only one of the three (preset/inventory/free-text) that
    // must decrement stock, like a POS sale. Sent ONLY when the operator
    // picked a product from the inventory SearchBar — preset/free-text never
    // send this, so they stay NULL -> no stock movement (unchanged
    // behaviour). Always consumes exactly 1 unit; no `quantity` field — the
    // form has no quantity control for a single ad-hoc service.
    product_id: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (data) =>
      data.cost_usd > 0 ||
      data.cost_lbp > 0 ||
      data.price_usd > 0 ||
      data.price_lbp > 0,
    {
      message: "At least one cost or price must be greater than 0",
    },
  )
  .refine((data) => data.paid_by !== "CUSTOMER_ACCOUNT" || data.client_id, {
    message: "A client is required when payment method is Customer Account",
  })
  .refine(
    (data) =>
      data.paid_by !== "GIFT_CARD" ||
      (data.voucher_code != null && data.voucher_code.trim().length > 0),
    {
      message: "A voucher code is required when paying by Gift Card",
    },
  )
  .refine(
    (data) => data.partnerMode !== "FOR" || data.paid_by !== "CUSTOMER_ACCOUNT",
    {
      // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3: explicit rule, not a
      // side effect of the CUSTOMER_ACCOUNT-requires-client_id refine above
      // (which would only fire when client_id is ALSO absent). Under
      // partnerMode "FOR" there is no customer owing — the PARTNER owes —
      // so CUSTOMER_ACCOUNT is never a valid paid_by here, with or without
      // a client_id. Mirrors the repository-layer rejection in
      // `assertNoCounterPayment` (moneyPosting.ts); this is the edge (Zod)
      // half of rule 19 — reject before the write, not just inside it.
      message:
        "paid_by cannot be Customer Account on a for-partner custom service — there is no customer owing, the partner owes",
      path: ["paid_by"],
    },
  );

export type CreateCustomServiceInput = z.infer<
  typeof createCustomServiceSchema
>;
