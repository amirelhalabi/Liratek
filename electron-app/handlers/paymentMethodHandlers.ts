/**
 * Payment Method IPC Handlers
 *
 * Registers Electron IPC handlers for payment method CRUD operations.
 */

import { ipcMain } from "electron";
import { getPaymentMethodService, settingsLogger } from "@liratek/core";
import { requireRole } from "../session.js";

const log = settingsLogger.child({ sub: "paymentMethodHandlers" });

export function registerPaymentMethodHandlers(): void {
  const service = getPaymentMethodService();

  // List all payment methods (including inactive)
  ipcMain.handle("payment-methods:list", () => {
    return service.listAll();
  });

  // List active payment methods only
  ipcMain.handle("payment-methods:list-active", () => {
    return service.listActive();
  });

  // Create a new payment method (admin only)
  ipcMain.handle(
    "payment-methods:create",
    (
      e,
      data: {
        code: string;
        label: string;
        drawer_name: string;
        affects_drawer?: number;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}
      log.info({ code: data.code }, "Creating payment method");
      return service.create(data);
    },
  );

  // Update a payment method (admin only)
  ipcMain.handle(
    "payment-methods:update",
    (
      e,
      id: number,
      data: {
        label?: string;
        drawer_name?: string;
        affects_drawer?: number;
        is_active?: number;
        sort_order?: number;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}
      log.info({ id, data }, "Updating payment method");
      return service.update(id, data);
    },
  );

  // Delete a payment method (admin only, non-system only)
  ipcMain.handle("payment-methods:delete", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    log.info({ id }, "Deleting payment method");
    return service.delete(id);
  });

  // Reorder payment methods (admin only)
  ipcMain.handle("payment-methods:reorder", (e, ids: number[]) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    log.info({ ids }, "Reordering payment methods");
    return service.reorder(ids);
  });
}
