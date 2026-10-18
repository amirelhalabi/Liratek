import { z } from "zod";
import { OMT_SERVICE_TYPES } from "../utils/omtFees.js";
import {
  positiveDecimalSchema,
  currencyCodeSchema,
  transactionTimeSchema,
  historyAllQuerySchema,
  extraChargeFields,
  roundingGivenFields,
  hasExtraCharge,
  NO_EXTRA_FOR_PARTNER_MESSAGE,
  EXTRA_ON_SESSION_ITEM_MESSAGE,
} from "./common.js";
import { customerPaymentsField } from "./customerLegs.js";

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

/**
 * D1 (OWNER_NOTES_2026-09-21.md §2b, case matrix row 1 AND row 5, owner
 * decision 2026-09-25): "neither OMT system nor OMT App takes a fee from the
 * customer on RECEIVE." `FinancialServiceRepository.createTransaction` has
 * always been the AUTHORITATIVE enforcement of this (hard-rejects a
 * customer-facing fee on an OMT/OMT_APP RECEIVE, unconditionally, before
 * every dispatch branch — see its own D1-cutover comment). This is the exact
 * same message, reused (rule 14) rather than retyped, for BOTH providers, so
 * every layer speaks with one voice.
 *
 * The two providers trigger this on different fields — OMT's customer-facing
 * fee lives in `omtFee`/`includingFees`/`feePayments`; OMT_APP's lives in
 * `commission` (its fee travels there, not `omtFee`) as well as
 * `includingFees`/`feePayments` — so the wording deliberately does not name
 * a specific field, only "the fee amount, includingFees, and feePayments".
 *
 * Rule 23 lesson applied in advance: this schema ALSO carries pre-existing
 * `.refine()`s that reject `feePayments` for narrower reasons (attached to a
 * partner, or a zero/omitted fee) — reasons that, for every OTHER provider,
 * are still the right diagnosis. For an OMT/OMT_APP RECEIVE they are no
 * longer even reachable (D1 rejects it regardless of partner/magnitude), but
 * because Zod evaluates every `.refine()` and a caller only ever sees ONE
 * message (`validateRequest`/`validatePayload` surface the FIRST issue — see
 * their own comments), the message the operator sees depends on refine
 * ORDER: the D1 refine below is deliberately the FIRST one chained onto
 * `.object()` — keep it first if another refine is ever added ahead of it —
 * so its issue sorts first and wins, while the later partner/zero-fee
 * refines keep firing — and keep being the right answer — for every other
 * case.
 */
/** LIRA-319 — an extra is only for money the customer pays; a RECEIVE is a
 *  payout (the shop pays), so it never takes one (FR-011). */
export const NO_EXTRA_ON_PAYOUT_MESSAGE =
  "No extra on a payout — the shop is paying, not being paid.";

export const OMT_RECEIVE_NO_FEE_MESSAGE =
  "OMT RECEIVE never takes a fee from the customer — any provider fee is shown for the commission calculation only, never collected or deducted. Remove the fee amount, includingFees, and feePayments, then resubmit.";

/**
 * LIRA-321 — "Customer pays" lines on a payout (specs/321-customer-pays-in-
 * side/contracts/write-payloads.md). One wording per refusal, shared by this
 * schema and the repository's own authoritative guards (rule 14).
 */
export const CUSTOMER_PAYMENTS_PROVIDERS: readonly string[] = [
  "WHISH_APP",
  "OMT_APP",
  "BINANCE",
];
export const CUSTOMER_PAYMENTS_ONLY_ON_APP_RECEIVE_MESSAGE =
  "customerPayments is only for a Whish App, OMT App or Binance cash-out (RECEIVE).";
export const CUSTOMER_PAYMENTS_WITH_FEE_PAYMENTS_MESSAGE =
  "customerPayments already holds the fee line — do not send feePayments with it.";
export const CUSTOMER_PAYMENTS_PARTNER_MESSAGE =
  "customerPayments cannot be used on a partner transaction — there is no walk-in customer paying.";
export const CUSTOMER_PAYMENTS_SESSION_MESSAGE =
  "customerPayments is not supported in a session basket — the basket checkout collects the payment.";
export const CUSTOMER_PAYMENTS_REQUIRED_MESSAGE =
  "customer_waived_amount and feeCollectedSeparately need customerPayments.";
