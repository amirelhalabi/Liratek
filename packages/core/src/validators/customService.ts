import { z } from "zod";
import { transactionTimeSchema } from "./common.js";
import { FULFILLMENT_STATUSES } from "../utils/insuranceFulfillment.js";

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
    //
    // LIRA-154: "VIA" is the mirror — the partner PERFORMS the service. The
    // walk-in customer pays US through the normal payment path (payments[]
    // etc. below, completely unforked); the shop owes the PARTNER the COST
    // instead, booked as a `THROUGH_CUSTOM_SERVICE` partner_ledger CREDIT.
    // See CustomServiceRepository.createService's isViaPartner block.
    partnerId: z.number().int().positive().optional(),
    /** "FOR" (partner uses our system) or "VIA" (partner performs the
     *  service) — the two partner modes custom services support. */
    partnerMode: z.enum(["FOR", "VIA"]).optional(),
    // OWNER_NOTES_REMAINING_BUILD.md #16 (Route A, migration v185) — a
    // direction field rather than negative cost/price, so .min(0) above
    // stays untouched. Omitted/"IN": the existing flow — the walk-in
    // customer pays the shop; under partnerMode "VIA" the shop owes the
    // partner the cost. "OUT": a PAYOUT — the shop hands cost_usd/cost_lbp
    // to a local recipient from the General drawer, and the partner is
    // booked owing the shop price_usd/price_lbp (the amount that "arrived"
    // via the partner). profit_usd/profit_lbp (price - cost, stamped below
    // exactly as for "IN") is the commission the shop keeps. Only valid
    // under partnerMode "VIA" — see the refine below. See
    // CustomServiceRepository.createService's `isPayout` block.
    //
    // Deliberately `.optional()` with NO `.default(...)`: every other
    // `.default(...)` field in this schema (cost_usd, price_usd, paid_by,
    // status, …) becomes REQUIRED in `CreateCustomServiceInput` (z.infer is
    // the post-parse output type), and a dozen existing test call sites
    // construct that type by hand, always supplying every defaulted field —
    // adding one MORE required field would break all of them for no
    // behavioural gain (the repository's own `data.direction ?? "IN"` /
    // `data.direction === "OUT"` checks already treat `undefined`
    // identically to "IN"). An optional field with no default stays
    // optional in the output type, same as `partnerMode`/`partnerId` above.
    direction: z.enum(["IN", "OUT"]).optional(),
    // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 FINAL SPEC: the inventory
    // path is the only one of the three (preset/inventory/free-text) that
    // must decrement stock, like a POS sale. Sent ONLY when the operator
    // picked a product from the inventory SearchBar — preset/free-text never
    // send this, so they stay NULL -> no stock movement (unchanged
    // behaviour). Always consumes exactly 1 unit; no `quantity` field — the
    // form has no quantity control for a single ad-hoc service.
    product_id: z.coerce.number().int().positive().optional(),
    // LIRA-155 — an insurance-style custom service starts fulfilment
    // tracking at creation (typically 'ORDERED'). Optional and NULL by
    // default so every non-insurance custom service (the overwhelming
    // majority) is completely unaffected — `fulfillment_status` stays NULL,
    // exactly like today. Reuses FULFILLMENT_STATUSES from the one pure
    // module (rule 14) instead of re-typing the four literals here.
    fulfillment_status: z.enum(FULFILLMENT_STATUSES).optional(),
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
  )
  .refine((data) => data.direction !== "OUT" || data.partnerMode === "VIA", {
    // OWNER_NOTES_REMAINING_BUILD.md #16: "Pay out" is Via-Partner only — a
    // partner is ALWAYS required for a payout (mirrors `isViaPartner &&
    // !data.partnerId` in the repository, which still enforces `partnerId`
    // itself — this refine only pins the direction/mode pairing).
    message:
      "direction 'OUT' (pay out) is only valid for a Via-Partner custom service",
    path: ["direction"],
  })
  .refine(
    (data) =>
      data.direction !== "OUT" ||
      ((data.price_usd > 0 || data.price_lbp > 0) &&
        (data.cost_usd > 0 || data.cost_lbp > 0)),
    {
      // A payout needs BOTH sides: price = what arrived via the partner
      // (booked as the partner's debt to the shop), cost = what physically
      // leaves the General drawer to the recipient (owner example: $100
      // arrives, customer gets $97, $3 profit — neither figure is optional).
      message:
        "A payout needs both the amount that arrived (price) and the amount paid out (cost)",
      path: ["cost_usd"],
    },
  );

export type CreateCustomServiceInput = z.infer<
  typeof createCustomServiceSchema
>;

/**
 * LIRA-155 — advance an existing custom service's fulfilment status.
 * `fulfillment_status` reuses FULFILLMENT_STATUSES (the one pure module,
 * rule 14) rather than re-typing 'ORDERED' | 'ISSUED' | 'RECEIVED' |
 * 'DELIVERED' a second time here. This schema only validates SHAPE (is
 * `fulfillment_status` one of the four known strings) — whether THIS
 * particular from -> to move is a legal single-step-forward transition is
 * business policy, checked server-side by
 * `CustomServiceService.advanceFulfillmentStatus` via
 * `isValidFulfillmentTransition`, not here.
 *
 * `id` travels IN this schema (not as a separate URL/IPC param) — mirrors
 * every other "update-metadata"-style shared schema in this codebase
 * (`updateExchangeMetadataSchema`, `debtAccountEntrySchema`'s siblings): a
 * static REST path with `id` in the body, validated by the SAME schema the
 * IPC handler validates against (rule 14). The two transports then call
 * `CustomServiceService.advanceFulfillmentStatus(id, fulfillment_status)`
 * with the validated values as separate arguments — this schema exists to
 * validate the wire shape, not to change the service's own signature.
 */
export const updateCustomServiceFulfillmentSchema = z.object({
  id: z.number().int().positive(),
  fulfillment_status: z.enum(FULFILLMENT_STATUSES),
});

export type UpdateCustomServiceFulfillmentInput = z.infer<
  typeof updateCustomServiceFulfillmentSchema
>;

/**
 * Edit non-financial metadata on a `custom_services` row — mirrors the
 * `custom-services:update-metadata` IPC handler's own inline shape
 * (electron-app/handlers/customServiceHandlers.ts), which validates nothing
 * beyond `requireRole`. Shared by the REST route (rule 14).
 *
 * TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3: `category` was missing
 * here even though `preload.ts`'s `customServices.updateMetadata` binding
 * types it, `CustomServiceService.updateCustomServiceMetadata` accepts it,
 * and `CustomServiceRepository.updateMetadata` already writes it to the
 * `category` column — the IPC handler and the REST route simply never
 * forwarded it from the request body to the service call. Added here so
 * validating against this schema doesn't newly strip a field the rest of
 * the stack already supports; the handler/route forwarding was the actual
 * bug, fixed alongside this schema change (rule 12 in reverse — the preload
 * type was right, the schema and the forwarding code were behind it).
 *
 * `note` raised from 500 to 1000 to match `createCustomServiceSchema.note`
 * (this file, above) — the create-time cap is 1000 and the create form's own
 * `maxLength` is 1000 (CustomServices/index.tsx), so a 500 cap here would
 * reject editing the note on a service created with 501-1000 characters.
 */
export const customServiceUpdateMetadataSchema = z.object({
  id: z.number().int().positive(),
  description: z.string().max(500).optional(),
  client_name: z.string().max(255).optional(),
  phone_number: z.string().max(50).optional(),
  note: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
});

export type CustomServiceUpdateMetadataInput = z.infer<
  typeof customServiceUpdateMetadataSchema
>;
