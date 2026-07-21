import { z } from "zod";

/**
 * Mobile Service Item — UPDATE path only (LIRA W6.b).
 *
 * The rest of this feature (create/delete/toggle/seed/list) predates the
 * dual-transport rule and is left desktop-IPC-only (pre-existing gap, not
 * introduced here — see the W6 report). This schema guards the ONE path W6.b
 * touches: editing an item's price/label/sort/active fields plus the new
 * structured `validity_days`/`credits` — shared by the IPC handler and the
 * new REST route (CLAUDE.md rule 14/19).
 */
export const mobileServiceItemUpdateSchema = z.object({
  id: z.number().int().positive(),
  label: z.string().trim().min(1).optional(),
  cost_lbp: z.number().nonnegative().optional(),
  sell_lbp: z.number().nonnegative().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.number().int().min(0).max(1).optional(),
  /** Structured validity (days) — nullable to allow clearing a previously-set value. */
  validity_days: z.number().int().nonnegative().nullable().optional(),
  /** Structured credit amount (USD) — nullable to allow clearing. */
  credits: z.number().nonnegative().nullable().optional(),
});

export type MobileServiceItemUpdateInput = z.infer<
  typeof mobileServiceItemUpdateSchema
>;
