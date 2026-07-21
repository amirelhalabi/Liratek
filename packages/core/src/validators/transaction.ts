import { z } from "zod";

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
