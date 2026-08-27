/**
 * Drawer Cash-Out IPC Handlers
 *
 * Thin wrapper over DrawerCashoutService for IPC communication.
 * Handles: IPC message routing to service for drawer cash-out operations
 * (owner's draw — physical cash pulled OUT of the General drawer). Mirrors
 * Drawer Top-Up, sign-flipped: admin-only, never touches expenses/profit.
 */

import { ipcMain } from "electron";
import { getDrawerCashoutService, createChildLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import { validatePayload, DrawerCashoutSchema } from "../schemas/index.js";

// Same module context as DrawerCashoutService's internal logger
// (packages/core/src/services/DrawerCashoutService.ts) — keeps handler and
// service log lines correlated under one "drawer-cashout" tag.
const drawerCashoutLogger = createChildLogger({ module: "drawer-cashout" });

let service: ReturnType<typeof getDrawerCashoutService> | null = null;

function getServiceInstance() {
  if (!service) {
    service = getDrawerCashoutService();
  }
  return service;
}

export function registerDrawerCashoutHandlers(): void {
  drawerCashoutLogger.info("Registering Drawer Cash-Out IPC handlers");

  // Create a drawer cash-out entry (admin-only — no counterpart cash
  // outflow, real shrinkage risk if left open to staff).
  ipcMain.handle(
    "drawer-cashout:create",
    async (
      e,
      data: {
        amount_usd: number;
        amount_lbp: number;
        extra_currencies?: { currency_code: string; amount: number }[];
        notes: string;
        transaction_time?: string;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const validation = validatePayload(DrawerCashoutSchema, data);
        if (!validation.ok) {
          return { success: false, error: validation.error };
        }

        const svc = getServiceInstance();
        const result = svc.addCashout(validation.data, auth.userId);
        if ((result as { success?: boolean }).success !== false) {
          audit(e.sender.id, {
            action: "create",
            entity_type: "drawer_cashout",
            summary: `Drawer cash-out: $${validation.data.amount_usd} USD + ${validation.data.amount_lbp} LBP`,
            metadata: {
              amount_usd: validation.data.amount_usd,
              amount_lbp: validation.data.amount_lbp,
              extra_currencies: validation.data.extra_currencies ?? null,
              notes: validation.data.notes,
            },
          });
        }
        return result;
      } catch (error) {
        drawerCashoutLogger.error({ error }, "drawer-cashout:create failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create cash-out",
        };
      }
    },
  );

  // Get drawer cash-out history
  ipcMain.handle(
    "drawer-cashout:history",
    async (_e, params?: { limit?: number }) => {
      try {
        const svc = getServiceInstance();
        const data = svc.getHistory(params?.limit);
        return { success: true, data };
      } catch (error) {
        drawerCashoutLogger.error({ error }, "drawer-cashout:history failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to retrieve cash-out history",
        };
      }
    },
  );

  drawerCashoutLogger.info("Drawer Cash-Out IPC handlers registered");
}
