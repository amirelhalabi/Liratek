import { z } from "zod";

/**
 * Counterparty transaction metadata contract (CQ-8,
 * docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md "Extension
 * (2026-07-18)").
 *
 * Every counterparty money transaction — client repayment/credit cash-in-out,
 * supplier payment/settlement, partner settlement/payment — stamps ONE
 * additional, namespaced `counterparty` object into its
 * `transactions.metadata_json`. This is ADDITIVE to whatever flow-specific
 * keys each write site already writes (`paid_by`, `legs`, `supplier_id`,
 * `direction`, `entry_type`, `partner_id`, `settlement_method`, `is_credit`
 * all stay exactly as-is — this schema does not replace or rename them).
 *
 * `discount` (CQ-10): populated when a settlement bundles a forgiven amount,
 * or by a standalone write-off's own COUNTERPARTY_DISCOUNT row — see
 * `counterpartyDiscountInputSchema` below for the input-validation side.
 */

export const counterpartyDiscountSchema = z.object({
  amount_usd: z.number(),
  amount_lbp: z.number(),
  reason: z.string().optional(),
});

export const counterpartyKindSchema = z.enum(["client", "supplier", "partner"]);

export const counterpartyFlowSchema = z.enum(["IN", "OUT"]);

export const counterpartyMetadataSchema = z.object({
  kind: counterpartyKindSchema,
  id: z.number().int().positive(),
  name: z.string().min(1),
  /** Money into the shop ("IN") vs out of the shop ("OUT"). */
  flow: counterpartyFlowSchema,
  /** Payment method or settlement_method actually used; 'LEDGER' for
   *  journal-only rows that never write a `payments` leg (e.g. a supplier
   *  TOP_UP accrual — no drawer moves at accrual time). */
  method: z.string().min(1),
  /** The owning ledger row's id (debt_ledger / supplier_ledger /
   *  partner_ledger). Null only if a future write site genuinely has none. */
  ledger_entry_id: z.number().int().positive().nullable(),
  discount: counterpartyDiscountSchema.optional(),
});

/**
 * CQ-10 — validates a caller-SUPPLIED discount amount (bundled with a
 * settlement, or a standalone write-off). Distinct from
 * `counterpartyDiscountSchema` above, which shapes the STORED metadata (loose
 * `z.number()`, since it's built server-side from already-normalized values);
 * this one enforces nonnegative amounts and "at least one currency > 0" on
 * raw input. Reused by debt.ts/supplier.ts/partner.ts write schemas (rule 14
 * — defined once, never copy-pasted per subsystem).
 */
export const counterpartyDiscountInputSchema = z
  .object({
    amount_usd: z.number().nonnegative(),
    amount_lbp: z.number().nonnegative(),
    reason: z.string().optional(),
  })
  .refine((d) => d.amount_usd > 0 || d.amount_lbp > 0, {
    message: "At least one discount amount (USD or LBP) must be greater than 0",
  });

export type CounterpartyDiscount = z.infer<typeof counterpartyDiscountSchema>;
export type CounterpartyDiscountInput = z.infer<
  typeof counterpartyDiscountInputSchema
>;
export type CounterpartyKind = z.infer<typeof counterpartyKindSchema>;
export type CounterpartyFlow = z.infer<typeof counterpartyFlowSchema>;
export type CounterpartyMetadata = z.infer<typeof counterpartyMetadataSchema>;

/**
 * Builds the `counterparty` metadata object so every write site produces the
 * exact same key shape — callers pass camelCase `ledgerEntryId`, the builder
 * maps it to the schema's `ledger_entry_id` so the key can't drift between
 * call sites (rule 14: define the shape once, never hand-roll it per repo).
 */
export function buildCounterpartyMetadata(input: {
  kind: CounterpartyKind;
  id: number;
  name: string;
  flow: CounterpartyFlow;
  method: string;
  ledgerEntryId: number | null;
  discount?: CounterpartyDiscount;
}): CounterpartyMetadata {
  return {
    kind: input.kind,
    id: input.id,
    name: input.name,
    flow: input.flow,
    method: input.method,
    ledger_entry_id: input.ledgerEntryId,
    ...(input.discount ? { discount: input.discount } : {}),
  };
}
