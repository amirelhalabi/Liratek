import { z } from "zod";
import { TRANSACTION_TYPES, type TransactionType } from "../constants/transactionTypes.js";
import {
  clientDayInputSchema,
  refundExchangeRateSchema,
  refundExchangeRateQuerySchema,
} from "./common.js";

/**
 * Transaction-level (unified journal) validation schemas.
 *
 * CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): a multi-unit split checkout
 * (KatchForm bills / FinancialForm catalog units) books ALL of its payment
 * legs against exactly one "carrier" transaction; every other unit ("sibling")
 * defers its own cost/commission only. Voiding a single member alone would
 * leave the checkout's money non-zero across drawers/debt_ledger/profit, so
 * the generic void/refund path blocks it — `voidCheckoutGroup` is the only
 * legitimate way to reverse one, voiding every non-voided member in ONE
 * transaction. Shared by BOTH transports (IPC body / REST params) — rule 14.
 */
export const voidCheckoutGroupSchema = z.object({
  groupId: z.string().uuid("groupId must be a valid uuid"),
});

export type VoidCheckoutGroupInput = z.infer<typeof voidCheckoutGroupSchema>;

/**
 * LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C) — the session-basket
 * analog of `voidCheckoutGroupSchema` above: reverses every item in a
 * customer-session basket (plus its pooled cash leg(s) and pooled debt) in
 * ONE db transaction, replacing the "Basket item — see admin to reverse"
 * dead end. `TransactionRepository.voidSessionBasket`/`refundSessionBasket`
 * are the only legitimate way to reverse a session-linked row — a bare
 * void/refund on one is refused by `_assertReversible`. Shared by BOTH
 * transports (IPC body / REST body) — rule 14.
 */
export const sessionBasketReversalSchema = z.object({
  sessionId: z.number().int().positive(),
});

export type SessionBasketReversalInput = z.infer<
  typeof sessionBasketReversalSchema
>;

/**
 * REST path-param variant of `sessionBasketReversalSchema` above — same
 * `z.coerce` pattern as `saleIdParamSchema`/`productUnitIdSchema`
 * (validators/sale.ts, validators/productUnit.ts): a URL param is ALWAYS a
 * string ("7", never 7), so the plain `z.number()` schema above rejects
 * every request through `validateParams`. Used by
 * `POST /session-basket/:sessionId/void` and `.../refund` (rule 19c —
 * routed through `validateParams` so a bad id answers the SAME HTTP 200
 * `{ success: false, error }` envelope every other validation failure on
 * these routes does, instead of the old manual 400).
 */
export const sessionBasketSessionIdParamSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
});
export type SessionBasketSessionIdParamInput = z.infer<
  typeof sessionBasketSessionIdParamSchema
>;

/**
 * LIRA-078 — refund tender-selection modal, method-override-only contract.
 * A single operator-chosen return leg: the drawer method that gives the
 * customer's money back, per currency. `currencyCode` is restricted to
 * USD/LBP — cross-currency refunds are explicitly out of scope (see
 * TransactionRepository.refundTransaction's money-contract doc); `amount` is
 * validated against the original transaction's own net customer-facing total
 * for that currency by the repository (not here — Zod only shapes the
 * payload, the repository owns the money-correctness check, rule 14: one
 * validation predicate).
 *
 * Shared by BOTH transports (IPC positional arg / REST body field).
 */
export const refundLegSchema = z.object({
  method: z.string().min(1, "method is required"),
  currencyCode: z.enum(["USD", "LBP"]),
  amount: z.number().positive("amount must be greater than 0"),
});

/** At least one leg — an empty override array is meaningless (the caller
 *  should omit `refundLegs` entirely for the default-reversal path). */
export const refundLegsSchema = z.array(refundLegSchema).min(1);

export type RefundLegInput = z.infer<typeof refundLegSchema>;
export type RefundLegsInput = z.infer<typeof refundLegsSchema>;

