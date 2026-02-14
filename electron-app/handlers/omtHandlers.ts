/**
 * OMT/WHISH/BOB IPC Handlers
 *
 * Thin wrapper over FinancialService for IPC communication.
 */

import { ipcMain } from "electron";
import { getFinancialService } from "@liratek/core";
import { financialLogger } from "../utils/logger.js";
import type { CreateFinancialServiceData } from "@liratek/core";

export function registerOMTHandlers(): void {
  const financialService = getFinancialService();

  // Add Transaction (Drawer A for OMT, Drawer B for WHISH/BOB/OTHER)
  ipcMain.handle(
    "omt:add-transaction",
    (_event, data: CreateFinancialServiceData) => {
      financialLogger.info(
        {
          provider: data.provider,
          serviceType: data.serviceType,
          amountUSD: data.amountUSD,
        },
        "Processing financial service transaction",
      );
      return financialService.addTransaction(data);
    },
  );

  // Get History (Last 50 transactions)
  ipcMain.handle("omt:get-history", (_event, provider?: string) => {
    return financialService.getHistory(provider);
  });

  // Get Analytics (Today & Month totals)
  ipcMain.handle("omt:get-analytics", () => {
    return financialService.getAnalytics();
  });
}
