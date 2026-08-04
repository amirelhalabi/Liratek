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
  getUserRepository,
} from "@liratek/core";
import type {
  CreateFinancialServiceData,
  SelfChargeTelecomItemData,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import { FinancialServiceSchema, validatePayload } from "../schemas/index.js";

export function registerOMTHandlers(): void {
  const financialService = getFinancialService();

  // Add Transaction (Drawer A for OMT, Drawer B for WHISH/BOB/OTHER)
  ipcMain.handle(
    "omt:add-transaction",
    (event, data: CreateFinancialServiceData) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(FinancialServiceSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      financialLogger.info(
        {
          provider: data.provider,
          serviceType: data.serviceType,
          amount: data.amount,
          currency: data.currency || "USD",
        },
        "Processing financial service transaction",
      );
      const result = financialService.addTransaction({
        ...(v.data as CreateFinancialServiceData),
        // Stamp the acting user — every row this writes (transaction,
        // payments, debt_ledger) has a FK to users(id) (foreign_keys=ON).
        userId: auth.userId,
      });
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
  ipcMain.handle("omt:get-analytics", (_event, providers?: string[]) => {
    return financialService.getAnalytics(providers);
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

  // Update financial service metadata (staff and admin)
  ipcMain.handle(
    "financial:update-metadata",
    (
      event,
      data: {
        id: number;
        client_name?: string;
        phone_number?: string;
        sender_name?: string;
        sender_phone?: string;
        receiver_name?: string;
        receiver_phone?: string;
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

      const result = financialService.updateFinancialServiceMetadata(
        data.id,
        {
          client_name: data.client_name,
          phone_number: data.phone_number,
          sender_name: data.sender_name,
          sender_phone: data.sender_phone,
          receiver_name: data.receiver_name,
          receiver_phone: data.receiver_phone,
          note: data.note,
        },
        editedBy,
      );

      if (
        result.success &&
        result.oldValues &&
        Object.keys(result.oldValues).length > 0
      ) {
        audit(event.sender.id, {
          action: "edit_metadata",
          entity_type: "financial_service",
          entity_id: String(data.id),
          summary: `Edited financial service #${data.id} metadata`,
          old_values: result.oldValues,
          new_values: data,
        });
      }

      return result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error };
    },
  );

  // LIRA-090 §5.2: self-charge a telecom cart to the shop's own carrier line.
  // No customer, no sale row, no profit row — charges the item's full
  // cost_lbp to the iPick/Katsh drawer and credits the item's full USD
  // credits + validity_days to the target line.  Admin only (mutations the
  // shop's own carrier inventory; there is no reversal path without a void).
  ipcMain.handle(
    "financial:self-charge-telecom-item",
    (event, data: SelfChargeTelecomItemData) => {
      try {
        const auth = requireRole(event.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const result = getFinancialServiceRepository().selfChargeTelecomItem({
          ...data,
          userId: auth.userId,
        });
        audit(event.sender.id, {
          action: "create",
          entity_type: "financial_transaction",
          summary: `Telecom self-charge: item #${data.mobileServiceItemId}${data.carrierLineId ? ` → line #${data.carrierLineId}` : " (primary)"}`,
          metadata: {
            mobileServiceItemId: data.mobileServiceItemId,
            carrierLineId: data.carrierLineId,
          },
        });
        return { success: true, data: result };
      } catch (error) {
        financialLogger.error(
          { error },
          "financial:self-charge-telecom-item failed",
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : "Self-charge failed",
        };
      }
    },
  );
}
