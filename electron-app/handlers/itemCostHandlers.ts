/**
 * Item Cost IPC Handlers
 *
 * Thin wrapper over ItemCostService for IPC communication.
 */

import { ipcMain } from "electron";
import { getItemCostService } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";

export function registerItemCostHandlers(): void {
  const itemCostService = getItemCostService();

  // Get all saved item costs
  ipcMain.handle("item-costs:get-all", () => {
    return itemCostService.getAllCosts();
  });

  // Save/update an item cost
  ipcMain.handle(
    "item-costs:set",
    (
      event,
      data: {
        provider: string;
        category: string;
        itemKey: string;
        cost: number;
        currency: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
      itemCostService.setCost(
        data.provider,
        data.category,
        data.itemKey,
        data.cost,
        data.currency,
      );
      audit(event.sender.id, {
        action: "update",
        entity_type: "item_cost",
        entity_id: `${data.provider}:${data.category}:${data.itemKey}`,
        summary: `Set cost for ${data.provider}/${data.itemKey}: ${data.cost} ${data.currency}`,
      });
      return { success: true };
    },
  );
}
