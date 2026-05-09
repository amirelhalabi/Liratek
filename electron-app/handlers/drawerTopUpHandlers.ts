/**
 * Drawer Top-Up IPC Handlers
 *
 * Thin wrapper over DrawerTopUpService for IPC communication.
 * Handles: IPC message routing to service for drawer top-up operations.
 */

import { ipcMain } from "electron";
import { getDrawerTopUpService, financialLogger } from "@liratek/core";
import { requireRole } from "../session.js";

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
      data: { amount_usd: number; amount_lbp: number; notes?: string },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const svc = getServiceInstance();
        const result = svc.addTopUp(data, auth.userId);
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
