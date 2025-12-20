/**
 * Debt IPC Handlers
 *
 * Thin wrapper over DebtService for IPC communication.
 * Handles: IPC message routing to service
 */

import { ipcMain } from "electron";
import { getDebtService } from "../services";
import { debtLogger } from "../utils/logger";

interface RepaymentData {
  clientId: number;
  amountUSD: number;
  amountLBP: number;
  note?: string;
  userId?: number;
}

export function registerDebtHandlers(): void {
  const debtService = getDebtService();

  // Get all debtors with their totals
  ipcMain.handle("debt:get-debtors", () => {
    return debtService.getDebtors();
  });

  // Get debt history for a client
  ipcMain.handle("debt:get-client-history", (_event, clientId: number) => {
    return debtService.getClientHistory(clientId);
  });

  // Get total debt for a client
  ipcMain.handle("debt:get-client-total", (_event, clientId: number) => {
    return debtService.getClientTotal(clientId);
  });

  // Add a repayment
  ipcMain.handle("debt:add-repayment", (_event, data: RepaymentData) => {
    debtLogger.info(
      {
        clientId: data.clientId,
        amountUSD: data.amountUSD,
        amountLBP: data.amountLBP,
      },
      "Adding repayment",
    );
    return debtService.addRepayment(data);
  });

  // Dashboard debt summary
  ipcMain.handle("dashboard:get-debt-summary", () => {
    return debtService.getDebtSummary();
  });
}
