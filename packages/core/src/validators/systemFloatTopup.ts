import { z } from "zod";
import { positiveDecimalSchema, transactionTimeSchema } from "./common.js";
import { SYSTEM_FLOAT_DRAWER_NAMES } from "../constants/systemFloatDrawers.js";

/**
 * System float top-up validation (owner-confirmed 2026-07-29): the operator
 * funds the OMT_System / Whish_System spendable float directly — the missing
 * direction next to DrawerTopUpRepository.createTopUpFromDrawer, which only
 * ever moves money OUT of the system drawer into General. Every top-up here
 * MUST name a real funding drawer (Σ drawer deltas = 0 — this moves the
 * shop's own cash, it never invents it), so unlike drawer_topups' External
 * Cash-In mode there is no no-source variant.
 */

// `z.enum` needs a non-empty tuple literal, not `readonly string[]` — spread
// the shared `SYSTEM_FLOAT_DRAWER_NAMES` (constants/systemFloatDrawers.ts,
// CLAUDE.md rule 14) into one so this schema can never drift from the
// repository/service allow-list it's meant to mirror.
export const systemFloatDrawerNameSchema = z.enum([
  ...SYSTEM_FLOAT_DRAWER_NAMES,
]);

export const createSystemFloatTopupSchema = z
  .object({
    targetDrawer: systemFloatDrawerNameSchema,
    fundingDrawer: z.string().trim().min(1, "fundingDrawer is required"),
    amount_usd: positiveDecimalSchema,
    amount_lbp: positiveDecimalSchema,
    notes: z.string().max(500).optional(),
    transaction_time: transactionTimeSchema,
  })
  .refine((data) => data.amount_usd > 0 || data.amount_lbp > 0, {
    message:
      "At least one of amount_usd or amount_lbp must be greater than zero",
  })
  .refine((data) => data.fundingDrawer !== data.targetDrawer, {
    message:
      "fundingDrawer and targetDrawer cannot be the same drawer — this moves no money and would only pollute the audit trail with a self-transfer",
    path: ["fundingDrawer"],
  });

export type CreateSystemFloatTopupInput = z.infer<
  typeof createSystemFloatTopupSchema
>;
