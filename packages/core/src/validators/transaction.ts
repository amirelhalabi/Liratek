import { z } from "zod";
import { TRANSACTION_TYPES, type TransactionType } from "../constants/transactionTypes.js";

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

export type RefundUnitExtraInput = z.infer<typeof refundUnitExtraSchema>;
export type RefundUnitExtrasInput = z.infer<typeof refundUnitExtrasSchema>;

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