export const CUSTOMER_PAYMENTS_FEE_MODE_MESSAGE =
  "feeCollectedSeparately cannot be used with includingFees — the fee is either paid separately or deducted from the payout, not both.";

/** True when a payload carries at least one "Customer pays" line. */
export function hasCustomerPayments(data: {
  customerPayments?: ReadonlyArray<unknown> | null;
}): boolean {
  return !!data.customerPayments && data.customerPayments.length > 0;
}

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
    // Both parties of a transfer (the OMT/Whish Services page sends them next
    // to clientName/phoneNumber; the repository stores them in
    // financial_services.sender_* / receiver_*). LIRA-297: only the desktop
    // LOCAL schema declared them, so the web stripped them and never recorded
    // the other party (rule 23). Same limits as clientName/phoneNumber/clientId.
    senderName: z.string().max(255).optional(),
    senderPhone: z.string().max(30).optional(),
    receiverName: z.string().max(255).optional(),
    receiverPhone: z.string().max(30).optional(),
    senderClientId: z.number().int().positive().optional(),
    receiverClientId: z.number().int().positive().optional(),
    // Shop-day 2026-10-16: the Services page's "Save as client" choice.
    // `false` = do not create a client from the name + phone (an existing
    // client with that phone is still linked). Absent = the old behaviour
    // (auto-create), for every caller that never offered the choice. No
    // `.default()` on purpose (rule 22): absent must stay distinguishable.
    saveAsClient: z.boolean().optional(),
    // LIRA-256 — the ONE type list (rule 14), not an inline copy.
    omtServiceType: z.enum(OMT_SERVICE_TYPES).optional(),
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
    // LIRA-334 — payout round-up (handed more than owed).
    ...roundingGivenFields,
    // LIRA-319: the extra the cashier added on top of what the customer
    // owes (OMT/Whish send, Katsh/catalog cart carrier, crypto send, app
    // transfer). Its own field — never folded into amount/price/fee/
    // commission, so the provider fee, the commission and the supplier/
    // partner ledgers stay exactly as without it. Optional, no default
    // (offline replay, research R4). `checkoutTotal` stays the PRE-extra
    // total; the repository adds the extra to every total it reconciles.
    ...extraChargeFields,
    // LIRA-321: every line of the "Customer pays" section on a Whish App /
    // OMT App / Binance cash-out (transfer and fee lines alike), plus the
    // forgiven part. Replaces the single provider inflow row; the payout
    // (`payments`, `cashoutMethod`, kept change) is unchanged. Balance rules
    // (no overpay; a shortfall only on the client's account or a capped
    // forgive) are the repository's (`bookCustomerLegs`).
    ...customerPaymentsField,
    /**
     * LIRA-321: with `customerPayments`, says the customer pays the fee over
     * the counter (mode C — the fee is one of the lines, the payout is the
     * full amount). Before LIRA-321 a non-empty `feePayments` said this; the
     * lines now travel in `customerPayments`, so the mode is stated, never
     * guessed from the lines' total. Same name as `calculateOmtWhishAppFees`'s
     * input. Never on OMT App (D1: no fee).
     */
    feeCollectedSeparately: z.boolean().optional(),
    transaction_time: transactionTimeSchema,
    /**
     * Payment-Legs Integrity plan (Wave 8, owner decision 2026-07-18): the
     * bills/catalog cart flow (KatshForm / FinancialForm) submits ONE
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
     * A multi-unit cart's SIBLING units (every unit but the legs-carrying
     * carrier) and session-basket items submit `deferPayment: true`: book
     * cost + commission only, never the customer's payment (the carrier's
     * legs, or the basket, already cover it). LIRA-297: this key was only in
     * the desktop LOCAL FinancialServiceSchema — the REST route's
     * `validateRequest` stripped it, so on the web every sibling booked its
     * own price into the drawer on top of the carrier's legs (rule 23).
     */
    deferPayment: z.boolean().optional(),
    /**
     * CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): identifies which
     * multi-unit split checkout this unit belongs to — sent with EVERY unit
     * (carrier and siblings alike) by KatshForm/FinancialForm. Omitted on
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
    // ── LIRA-329: informational only ─────────────────────────────────────
    // Kept on the transaction's `details`; no money step reads them (the
    // amounts, commission and legs above stay the only money inputs).
    /** Every line of a combined catalog cart (Katsh / iPick), as picked. */
    catalogItems: z
      .array(
        z.object({
          key: z.string().max(255).optional(),
          category: z.string().max(500).optional(),
          label: z.string().max(500).optional(),
          quantity: z.number().int().positive(),
          unitPrice: z.number().nonnegative().optional(),
          onlyDays: z.boolean().optional(),
          returnedCreditsUsd: z.number().nonnegative().optional(),
        }),
      )
      .optional(),
    /** The discount exactly as typed on the payment sheet (it is already
     *  folded into `amount` / `commission`). */
    typedDiscount: z
      .object({
        amount: z.number().positive(),
        currency: currencyCodeSchema,
      })
      .optional(),
    /** Who pays the provider fee on a wallet / crypto transfer: on top by
     *  the sender, deducted from the amount, or paid separately. */
    feePaidBy: z.enum(["SENDER", "DEDUCTED", "SEPARATELY"]).optional(),
  })
  .refine(
    (data) => {
      // D1 blanket guard — kept FIRST in the chain (see OMT_RECEIVE_NO_FEE_
      // MESSAGE's doc comment above for why order matters here). Mirrors
      // FinancialServiceRepository's own unconditional OMT/OMT_APP RECEIVE
      // guard: `includingFees === true` or a non-empty `feePayments` reject
      // for EITHER provider; OMT_APP additionally rejects a nonzero
      // `commission` (its fee travels there, not `omtFee` — OMT's own
      // `commission` is auto-derived bookkeeping and stays allowed). WHISH/
      // WHISH_APP/BINANCE are untouched — D1 does not apply to them.
      const isOmtSystemReceive =
        data.provider === "OMT" && data.serviceType === "RECEIVE";
      const isOmtAppReceive =
        data.provider === "OMT_APP" && data.serviceType === "RECEIVE";
      if (!isOmtSystemReceive && !isOmtAppReceive) {
        return true;
      }
      const hasFeeCollectionShape =
        data.includingFees === true ||
        (data.feePayments && data.feePayments.length > 0);
      const hasAppWalletFee =
        isOmtAppReceive && Math.abs(data.commission ?? 0) > 0;
      if (hasFeeCollectionShape || hasAppWalletFee) {
        return false;
      }
      return true;
    },
    {
      message: OMT_RECEIVE_NO_FEE_MESSAGE,
      path: ["feePayments"],
    },
  )
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
  )
  // LIRA-319 — where an extra may NOT go (the repository refuses the same,
  // plus the cap and the currency, whatever the caller). A discount on these
  // pages is folded into the price/fee on the client, so "discount or extra,
  // not both" is enforced by the payment box, not here (spec assumptions).
  .refine((data) => data.serviceType !== "RECEIVE" || !hasExtraCharge(data), {
    message: NO_EXTRA_ON_PAYOUT_MESSAGE,
    path: ["extra_usd"],
  })
  .refine((data) => data.partnerMode !== "FOR" || !hasExtraCharge(data), {
    message: NO_EXTRA_FOR_PARTNER_MESSAGE,
    path: ["extra_usd"],
  })
  .refine((data) => data.deferPayment !== true || !hasExtraCharge(data), {
    message: EXTRA_ON_SESSION_ITEM_MESSAGE,
    path: ["extra_usd"],
  })
  // LIRA-321 — where "Customer pays" lines may go. The repository refuses
  // the same (it is the authoritative layer: internal callers skip Zod).
  .refine(
    (data) =>
      !hasCustomerPayments(data) ||
      (data.serviceType === "RECEIVE" &&
        CUSTOMER_PAYMENTS_PROVIDERS.includes(data.provider)),
    {
      message: CUSTOMER_PAYMENTS_ONLY_ON_APP_RECEIVE_MESSAGE,
      path: ["customerPayments"],
    },
  )
  .refine(
    (data) =>
      !hasCustomerPayments(data) ||
      !(data.feePayments && data.feePayments.length > 0),
    {
      message: CUSTOMER_PAYMENTS_WITH_FEE_PAYMENTS_MESSAGE,
      path: ["customerPayments"],
    },
  )
  .refine((data) => !hasCustomerPayments(data) || !data.partnerId, {
    message: CUSTOMER_PAYMENTS_PARTNER_MESSAGE,
    path: ["customerPayments"],
  })
  .refine((data) => !hasCustomerPayments(data) || data.deferPayment !== true, {
    message: CUSTOMER_PAYMENTS_SESSION_MESSAGE,
    path: ["customerPayments"],
  })
  .refine(
    (data) =>
      hasCustomerPayments(data) ||
      (!((data.customer_waived_amount ?? 0) > 0) &&
        data.feeCollectedSeparately !== true),
    {
      message: CUSTOMER_PAYMENTS_REQUIRED_MESSAGE,
      path: ["customerPayments"],
    },
  )
  .refine(
    (data) =>
      !(data.feeCollectedSeparately === true && data.includingFees === true),
    {
      message: CUSTOMER_PAYMENTS_FEE_MODE_MESSAGE,
      path: ["feeCollectedSeparately"],
    },
  )
  .refine(
    (data) =>
      !(
        data.provider === "OMT_APP" &&
        data.serviceType === "RECEIVE" &&
        data.feeCollectedSeparately === true
      ),
    {
      message: OMT_RECEIVE_NO_FEE_MESSAGE,
      path: ["feeCollectedSeparately"],
    },
  );

