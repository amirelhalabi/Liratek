/**
 * Debt IPC Handlers
 *
 * Thin wrapper over DebtService for IPC communication.
 * Handles: IPC message routing to service
 */

import { ipcMain } from "electron";
import { getDebtService, debtLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import { DebtRepaymentSchema, validatePayload } from "../schemas/index.js";

interface RepaymentPaymentLeg {
  method: string;
  currencyCode: string;
  amount: number;
}

interface RepaymentData {
  clientId: number;
  amountUSD: number;
  amountLBP: number;
  paidAmountUSD?: number | undefined;
  paidAmountLBP?: number | undefined;
  drawerName?: string | undefined;
  note?: string;
  userId?: number;
  paidByMethod?: string;
  payments?: RepaymentPaymentLeg[];
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
  ipcMain.handle("debt:add-repayment", (event, data: RepaymentData) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(DebtRepaymentSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    debtLogger.info(
      {
        clientId: v.data.clientId,
        amountUSD: v.data.amountUSD,
        amountLBP: v.data.amountLBP,
      },
      "Adding repayment",
    );
    const result = debtService.addRepayment({
      ...(v.data as RepaymentData),
      userId: auth.userId,
    });
    audit(event.sender.id, {
      action: "create",
      entity_type: "repayment",
      summary: `Repayment for client #${v.data.clientId}: $${v.data.amountUSD} + ${v.data.amountLBP} LBP`,
      metadata: {
        clientId: v.data.clientId,
        amountUSD: v.data.amountUSD,
        amountLBP: v.data.amountLBP,
      },
    });
    return result;
  });

  // Dashboard debt summary
  ipcMain.handle("dashboard:get-debt-summary", () => {
    return debtService.getDebtSummary();
  });
}
