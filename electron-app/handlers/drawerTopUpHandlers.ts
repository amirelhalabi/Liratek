/**
 * Drawer Top-Up IPC Handlers
 *
 * Thin wrapper over DrawerTopUpService for IPC communication.
 * Handles: IPC message routing to service for drawer top-up operations.
 */

import { ipcMain } from "electron";
import { getDrawerTopUpService, financialLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  validatePayload,
  DrawerTopUpCreateSchema,
  SystemFloatTopupSchema,
} from "../schemas/index.js";

let service: ReturnType<typeof getDrawerTopUpService> | null = null;

function getServiceInstance() {
  if (!service) {
    service = getDrawerTopUpService();
  }
  return service;
}

export function registerDrawerTopUpHandlers(): void {
  financialLogger.info("Registering Drawer Top-Up IPC handlers");

  // Create a drawer top-up entry
  ipcMain.handle(
    "drawer-topup:create",
    async (
      e,
      data: {
        amount_usd: number;
        amount_lbp: number;
        notes?: string;
        extra_currencies?: { currency_code: string; amount: number }[];
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const validation = validatePayload(DrawerTopUpCreateSchema, data);
        if (!validation.ok) {
          return { success: false, error: validation.error };
        }

        const svc = getServiceInstance();
        const result = svc.addTopUp(validation.data, auth.userId);
        if ((result as { success?: boolean }).success !== false) {
          const extraCount = validation.data.extra_currencies?.length ?? 0;
          audit(e.sender.id, {
            action: "create",
            entity_type: "drawer_topup",
            summary:
              `Drawer top-up: $${validation.data.amount_usd} USD + ${validation.data.amount_lbp} LBP` +
              (extraCount > 0 ? ` + ${extraCount} other currencies` : ""),
            metadata: {
              amount_usd: validation.data.amount_usd,
              amount_lbp: validation.data.amount_lbp,
              extra_currencies: validation.data.extra_currencies,
              notes: validation.data.notes,
            },
          });
        }
        return result;
      } catch (error) {
        financialLogger.error({ error }, "drawer-topup:create failed");
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to create top-up",
        };
      }
    },
  );

  // Get drawer top-up history
  ipcMain.handle(
    "drawer-topup:history",
    async (_e, params?: { limit?: number }) => {
      try {
        const svc = getServiceInstance();
        const data = svc.getHistory(params?.limit);
        return { success: true, data };
      } catch (error) {
        financialLogger.error({ error }, "drawer-topup:history failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to retrieve top-up history",
        };
      }
    },
  );

  // Create a drawer top-up from a source drawer (transfer)
  ipcMain.handle(
    "drawer-topup:create-from-drawer",
    async (
      e,
      data: {
        amount_usd: number;
        amount_lbp: number;
        source_drawer: string;
        notes?: string;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const svc = getServiceInstance();
        const result = svc.topUpFromDrawer(data, auth.userId);
        if ((result as { success?: boolean }).success !== false) {
          audit(e.sender.id, {
            action: "create",
            entity_type: "drawer_topup",
            summary: `Drawer transfer from ${data.source_drawer}: $${data.amount_usd} USD + ${data.amount_lbp} LBP`,
            metadata: {
              source_drawer: data.source_drawer,
              amount_usd: data.amount_usd,
              amount_lbp: data.amount_lbp,
              notes: data.notes,
            },
          });
        }
        return result;
      } catch (error) {
        financialLogger.error(
          { error },
          "drawer-topup:create-from-drawer failed",
        );
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create top-up from drawer",
        };
      }
    },
  );

  // Fund the OMT_System / Whish_System spendable float from any drawer
  // holding a spendable balance (owner-confirmed 2026-07-29 float model).
  ipcMain.handle(
    "drawer-topup:fund-system",
    async (
      e,
      data: {
        targetDrawer: "OMT_System" | "Whish_System";
        fundingDrawer: string;
        amount_usd: number;
        amount_lbp: number;
        notes?: string;
        transaction_time?: string;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const validation = validatePayload(SystemFloatTopupSchema, data);
        if (!validation.ok) {
          return { success: false, error: validation.error };
        }

        const svc = getServiceInstance();
        const result = svc.fundSystemDrawer(validation.data, auth.userId);
        if ((result as { success?: boolean }).success !== false) {
          audit(e.sender.id, {
            action: "create",
            entity_type: "system_float_topup",
            summary: `Fund ${validation.data.targetDrawer.replace("_", " ")}: ${validation.data.fundingDrawer} → ${validation.data.targetDrawer} — $${validation.data.amount_usd} USD + ${validation.data.amount_lbp} LBP`,
            metadata: {
              target_drawer: validation.data.targetDrawer,
              funding_drawer: validation.data.fundingDrawer,
              amount_usd: validation.data.amount_usd,
              amount_lbp: validation.data.amount_lbp,
              notes: validation.data.notes,
            },
          });
        }
        return result;
      } catch (error) {
        financialLogger.error({ error }, "drawer-topup:fund-system failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to fund system drawer",
        };
      }
    },
  );

  // Get available source drawers for transfer
  ipcMain.handle("drawer-topup:source-drawers", async () => {
    try {
      const svc = getServiceInstance();
      const data = svc.getSourceDrawers();
      return { success: true, data };
    } catch (error) {
      financialLogger.error({ error }, "drawer-topup:source-drawers failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get source drawers",
      };
    }
  });

  financialLogger.info("Drawer Top-Up IPC handlers registered");
}