/** YYYY-MM-DD only — same shape `addMonthsIso`/`sale_items.warranty_until`
 *  use, deliberately narrower than `transactionTimeSchema`'s full ISO
 *  datetime (a warranty override is a calendar day, not a moment). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDateSchema = z
  .string()
  .regex(ISO_DATE_RE, "must be a date in YYYY-MM-DD format")
  .refine((v) => !Number.isNaN(Date.parse(v)), "must be a valid calendar date");

/**
 * LIRA-143 phase 4/5 — the phone-refund UI's per-unit flag override, riding
 * alongside `refundLegs` on the SAME `refundTransaction` call (rule 16: one
 * IPC payload, no follow-up call). `unit_id` must belong to the sale being
 * refunded — the repository (`TransactionRepository._validateRefundUnitExtras`)
 * is what checks that, not Zod (rule 14: one money-correctness predicate,
 * kept in the repository layer; Zod only shapes the payload). `is_defective`
 * omitted/`undefined` leaves the unit's existing flag untouched (matches
 * `ProductUnitRepository.markInStock`'s option semantics); same for
 * `warranty_override_until`, where an explicit `null` clears any existing
 * override.
 */
export const refundUnitExtraSchema = z.object({
  unit_id: z.number().int().positive(),
  is_defective: z.boolean().optional(),
  warranty_override_until: isoDateSchema.nullable().optional(),
});

/** At least one extra — an empty array is meaningless (omit `refundUnitExtras`
 *  entirely for a plain flip-back-to-stock refund with no flags). */
export const refundUnitExtrasSchema = z.array(refundUnitExtraSchema).min(1);

/**
 * Owner decision 2026-10-07 — refund kept change. The ONE shape both refund
 * payloads use (rule 14): spread flat into `sessionItemRefundSchema`, and
 * as its own object (`refundKeptChangeSchema`) for `transactions:refund`,
 * whose IPC channel takes positional arguments (same pattern as
 * `refundUnitExtrasSchema`). Non-negative amounts only; whether the claim
 * is real is the repository's call (`resolveKeptChange`), never Zod's.
 */
const refundKeptChangeFields = {
  kept_change_usd: z.number().nonnegative().finite().optional(),
  kept_change_lbp: z.number().nonnegative().finite().optional(),
};
export const refundKeptChangeSchema = z.object(refundKeptChangeFields);

/**
 * The transaction types whose refund may keep change — the ONE list the
 * repository gate (`TransactionRepository._resolveRefundKeptChange`) and
 * the refund popup both read (rule 14). Kept profit lives in the REFUND
 * row's own profit stamp (−original profit + kept), so the generic refund
 * negates it with everything else. Two groups, by how the Profits page
 * reaches that kept part:
 *   - {@link REFUND_KEPT_CHANGE_STAMP_NETTED_TYPES}: the page sums the
 *     REFUND row's whole stamp next to the original's — sales
 *     (`getSalesProfit`: SALE + REFUND) and debt repayments
 *     (`keptChangeSource`: DEBT_REPAYMENT + REFUND) — so the kept part
 *     shows by itself.
 *   - {@link REFUND_KEPT_CHANGE_MODULE_TYPES} (LIRA-272, owner decision
 *     2026-10-07: refunds of ALL modules may keep a leftover): the page
 *     drops a refunded original entirely and never sums its REFUND row, so
 *     the refund stamps the kept part separately
 *     ({@link REFUND_KEPT_CHANGE_META}) and the Profits page reads exactly
 *     that (`ProfitRepository.getRefundKeptChangeProfit`).
 * A new type must join exactly one group, or its kept profit is invisible.
 */
export const REFUND_KEPT_CHANGE_STAMP_NETTED_TYPES: readonly string[] = [
  "SALE",
  "DEBT_REPAYMENT",
];
/** @see REFUND_KEPT_CHANGE_TYPES — the modules whose refunded original the
 *  Profits page drops, and whose refund kept change it reads off
 *  {@link REFUND_KEPT_CHANGE_META}. */
