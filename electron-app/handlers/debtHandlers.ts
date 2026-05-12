/**
 * Debt IPC Handlers
 *
 * Thin wrapper over DebtService for IPC communication.
 * Handles: IPC message routing to service
 */

import { ipcMain } from "electron";
import { getDebtService, debtLogger, getUserRepository } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  DebtRepaymentSchema,
  DebtAddCreditSchema,
  DebtUseCreditSchema,
  validatePayload,
} from "../schemas/index.js";

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

  // Update debt metadata (staff and admin)
  ipcMain.handle(
    "debts:update-metadata",
    (
      event,
      data: {
        id: number;
        note?: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      let editedBy = `user-${auth.userId}`;
      try {
        const userRepo = getUserRepository();
        const user = userRepo.findById(auth.userId);
        if (user) editedBy = user.username;
      } catch {
        // fallback to user-{id}
      }

      const result = debtService.updateDebtMetadata(
        data.id,
        { note: data.note },
        editedBy,
      );

      if (
        result.success &&
        result.oldValues &&
        Object.keys(result.oldValues).length > 0
      ) {
        audit(event.sender.id, {
          action: "edit_metadata",
          entity_type: "debt_ledger",
          entity_id: String(data.id),
          summary: `Edited debt record #${data.id} metadata`,
          old_values: result.oldValues,
          new_values: data,
        });
      }

      return result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error };
    },
  );

  // Add credit (shop owes customer)
  ipcMain.handle(
    "debt:add-credit",
    (
      event,
      data: {
        clientId: number;
        amountUsd: number;
        amountLbp: number;
        note?: string;
        transactionTime?: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(DebtAddCreditSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = debtService.addCredit({
        ...v.data,
        amountUsd: v.data.amountUsd ?? 0,
        amountLbp: v.data.amountLbp ?? 0,
        userId: auth.userId,
      });

      if (result.success) {
        audit(event.sender.id, {
          action: "create",
          entity_type: "credit",
          summary: `Credit added for client #${v.data.clientId}: $${v.data.amountUsd} + ${v.data.amountLbp} LBP`,
          metadata: {
            clientId: v.data.clientId,
            amountUsd: v.data.amountUsd,
            amountLbp: v.data.amountLbp,
          },
        });
      }

      return result;
    },
  );

  // Use credit (consume customer's credit balance)
  ipcMain.handle(
    "debt:use-credit",
    (
      event,
      data: {
        clientId: number;
        amountUsd: number;
        amountLbp: number;
        note?: string;
        transactionTime?: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(DebtUseCreditSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = debtService.useCredit({
        ...v.data,
        amountUsd: v.data.amountUsd ?? 0,
        amountLbp: v.data.amountLbp ?? 0,
        userId: auth.userId,
      });

      if (result.success) {
        audit(event.sender.id, {
          action: "create",
          entity_type: "credit_used",
          summary: `Credit used for client #${v.data.clientId}: $${v.data.amountUsd} + ${v.data.amountLbp} LBP`,
          metadata: {
            clientId: v.data.clientId,
            amountUsd: v.data.amountUsd,
            amountLbp: v.data.amountLbp,
          },
        });
      }

      return result;
    },
  );

  // Get client balance (net debt/credit)
  ipcMain.handle("debt:client-balance", (event, clientId: number) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };

    try {
      const balance = debtService.getClientBalance(clientId);
      return { success: true, data: balance };
    } catch (error) {
      debtLogger.error({ error, clientId }, "debt:client-balance failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get balance",
      };
    }
  });
}
