/**
 * Financial IPC Handlers
 */

import { ipcMain } from "electron";
import { getFinancialRepository } from "@liratek/core";

export function registerFinancialHandlers(): void {
  const repo = getFinancialRepository();

  // Get Drawer Names
  ipcMain.handle("financial:get-drawer-names", () => {
    return repo.getDrawerNames();
  });
}
