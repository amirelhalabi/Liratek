import { z } from "zod";
import {
  positiveDecimalSchema,
  currencyCodeSchema,
  transactionTimeSchema,
} from "./common.js";

/**
 * Financial services validation schemas (OMT, WHISH, iPick, Katsh, Binance, etc.)
 */

/**
 * A `financial_services.provider` value.
 *
 * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 3 (migration v154):
 * `provider` used to be a closed 9-value enum, mirrored by a DB-level CHECK
 * constraint. The CHECK is now a composite FK against the tenant-scoped
 * `service_providers` config table (phases 1-2), so this schema stops
 * closing over a fixed literal union — same open-ended shape already used
 * for `currencyCodeSchema` above ("Runtime validation against DB happens at
 * the service layer"). Unlike `currencyCodeSchema`, this does NOT uppercase
 * the value: the 9 pre-existing codes are a genuine case mix (`iPick`,
 * `Katsh` vs `OMT_APP`, `WHISH_APP`) — forcing case would silently break the
 * FK lookup for any of them.
 *
 * This is shape validation ONLY (non-empty, bounded length, safe charset) —
 * a Zod schema has no DB handle, so it cannot confirm the code actually
 * exists as a configured `service_providers` row for the caller's tenant.
 * That membership check happens at the repository boundary
 * (`FinancialServiceRepository.createTransaction`, via
 * `ServiceProviderRepository.getByCode()`) and raises a clear "Invalid
 * provider" error there instead of either a silent pass-through or a raw
 * SQLITE_CONSTRAINT bubbling out of the INSERT — see that method's own
 * comment for the full rationale.
 */
const providerCodeSchema = z
  .string()
  .min(1, "Provider is required")
  .max(50, "Provider code must be 50 characters or fewer")
  .regex(
    /^[A-Za-z0-9_]+$/,
    "Provider code may only contain letters, numbers, and underscores",
  );

