/**
 * Item Cost IPC Handlers
 *
 * Thin wrapper over ItemCostService for IPC communication.
 */

import { ipcMain } from "electron";
import { getItemCostService } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import { validatePayload, SetItemCostSchema } from "../schemas/index.js";

export function registerItemCostHandlers(): void {
  const itemCostService = getItemCostService();

  // Get all saved item costs
  ipcMain.handle("item-costs:get-all", () => {
    return itemCostService.getAllCosts();
  });

  // Save/update an item cost. Validated against core's setItemCostSchema
  // (shared with POST /api/item-costs, rule 14) — all five keys reach the
  // service on both transports, so nothing is stripped (rule 23).
  ipcMain.handle("item-costs:set", (event, data: unknown) => {
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const v = validatePayload(SetItemCostSchema, data);
    if (!v.ok) return { success: false, error: v.error };
    const { provider, category, itemKey, cost, currency } = v.data;
    // setCost catches its own DB errors and reports them in its result —
    // return that result, never a blanket `{ success: true }`.
    const result = itemCostService.setCost(
      provider,
      category,
      itemKey,
      cost,
      currency,
    );
    if (result.success) {
      audit(event.sender.id, {
        action: "update",
        entity_type: "item_cost",
        entity_id: `${provider}:${category}:${itemKey}`,
        summary: `Set cost for ${provider}/${itemKey}: ${cost} ${currency}`,
      });
    }
    return result;
  });
}