export const REFUND_KEPT_CHANGE_MODULE_TYPES: readonly string[] = [
  "FINANCIAL_SERVICE",
  "RECHARGE",
  "CUSTOM_SERVICE",
  "MAINTENANCE",
  "LOTO",
];
export const REFUND_KEPT_CHANGE_TYPES: readonly string[] = [
  ...REFUND_KEPT_CHANGE_STAMP_NETTED_TYPES,
  ...REFUND_KEPT_CHANGE_MODULE_TYPES,
];
/**
 * LIRA-272 — the REFUND row's `metadata_json` keys holding the change that
 * refund kept, written ONLY by the refund itself
 * (`TransactionRepository._createRefundRow`). A dedicated name, never
 * `kept_change_usd/lbp`: a REFUND row starts from a copy of the original's
 * metadata, and several originals record their OWN sale-time kept change
 * under those names — reading them would surface the original's old kept
 * change as refund profit.
 */
export const REFUND_KEPT_CHANGE_META = {
  usd: "refund_kept_change_usd",
  lbp: "refund_kept_change_lbp",
} as const;
export type RefundKeptChangeInput = z.input<typeof refundKeptChangeSchema>;

export type RefundUnitExtraInput = z.infer<typeof refundUnitExtraSchema>;
export type RefundUnitExtrasInput = z.infer<typeof refundUnitExtrasSchema>;

/**
 * LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) —
 * `TransactionRepository.refundSessionBasketItem`'s payload, shared by BOTH
 * transports (IPC body / REST body) — rule 14. `sessionId` is
 * `z.coerce.number()` because the REST route reads it off the URL
 * (`/session-basket/:sessionId/items/refund`, always a string there); the
 * IPC caller always sends a real number, and coercing a number is a no-op.
 * `refundLegs` reuses `refundLegSchema`/`refundLegsSchema` (LIRA-078) rather
 * than a second copy (rule 14) — same per-leg shape, same validation, same
 * repository-side amount check. `clientDay` reuses the one shared
 * client-day fragment (`clientDayInputSchema`, rule 27) — nothing in this
 * flow currently reads the clock, but a future caller can supply it without
 * a schema change. `saleItemId`/`quantity` are optional together: a SALE
 * member with `saleItemId` omitted refunds every remaining line in one
 * operation (owner answer Q2); `quantity` must be a positive integer when
 * present — the repository owns the "not more than what's left" check
 * (rule 14: one money-correctness predicate).
 */
export const sessionItemRefundSchema = z
  .object({
    sessionId: z.coerce.number().int().positive(),
    transactionId: z.number().int().positive(),
    saleItemId: z.number().int().positive().optional(),
    quantity: z.number().int().positive().optional(),
    refundLegs: refundLegsSchema.optional(),
    // 2026-09-26 owner decision (adversarial-review NEW API CONTRACT) — the
    // SAME "Returned phones" defective/warranty override `refundSaleItem`
    // accepts (`refundUnitExtrasSchema`, rule 14 — one schema, not a second
    // copy). A no-op for a non-SALE member; validated against THIS line's own
    // linked unit(s) by the repository (`validateRefundUnitExtras`), never here.
    unitExtras: refundUnitExtrasSchema.optional(),
    clientDay: clientDayInputSchema,
    // LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §3/§4) — the cashier-typed
    // exchange rate: drives BOTH the account-first cross-currency step and
    // `refundLegs`' value-based validation. Omitted: the refunded member's
    // own booked rate, else the day's fallback.
    exchangeRate: refundExchangeRateSchema,
    // Owner decision 2026-10-07 — refund kept change: the cash handed back
    // (`refundLegs`) is short of the remainder by a small leftover the shop
    // keeps as profit. Zod only shapes it; the repository checks it
    // (`resolveKeptChange`, payer "payout": cap, currency, real shortfall).
    ...refundKeptChangeFields,
  })
  // Round-2 finding #10a (LOW) — `saleItemId` and `quantity` must be given
  // TOGETHER or BOTH omitted. Omitting BOTH is Q2 ("every remaining line, in
  // ONE operation" — owner answer). `quantity` given ALONE used to be
  // silently ignored by that same Q2 branch (it never reads `quantity` at
  // all when `saleItemId` is absent) — the caller asked to refund N units of
  // ONE line and the whole sale's remaining lines were refunded instead.
  // `saleItemId` given alone was already refused deep inside the repository
  // ("quantity is required..."); refusing it here too, at the schema, is the
  // SAME rule moved to the one shared boundary (rule 14).
  .refine((data) => (data.saleItemId == null) === (data.quantity == null), {
    message: "saleItemId and quantity must be given together, or both omitted",
    path: ["quantity"],
  });