// Query financial services history
export const getFinancialServicesSchema = z.object({
  provider: providerCodeSchema.optional(),
  limit: z.coerce.number().int().positive().max(1000).default(50),
  all: historyAllQuerySchema,
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
  /**
   * The CLIENT's own local calendar day (`YYYY-MM-DD`, e.g. the frontend's
   * `localDay()`) — fed to the validity-extension projection this movement
   * performs, so the shop's own calendar day decides VALID/GRACE/BURNED
   * classification and the 365-day ceiling instead of the server's (which
   * disagrees on web — Fly runs UTC, the shop is Beirut UTC+3). Optional;
   * falls back to the server's own `localDay()`. See
   * `SelfChargeTelecomItemData.client_day`'s doc for why `transaction_time`
   * cannot substitute for this.
   */
  client_day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
});

export type SelfChargeTelecomItemInput = z.infer<
  typeof selfChargeTelecomItemSchema
>;

/**
 * Edit non-financial metadata on a `financial_services` row — mirrors the
 * `financial:update-metadata` IPC handler's own inline shape
 * (electron-app/handlers/omtHandlers.ts), which validates nothing beyond
 * `requireRole`. Shared by the REST route (rule 14).
 *
 * TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3: the three phone fields
 * were originally capped at 30 — narrower than every sibling phone field in
 * this codebase (`customService.ts`'s `phone_number`, `recharge.ts`'s
 * `phone_number`, both `max(50)`) with no DB column length (`phone_number`/
 * `sender_phone`/`receiver_phone` are all bare SQLite TEXT) or UI `maxLength`
 * backing the narrower number. Raised to 50 to match the rest of the
 * codebase rather than leave this one channel likelier to reject a
 * legitimately-formatted phone number (country code, spaces, extension).
 */
export const financialUpdateMetadataSchema = z.object({
  id: z.number().int().positive(),
  client_name: z.string().max(255).optional(),
  phone_number: z.string().max(50).optional(),
  sender_name: z.string().max(255).optional(),
  sender_phone: z.string().max(50).optional(),
  receiver_name: z.string().max(255).optional(),
  receiver_phone: z.string().max(50).optional(),
  note: z.string().max(500).optional(),
});

export type FinancialUpdateMetadataInput = z.infer<
  typeof financialUpdateMetadataSchema
>;

// LIRA-297 (rule 21) — what a caller SENDS: `z.input`, so `.default()`
// fields stay optional. The adapters (backendApi.ts, ElectronApiAdapter.ts,
// packages/ui ApiAdapter) type their payloads with these, never with a
// hand-copied object literal.
export type CreateFinancialServicePayload = z.input<
  typeof createFinancialServiceSchema
>;
export type FinancialUpdateMetadataPayload = z.input<
  typeof financialUpdateMetadataSchema
>;
export type SelfChargeTelecomItemPayload = z.input<
  typeof selfChargeTelecomItemSchema
>;
