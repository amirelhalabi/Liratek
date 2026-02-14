/**
 * Binance IPC Handlers
 *
 * Thin wrapper over BinanceService for IPC communication.
 */

import { ipcMain } from "electron";
import { getBinanceService } from "../services/index.js";
import { binanceLogger } from "../utils/logger.js";
import type { CreateBinanceTransactionData } from "@liratek/core";

export function registerBinanceHandlers(): void {
  const binanceService = getBinanceService();

  // Add a Binance transaction (send or receive)
  ipcMain.handle(
    "binance:add-transaction",
    (_event, data: CreateBinanceTransactionData) => {
      binanceLogger.info(
        {
          type: data.type,
          amount: data.amount,
          currencyCode: data.currencyCode,
        },
        "Processing Binance transaction",
      );
      return binanceService.addTransaction(data);
    },
  );

  // Get history
  ipcMain.handle("binance:get-history", (_event, limit?: number) => {
    return binanceService.getHistory(limit);
  });

  // Get today's stats
  ipcMain.handle("binance:get-today-stats", () => {
    return binanceService.getTodayStats();
  });
}