export type SessionItemRefundInput = z.infer<typeof sessionItemRefundSchema>;

/**
 * LIRA-232 phase 2 — read-only preview query for
 * `TransactionService.getSessionItemRefundPreview`/`TransactionRepository
 * .getSessionItemRefundPreview`. Mirrors `saleRefundPreviewSchema`'s shape
 * (LIRA-231, `validators/sale.ts`) — a query, not a write, so every field
 * (including `sessionId`/`transactionId`, which the write schema above
 * treats differently) is `z.coerce.number()`: the REST route reads ALL of
 * them off query-string params (`?transactionId=&saleItemId=&quantity=`),
 * which arrive as strings; the IPC caller sends real numbers, and coercing
 * a number is a no-op. No `refundLegs`/`clientDay` — a preview computes the
 * default proportional legs itself and reads nothing time-dependent.
 */
export const sessionItemRefundPreviewSchema = z
  .object({
    sessionId: z.coerce.number().int().positive(),
    transactionId: z.coerce.number().int().positive(),
    saleItemId: z.coerce.number().int().positive().optional(),
    quantity: z.coerce.number().int().positive().optional(),
    // LIRA-236, contract item 3 — the preview also accepts a typed rate, so
    // the account reduction/remainder shown reflect it. Coordinator
    // follow-up (2026-09-28, rule 14 dedup) — `refundExchangeRateQuerySchema`
    // (validators/common.ts) is the ONE query-string variant of the shared
    // exchange-rate rule, instead of a second hand-written
    // `z.coerce.number().positive().finite()` copy that had silently
    // dropped the base schema's `.nullish()` null-handling.
    exchangeRate: refundExchangeRateQuerySchema,
  })
  // Round-2 finding #10a — same pairing rule as `sessionItemRefundSchema`
  // above (rule 14's spirit — one rule, both callers), so the preview never
  // silently answers a different question than the write it's previewing.
  .refine((data) => (data.saleItemId == null) === (data.quantity == null), {
    message: "saleItemId and quantity must be given together, or both omitted",
    path: ["quantity"],
  });

export type SessionItemRefundPreviewInput = z.infer<
  typeof sessionItemRefundPreviewSchema
>;

/**
 * Transactions page multi-select Type filter (TransactionRepository.getRecent
 * `typeFilters`). One (type, provider, service_type, has_item_key) tuple per
 * selected FILTER_GROUPS option; the repository OR's the tuples together as
 * one group, ANDed with every other filter (date range, search,
 * excludeTypes, …) — see the long comment on `TransactionFilters.typeFilters`.
 *
 * Shared by BOTH transports: IPC passes the array straight through
 * (structured-clone survives plain objects, so `electron.d.ts`/preload widen
 * to `Record<string, unknown>` and no validation is needed there beyond the
 * existing handler). REST can't — query strings are text — so the web
 * adapter (`backendApi.ts`) JSON-encodes the array into one `typeFilters`
 * query param, and this is what the route (`backend/src/api/transactions.ts`)
 * parses it back into. `type` is restricted to the real transaction-type
 * enum (values end up in `json_extract(...) = ?` placeholders either way, so
 * this isn't for SQL-injection safety — it's to fail loudly on a garbled
 * client payload rather than silently returning zero rows).
 */
const transactionTypeValues = Object.values(TRANSACTION_TYPES) as [
  TransactionType,
  ...TransactionType[],
];

export const transactionTypeFilterSchema = z.object({
  type: z.enum(transactionTypeValues).optional(),
  provider: z.string().min(1).optional(),
  service_type: z.string().min(1).optional(),
  has_item_key: z.boolean().optional(),
});

/** Capped well above FILTER_GROUPS' real option count — a defensive bound,
 *  not a real-world limit. */
export const transactionTypeFiltersSchema = z
  .array(transactionTypeFilterSchema)
  .max(50);

export type TransactionTypeFilterInput = z.infer<
  typeof transactionTypeFilterSchema
>;
export type TransactionTypeFiltersInput = z.infer<
  typeof transactionTypeFiltersSchema
>;
