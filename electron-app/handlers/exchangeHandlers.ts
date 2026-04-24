/**
 * Exchange IPC Handlers
 *
 * Thin wrapper over ExchangeService for IPC communication.
 */

import { ipcMain } from "electron";
import { getExchangeService, exchangeLogger } from "@liratek/core";
import type { CreateExchangeData } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  ExchangeTransactionSchema,
  validatePayload,
} from "../schemas/index.js";

export function registerExchangeHandlers(): void {
  const exchangeService = getExchangeService();

  // Add Transaction (Drawer B - General Drawer)
  ipcMain.handle(
    "exchange:add-transaction",
    (event, data: CreateExchangeData) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(ExchangeTransactionSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      exchangeLogger.info(
        {
          fromCurrency: data.fromCurrency,
          toCurrency: data.toCurrency,
          amountIn: data.amountIn,
        },
        "Processing exchange",
      );
      const result = exchangeService.addTransaction(
        v.data as CreateExchangeData,
      );
      audit(event.sender.id, {
        action: "create",
        entity_type: "exchange_transaction",
        summary: `Exchange ${data.amountIn} ${data.fromCurrency} → ${data.toCurrency}`,
        metadata: {
          fromCurrency: data.fromCurrency,
          toCurrency: data.toCurrency,
          amountIn: data.amountIn,
        },
      });
      return result;
    },
  );

  // Get History (last 50 transactions)
  ipcMain.handle("exchange:get-history", () => {
    return exchangeService.getHistory();
  });
}