// OMT/WHISH Money Transfer & iPick/Katsh/WishApp/Binance services
export const createFinancialServiceSchema = z
  .object({
    provider: providerCodeSchema,
    // COMMISSION_AT_SETTLEMENT_PLAN.md §1.7 / §4 Phase 1 rule-19 gap: the
    // electron-app LOCAL FinancialServiceSchema (electron-app/schemas/index.ts)
    // already accepted 'BILL' — this shared core schema (which
    // backend/src/api/services.ts's REST route validates against directly,
    // no local copy) did not, so REST hard-rejected every iPick/Katsh bill;
    // bills were desktop-IPC-only on the write path. 'BILL' added here to
    // match the electron schema (rule 14 — one definition, both transports).
    serviceType: z.enum(["SEND", "RECEIVE", "BILL"]),
    amount: positiveDecimalSchema,
    currency: currencyCodeSchema.default("USD"),
    commission: positiveDecimalSchema.default(0),
    cost: z.number().min(0).optional(),
    price: z.number().min(0).optional(),
    paidByMethod: z.string().optional(),
    clientId: z.number().int().positive().optional(),
    clientName: z.string().max(255).optional(),
    referenceNumber: z.string().max(100).optional(),
    phoneNumber: z.string().max(30).optional(),
    omtServiceType: z
      .enum([
        "INTRA",
        "WESTERN_UNION",
        "CASH_TO_BUSINESS",
        "CASH_TO_GOV",
        "OMT_WALLET",
        "OMT_CARD",
        "OGERO_MECANIQUE",
        "ONLINE_BROKERAGE",
      ])
      .optional(),
    itemKey: z.string().max(255).optional(),
    itemCategory: z.string().max(500).optional(),
    note: z.string().max(500).optional(),
    // Fee calculation — direction-agnostic (SEND and RECEIVE both read
    // these the same way; there is no serviceType gate on any of the three
    // fields below). Float model (owner-confirmed 2026-07-29): a RECEIVE
    // can carry a customer-facing fee exactly like a SEND does — omtFee/
    // whishFee/includingFees are the SAME fields either direction uses, not
    // a SEND-only concept. Defaults to 0/false when omitted, which is what
    // makes "RECEIVE has no fee" (the pre-fix shape) fall out for free on
    // every existing caller that never sends these on a RECEIVE.
    omtFee: positiveDecimalSchema.optional(), // Fee charged by OMT (user-entered or auto-looked-up)
    /** Fee charged by WHISH (user-entered or auto-looked-up from WHISH_FEE_TIERS) */
    whishFee: positiveDecimalSchema.optional(),
    profitRate: z.number().min(0.001).max(0.004).optional(), // For ONLINE_BROKERAGE (0.1%-0.4%)
    payFee: z.boolean().optional(), // For BINANCE: charge fee to customer
    /**
     * true = the entered `amount`/fee are already netted together (fee
     * INCLUDED — nothing added on top of what the customer pays/receives);
     * false/omitted = fee ON TOP (added to what the customer pays on a
     * SEND, or paid as a separate leg on a RECEIVE). Applies to SEND and
     * RECEIVE alike — see FinancialServiceRepository's float-model comments
     * on the SEND/RECEIVE branches for the exact per-direction formula.
     */
    includingFees: z.boolean().optional(),
    /**
     * Surcharge collected from customer for paying via non-cash method (e.g. WHISH Wallet, Binance).
     * This is the shop's immediately realized profit. Only applies to SEND with non-cash paidByMethod.
     */
    paymentMethodFee: z.number().min(0).optional(),
    /**
     * Rate used to calculate paymentMethodFee (e.g. 0.01 = 1%).
     * Stored for audit purposes.
     */
    paymentMethodFeeRate: z.number().min(0).max(0.1).optional(),
    /** Multi-payment support. `direction` marks shop-paid OUT legs (change,
     * or the shop's own disbursement on a FOR-partner SEND) — without it the
     * web path would strip the field and turn a disbursement into a phantom
     * customer cash-in (rule 14: keep in sync with the electron
     * FinancialPaymentLegSchema, which already carries both). */
    payments: z
      .array(
        z.object({
          method: z.string(),
          currencyCode: z.string(),
          amount: z.number().positive(),
          direction: z.enum(["IN", "OUT"]).optional(),
          voucherCode: z.string().optional(),
        }),
      )
      .optional(),
    /**
     * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.2/§1.4, Phase A (owner decision
     * #1, 2026-08-06 — "the customer can pay by wish, can pay by any payment
     * method we have in the system"): on a system RECEIVE with a fee ON TOP
     * (`includingFees` false/omitted), the customer's provider fee `f` can be
     * collected via operator-chosen legs instead of the implicit single-leg
     * fallback — split allowed, any real tender method including
     * CUSTOMER_ACCOUNT. A deliberately NARROWER leg shape than `payments[]`
     * above: no `direction` (a fee leg is always customer-paid IN, never a
     * change/return leg) and no `voucherCode` (GIFT_CARD redemption isn't
     * wired into fee collection). Refined below: invalid (schema-rejected)
     * when `includingFees` is true (the fee is netted out of the payout
     * instead — nothing is separately collected) or when `serviceType !==
     * "RECEIVE"`. Omitted, with `f > 0`, falls back to the legacy single
     * implicit leg on the collapsed cashout method (unchanged behavior).
     * Σ(feePayments) must equal `f` — enforced by a SECOND `reconcileLegs`
     * hard-reject in the repository, same ±$0.05 epsilon as the payout
     * reconcile. Mirrored in `electron-app/schemas/index.ts`'s
     * `FinancialServiceSchema` (rule-14 debt — that file's own LOCAL-
     * duplicate fields, e.g. `kept_change_usd`/`checkoutTotal`, document the
     * same trap: both copies must carry the field or the desktop IPC path
     * silently strips it).
     */
    feePayments: z
      .array(
        z.object({
          method: z.string(),
          currencyCode: z.string(),
          amount: z.number().positive(),
        }),
      )
      .optional(),
    /** PFT-3b (Partner FOR-Transactions): when partnerMode === "FOR" the
     * transaction is done ON THE PARTNER'S BEHALF — no walk-in customer, no
     * counter cash; the full amount books to partner_ledger (see the
     * repository's FOR-partner dispatch). "THROUGH" keeps the legacy
     * secondary-system semantics. */
    partnerId: z.number().int().positive().optional(),
    partnerMode: z.enum(["THROUGH", "FOR"]).optional(),
    /**
     * Cashout method for RECEIVE transactions: how the shop pays the customer.
     * - CASH (default): debit General drawer
     * - CUSTOMER_ACCOUNT: credit client's account (debt_ledger credit)
     */
    cashoutMethod: z
      .enum(["CASH", "CUSTOMER_ACCOUNT", "OMT", "WHISH", "BINANCE"])
      .optional()
      .default("CASH"),
    // T3 keep-change (KC-4): kept change per currency → profit stamp.
    kept_change_usd: z.number().nonnegative().optional(),
    kept_change_lbp: z.number().nonnegative().optional(),
    transaction_time: transactionTimeSchema,
    /**
     * Payment-Legs Integrity plan (Wave 8, owner decision 2026-07-18): the
     * bills/catalog cart flow (KatchForm / FinancialForm) submits ONE
     * legs-carrying CARRIER transaction per checkout — every other unit in
     * the same cart submits `deferPayment: true` and carries no legs (see
     * docs/plans/done_plans/CARRIER_LEGS_VOID_ASYMMETRY.md). The carrier's
     * own `price` is only ONE unit's share of the cart, so reconciling legs
     * against `price` alone would hard-reject every legitimate multi-unit
     * checkout. `checkoutTotal` is the FULL amount the customer owes for the
     * entire checkout, split by the currencies the cart was denominated in.
     * When present alongside `payments`, the repository reconciles the legs
     * against `checkoutTotal` instead of `price` (S2's hard-reject
     * invariant, applied to the right total). Omitted → unchecked legacy
     * behavior (single-unit checkouts, scripted callers).
     */
    checkoutTotal: z
      .object({
        usd: z.number().min(0),
        lbp: z.number().min(0),
      })
      .optional(),
    /**
     * Payment-Legs Integrity plan: the USD→LBP rate MultiPaymentInput
     * actually converted the customer's TENDER at (may be the buy rate —
     * see the owner's 2026-07-06 MPI-buy-rate decision — while the
     * transaction's stamped rate-of-record is sell-side for money-in
     * flows). When present, leg reconciliation compares at THIS rate
     * instead of the stamped one, so a legitimate buy/sell-spread checkout
     * doesn't false-reject (lira-095). Omitted → unaffected legacy
     * behavior.
     */
    tender_exchange_rate: z.number().positive().optional(),
    /**
     * CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): identifies which
     * multi-unit split checkout this unit belongs to — sent with EVERY unit
     * (carrier and siblings alike) by KatchForm/FinancialForm. Omitted on
     * single-unit checkouts. Keep in sync with the LOCAL duplicate in
     * electron-app/schemas/index.ts's FinancialServiceSchema (rule-14 debt,
     * same trap as checkoutTotal/deferPayment above).
     */
    split_group: z.string().uuid().optional(),
    split_role: z.enum(["carrier", "sibling"]).optional(),
    split_units: z.number().int().min(2).optional(),
    /**
     * LIRA-090 §2/§5.1: the catalog item (`mobile_service_items.id`) this
     * cost/price line is selling. Presence of this field is itself the
     * "this line is an Only-Days telecom sale" signal. Drives the computed
     * `returnedCreditsUsd` default and the primary carrier-line movement.
     * Keep in sync with `CreateFinancialServiceData.mobileServiceItemId`
     * (rule 14 — one definition per predicate).
     */
    mobileServiceItemId: z.number().int().positive().optional(),
    /**
     * LIRA-090 §2.2: operator override for the USD credit amount returned to
     * the shop's carrier line. When omitted and the item's split is complete,
     * the repository computes the default via `maxReturnableCredits`.
     */
    returnedCreditsUsd: z.number().nonnegative().optional(),
    /**
     * LIRA-090 §6.2: per-line returned-credits array for walk-in aggregated
     * cart transactions. Each entry is one Only-Days catalog line in the cart.
     * Use when a single `financial_services` row represents multiple catalog
     * lines (aggregated cart total).
     */
    telecomCreditReturns: z
      .array(
        z.object({
          itemCategory: z.string().optional(),
          mobileServiceItemId: z.number().int().positive().optional(),
          returnedCreditsUsd: z.number().nonnegative().optional(),
        }),
      )
      .optional(),
  })
  .refine(
    (data) => {
      if (data.paidByMethod === "CUSTOMER_ACCOUNT" && !data.clientId) {
        return false;
      }
      return true;
    },
    {
      message: "Client is required when paying by Customer Account",
      path: ["clientId"],
    },
  )
  .refine((data) => !(data.partnerMode === "FOR" && !data.partnerId), {
    message: 'partnerId is required when partnerMode is "FOR"',
    path: ["partnerId"],
  })
  .refine(
    (data) =>
      data.partnerMode !== "FOR" || data.paidByMethod !== "CUSTOMER_ACCOUNT",
    {
      // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 slice 2: mirrors
      // validators/customService.ts's identical refine (added in slice 1)
      // and the new one in validators/recharge.ts (this slice). Under
      // partnerMode "FOR" there is no customer owing — the PARTNER owes —
      // so CUSTOMER_ACCOUNT is never a valid paidByMethod here. This is the
      // edge (Zod) half of rule 19; the repository-layer rejection
      // (`assertNoCounterPayment` in moneyPosting.ts, wired via
      // FinancialServiceRepository.ts's `paidBy` local) is the real,
      // transport-agnostic enforcement point and holds regardless of
      // whether a caller reaches this schema.
      message:
        "paidByMethod cannot be Customer Account on a for-partner financial service — there is no customer owing, the partner owes",
      path: ["paidByMethod"],
    },
  )
  .refine(
    (data) =>
      data.partnerMode !== "FOR" || data.cashoutMethod !== "CUSTOMER_ACCOUNT",
    {
      // Same rule, RECEIVE's own legacy field (`cashoutMethod`, not
      // `paidByMethod`) — see the `paidByMethod` refine above for the full
      // rationale.
      message:
        "cashoutMethod cannot be Customer Account on a for-partner financial service — there is no customer owing, the partner owes",
      path: ["cashoutMethod"],
    },
  )
  .refine(
    (data) => {
      // For OMT services (except OMT_WALLET and ONLINE_BROKERAGE), omtFee is optional
      // when the service type has a fee lookup table (INTRA, WESTERN_UNION).
      // For other service types (CASH_TO_BUSINESS, CASH_TO_GOV, OMT_CARD, OGERO_MECANIQUE),
      // the fee must be entered manually.
      const hasFeeLookupTable =
        data.omtServiceType === "INTRA" ||
        data.omtServiceType === "WESTERN_UNION";

      if (
        data.provider === "OMT" &&
        data.omtServiceType &&
        data.omtServiceType !== "OMT_WALLET" &&
        data.omtServiceType !== "ONLINE_BROKERAGE" &&
        !hasFeeLookupTable &&
        !data.omtFee
      ) {
        return false;
      }
      return true;
    },
    {
      message: "OMT fee is required for this service type",
      path: ["omtFee"],
    },
  )
  .refine(
    (data) => {
      // For BINANCE with payFee=true, omtServiceType is required to calculate fee
      if (data.provider === "BINANCE" && data.payFee && !data.omtServiceType) {
        return false;
      }
      return true;
    },
    {
      message: "Service type is required when charging fee",
      path: ["omtServiceType"],
    },
  )
  .refine(
    (data) => {
      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.4: feePayments is fee-on-top
      // RECEIVE only. `includingFees: true` nets the fee out of the payout
      // instead — there is nothing left for a separate fee leg to collect.
      if (
        data.feePayments &&
        data.feePayments.length > 0 &&
        data.includingFees === true
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        "feePayments is only valid when includingFees is false (fee-on-top RECEIVE) — a fee-included transaction nets the fee out of the payout instead of collecting it separately",
      path: ["feePayments"],
    },
  )
  .refine(
    (data) => {
      if (
        data.feePayments &&
        data.feePayments.length > 0 &&
        data.serviceType !== "RECEIVE"
      ) {
        return false;
      }
      return true;
    },
    {
      message: "feePayments is only valid on serviceType RECEIVE",
      path: ["feePayments"],
    },
  )
  .refine(
    (data) => {
      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §6bis finding 1: a partner
      // transaction (FOR or THROUGH) has no walk-in fee to collect — FOR
      // never reads feePayments at all (PFT-3b dispatch), THROUGH suppresses
      // the fee leg via skipSystemDrawer — both used to silently drop the
      // field. Reject either mode up front.
      if (data.feePayments && data.feePayments.length > 0 && data.partnerId) {
        return false;
      }
      return true;
    },
    {
      message:
        "feePayments cannot be used on a partner transaction — the partner handles the fee",
      path: ["feePayments"],
    },
  )
  .refine(
    (data) => {
      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §6bis finding 2: the resolved
      // provider fee must actually be > 0 — legs against a zero/omitted fee
      // used to be silently dropped by the repository's inner gate
      // (`receiveFeeAmt > 0`) with no reconcile and no booking.
      // §10.2: BINANCE has no `omtFee`/`whishFee` field of its own — its
      // customer-facing fee travels in `commission` (verified against the
      // live frontend contract, `CryptoForm.tsx`'s `commission: fee`, which
      // never populates omtFee/whishFee for Binance). Mirrors the identical
      // BINANCE branch on the repository's `feePresenceSource`
      // (`FinancialServiceRepository.ts`) — one fee resolution, two
      // consumers (rule 14).
      if (
        data.feePayments &&
        data.feePayments.length > 0 &&
        (data.omtFee ?? 0) <= 0 &&
        (data.whishFee ?? 0) <= 0 &&
        !(data.provider === "BINANCE" && (data.commission ?? 0) > 0)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        "feePayments requires a non-zero omtFee/whishFee/commission — there is no fee to collect",
      path: ["feePayments"],
    },
  );

// Query financial services history
export const getFinancialServicesSchema = z.object({
  provider: providerCodeSchema.optional(),
  limit: z.coerce.number().int().positive().max(1000).default(50),
});

export type CreateFinancialServiceInput = z.infer<
  typeof createFinancialServiceSchema
>;
export type GetFinancialServicesInput = z.infer<
  typeof getFinancialServicesSchema
>;

/**
 * Self-charge validation schema (LIRA-090 spec §5.2).
 *
 * Charges a telecom catalog item to the shop's OWN carrier line rather than
 * a customer. The `mobileServiceItemId` is the only required field — the
 * repository resolves the carrier's primary line from the item's provider
 * when `carrierLineId` is omitted (spec §3 decision 8, overridable per call).
 *
 * Shared by the IPC handler and the REST route (`/api/services/self-charge`)
 * per rule 14/19.
 */
export const selfChargeTelecomItemSchema = z.object({
  /** The catalog item (`mobile_service_items.id`) being self-charged. */
  mobileServiceItemId: z.number().int().positive(),
  /** Target carrier line. Defaults to the item carrier's primary line when
   *  omitted. */
  carrierLineId: z.number().int().positive().optional(),
  transaction_time: transactionTimeSchema,
});

export type SelfChargeTelecomItemInput = z.infer<
  typeof selfChargeTelecomItemSchema
>;
