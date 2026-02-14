/**
 * Exchange IPC Handlers
 *
 * Thin wrapper over ExchangeService for IPC communication.
 */

import { ipcMain } from "electron";
import { getExchangeService } from "@liratek/core";
import { exchangeLogger } from "../utils/logger.js";
import type { CreateExchangeData } from "@liratek/core";

export function registerExchangeHandlers(): void {
  const exchangeService = getExchangeService();

  // Add Transaction (Drawer B - General Drawer)
  ipcMain.handle(
    "exchange:add-transaction",
    (_event, data: CreateExchangeData) => {
      exchangeLogger.info(
        {
          fromCurrency: data.fromCurrency,
          toCurrency: data.toCurrency,
          amountIn: data.amountIn,
        },
        "Processing exchange",
      );
      return exchangeService.addTransaction(data);
    },
  );

  // Get History (last 50 transactions)
  ipcMain.handle("exchange:get-history", () => {
    return exchangeService.getHistory();
  });
}
