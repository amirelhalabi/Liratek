/**
 * Exchange IPC Handlers
 *
 * Thin wrapper over ExchangeService for IPC communication.
 */

import { ipcMain } from "electron";
import {
  getExchangeService,
  exchangeLogger,
  getUserRepository,
} from "@liratek/core";
import type { CreateExchangeData } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  ExchangeTransactionSchema,
  validatePayload,
} from "../schemas/index.js";

let _exchangeService: ReturnType<typeof getExchangeService> | null = null;

function getExchangeServiceInstance() {
  if (!_exchangeService) {
    _exchangeService = getExchangeService();
  }
  return _exchangeService;
}

export function registerExchangeHandlers(): void {
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
      const result = getExchangeServiceInstance().addDirectTransaction(
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
    return getExchangeServiceInstance().getHistory();
  });

  // Update exchange metadata (staff and admin)
  ipcMain.handle(
    "exchange:update-metadata",
    (
      event,
      data: {
        id: number;
        client_name?: string;
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

      const result = getExchangeServiceInstance().updateExchangeMetadata(
        data.id,
        { client_name: data.client_name, note: data.note },
        editedBy,
      );

      if (
        result.success &&
        result.oldValues &&
        Object.keys(result.oldValues).length > 0
      ) {
        audit(event.sender.id, {
          action: "edit_metadata",
          entity_type: "exchange_transaction",
          entity_id: String(data.id),
          summary: `Edited exchange #${data.id} metadata`,
          old_values: result.oldValues,
          new_values: data,
        });
      }

      return result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error };
    },
  );
}
