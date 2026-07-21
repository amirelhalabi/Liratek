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
