/**
 * OMT/WHISH/BOB IPC Handlers
 *
 * Thin wrapper over FinancialService for IPC communication.
 */

import { ipcMain } from "electron";
import {
  getFinancialService,
  financialLogger,
  getFinancialServiceRepository,
  getTransactionRepository,
} from "@liratek/core";
import type { CreateFinancialServiceData } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";

export function registerOMTHandlers(): void {
  const financialService = getFinancialService();

  // Add Transaction (Drawer A for OMT, Drawer B for WHISH/BOB/OTHER)
  ipcMain.handle(
    "omt:add-transaction",
    (event, data: CreateFinancialServiceData) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };
      financialLogger.info(
        {
          provider: data.provider,
          serviceType: data.serviceType,
          amount: data.amount,
          currency: data.currency || "USD",
        },
        "Processing financial service transaction",
      );
      const result = financialService.addTransaction(data);
      audit(event.sender.id, {
        action: "create",
        entity_type: "financial_transaction",
        summary: `${data.provider} ${data.serviceType}: ${data.amount} ${data.currency || "USD"}`,
        metadata: {
          provider: data.provider,
          serviceType: data.serviceType,
          amount: data.amount,
          currency: data.currency || "USD",
        },
      });
      return result;
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

  // Get a single financial service record by ID (for debt detail eye button)
  ipcMain.handle("omt:get-by-id", (_event, id: number) => {
    return getFinancialServiceRepository().findById(id);
  });

  // Get all payment rows for a transaction (for debt detail eye button)
  ipcMain.handle(
    "omt:get-payments-by-transaction",
    (_event, transactionId: number) => {
      return getTransactionRepository().getPaymentsByTransactionId(
        transactionId,
      );
    },
  );
}
