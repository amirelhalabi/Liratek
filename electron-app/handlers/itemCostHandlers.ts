/**
 * Item Cost IPC Handlers
 *
 * Thin wrapper over ItemCostService for IPC communication.
 */

import { ipcMain } from "electron";
import { getItemCostService } from "@liratek/core";

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
      _event,
      data: {
        provider: string;
        category: string;
        itemKey: string;
        cost: number;
        currency: string;
      },
    ) => {
      itemCostService.setCost(
        data.provider,
        data.category,
        data.itemKey,
        data.cost,
        data.currency,
      );
      return { success: true };
    },
  );
}
