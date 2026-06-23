/**
 * Hold Money IPC Handlers
 *
 * Thin wrapper over HoldMoneyService for IPC communication. Holding cash credits
 * the General drawer; collecting it debits the General drawer. Both write a
 * unified transaction row visible in transaction/audit history.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getHoldMoneyService, customServiceLogger } from "@liratek/core";
import type { HoldMoneyStatus } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import { HoldMoneyCreateSchema, validatePayload } from "../schemas/index.js";

export function registerHoldMoneyHandlers(): void {
  customServiceLogger.info("Registering Hold Money IPC handlers");

  const service = getHoldMoneyService();

  // List holds (optionally filter by status)
  ipcMain.handle(
    "hold-money:list",
    (_event: IpcMainInvokeEvent, filter?: { status?: HoldMoneyStatus }) => {
      try {
        return { success: true, data: service.getHolds(filter) };
      } catch (error) {
        customServiceLogger.error({ error }, "hold-money:list failed");
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to list holds",
        };
      }
    },
  );

  // Active (uncollected) holds — used by Dashboard cards + Services list
  ipcMain.handle("hold-money:active", (_event: IpcMainInvokeEvent) => {
    try {
      return { success: true, data: service.getActiveHolds() };
    } catch (error) {
      customServiceLogger.error({ error }, "hold-money:active failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list active holds",
      };
    }
  });

  // Create a hold (admin + staff)
  ipcMain.handle(
    "hold-money:create",
    (event: IpcMainInvokeEvent, data: unknown) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(HoldMoneyCreateSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      customServiceLogger.info(
        {
          client_name: v.data.client_name,
          usd: v.data.usd_amount,
          lbp: v.data.lbp_amount,
        },
        "Creating hold money",
      );
      const result = service.createHold(v.data, auth.userId);
      if (result.success) {
        audit(event.sender.id, {
          action: "create",
          entity_type: "hold_money",
          entity_id: result.id ? String(result.id) : undefined,
          summary: `Held money for ${v.data.client_name}`,
          metadata: {
            client_name: v.data.client_name,
            usd_amount: v.data.usd_amount,
            lbp_amount: v.data.lbp_amount,
          },
        });
      }
      return result;
    },
  );

  // Collect (return) a hold (admin + staff)
  ipcMain.handle(
    "hold-money:collect",
    (event: IpcMainInvokeEvent, id: number) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      customServiceLogger.info({ id }, "Collecting hold money");
      const result = service.collectHold(id, auth.userId);
      if (result.success) {
        audit(event.sender.id, {
          action: "collect",
          entity_type: "hold_money",
          entity_id: String(id),
          summary: `Collected hold #${id}`,
        });
      }
      return result;
    },
  );

  customServiceLogger.info("Hold Money IPC handlers registered");
}
