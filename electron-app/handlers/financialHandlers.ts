/**
 * Financial IPC Handlers
 */

import { ipcMain } from "electron";
import { getFinancialRepository } from "@liratek/core";

export function registerFinancialHandlers(): void {
  const repo = getFinancialRepository();

  // Get Monthly P&L
  ipcMain.handle("financial:get-monthly-pl", (_event, month: string) => {
    return repo.getMonthlyPL(month);
  });

  // Get Drawer Names
  ipcMain.handle("financial:get-drawer-names", () => {
    return repo.getDrawerNames();
  });
}
