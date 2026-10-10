import { z } from "zod";

/**
 * Save/update a remembered item cost (`item-costs:set` IPC /
 * `POST /api/item-costs`) — LIRA-297, one schema for both transports
 * (rules 14/19b) and the adapters' payload type (rule 21).
 *
 * Mirrors what both transports already enforced or forwarded: all five keys
 * reach `ItemCostService.setCost` unchanged on both sides. The REST route's
 * old hand check required non-empty `provider`/`category`/`itemKey`/
 * `currency` and a defined `cost`; `cost` must be a number, with no
 * sign rule added (the repository UPSERTs whatever it is given). `currency` stays a free string:
 * nothing upstream restricted it.
 */
export const setItemCostSchema = z.object({
  provider: z.string().min(1),
  category: z.string().min(1),
  itemKey: z.string().min(1),
  cost: z.number(),
  currency: z.string().min(1),
});

export type SetItemCostInput = z.infer<typeof setItemCostSchema>;
/** What a caller SENDS (rule 21, `z.input`). */
export type SetItemCostPayload = z.input<typeof setItemCostSchema>;
