import { z } from "zod";
import { positiveDecimalSchema, transactionTimeSchema } from "./common.js";

/**
 * Drawer transfer validation (Primary Cash Drawer plan §8.6, replacing
 * `system_float_topups`/`createSystemFloatTopupSchema`): a generic, reversible
 * cash move between any two of the shop's own drawers — General ↔ the
 * primary cash drawer (`OMT_System`/`Whish_System`) is the only pair the UI
 * exposes today, but the contract itself does not special-case drawer names
 * (decision #13's "generic drawer↔General cash transfer" framing) — the
 * repository's insufficient-funds guard is the real gate, not an enum here.
 * Drawer names are therefore plain non-empty strings, mirroring
 * `drawer_topups.source_drawer` (free text) rather than the old
 * `systemFloatDrawerNameSchema` enum.
 */
export const createDrawerTransferSchema = z
  .object({
    fromDrawer: z.string().trim().min(1, "fromDrawer is required"),
    toDrawer: z.string().trim().min(1, "toDrawer is required"),
    amount_usd: positiveDecimalSchema,
    amount_lbp: positiveDecimalSchema,
    notes: z.string().max(500).optional(),
    transaction_time: transactionTimeSchema,
  })
  .refine((data) => data.amount_usd > 0 || data.amount_lbp > 0, {
    message:
      "At least one of amount_usd or amount_lbp must be greater than zero",
  })
  .refine((data) => data.fromDrawer !== data.toDrawer, {
    message:
      "fromDrawer and toDrawer cannot be the same drawer — this moves no money and would only pollute the audit trail with a self-transfer",
    path: ["toDrawer"],
  });

export type CreateDrawerTransferInput = z.infer<
  typeof createDrawerTransferSchema
>;
