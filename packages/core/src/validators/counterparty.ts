import { z } from "zod";
import { isWithinShortfallMax, SHORTFALL_MAX } from "./exchange.js";

/**
 * Counterparty transaction metadata contract (CQ-8,
 * docs/plans/done_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md "Extension
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

/**
 * LIRA-372 — the Discount line on every settle screen (Debts Repay,
 * Suppliers Pay / Receive, batch Settle, Settle Account, Partners by day and
 * by amount): the counterparty discount shape, capped PER CURRENCY at
 * `SHORTFALL_MAX` (up to and including $5 / 450,000 LBP), for every role.
 * Refined on the FIELD, never on a parent object, so the settle schemas stay
 * plain ZodObjects (`.shape` is read by the backend suppliers API test).
 * Each repository re-checks "≤ what is owed" (trust boundary). Defined once
 * (rule 14); `counterpartyDiscountInputSchema` above stays uncapped for the
 * admin Write off windows (FR-009).
 */
export const settleDiscountInputSchema =
  counterpartyDiscountInputSchema.superRefine((d, ctx) => {
    if (d.amount_usd >= 0 && !isWithinShortfallMax(d.amount_usd, "USD")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: settleDiscountCapMessage("USD"),
        path: ["amount_usd"],
      });
    }
    if (d.amount_lbp >= 0 && !isWithinShortfallMax(d.amount_lbp, "LBP")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: settleDiscountCapMessage("LBP"),
        path: ["amount_lbp"],
      });
    }
  });

/** The one refusal sentence for a settle discount over the cap. */
export function settleDiscountCapMessage(currency: "USD" | "LBP"): string {
  return currency === "USD"
    ? `The discount is more than $${SHORTFALL_MAX.USD}.`
    : `The discount is more than ${SHORTFALL_MAX.LBP.toLocaleString("en-US")} LBP.`;
}

/**
 * LIRA-372 (owner decision B, 2026-11-05) — the ONE server-side cap check
 * for a settle discount (rule 14: same predicate and sentence as
 * `settleDiscountInputSchema`). Services and repositories call it so the
 * cap holds even for a caller that skipped the schema. Returns the refusal
 * sentence, or null when every amount is within the cap. Admin Write off
 * never calls it (uncapped by decision).
 */
export function settleDiscountCapError(amounts: {
  usd?: number;
  lbp?: number;
}): string | null {
  const usd = Math.abs(amounts.usd ?? 0);
  const lbp = Math.abs(amounts.lbp ?? 0);
  if (usd > 0 && !isWithinShortfallMax(usd, "USD")) {
    return settleDiscountCapMessage("USD");
  }
  if (lbp > 0 && !isWithinShortfallMax(lbp, "LBP")) {
    return settleDiscountCapMessage("LBP");
  }
  return null;
}

/**
 * LIRA-372 — a single settle-discount amount in a known currency (the
 * partner per-day `forgive.amount`, whose currency is its section's key).
 * Same cap and wording as `settleDiscountInputSchema`.
 */
export function settleForgiveAmountSchema(currency: "USD" | "LBP") {
  return z
    .number()
    .nonnegative()
    .refine((n) => n < 0 || isWithinShortfallMax(n, currency), {
      message: settleDiscountCapMessage(currency),
    });
}

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
