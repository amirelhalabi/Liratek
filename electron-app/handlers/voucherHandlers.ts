/**
 * Voucher IPC Handlers
 *
 * Thin wrapper over VoucherService for IPC communication.
 * Redemption itself happens inside each transaction context (sale, etc.) — these
 * handlers cover creation, listing, live validation, and cancellation.
 */

import { ipcMain } from "electron";
import { getVoucherService, voucherLogger } from "@liratek/core";
import type { VoucherFilters } from "@liratek/core";
import { requireRole } from "../session.js";
import { VoucherCreateSchema, validatePayload } from "../schemas/index.js";

let service: ReturnType<typeof getVoucherService> | null = null;

function getServiceInstance() {
  if (!service) service = getVoucherService();
  return service;
}

export function registerVoucherHandlers(): void {
  voucherLogger.info("Registering Voucher IPC handlers");

  // Create a voucher
  ipcMain.handle("voucher:create", (event, data) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(VoucherCreateSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = getServiceInstance().createVoucher(
        {
          clientId: v.data.clientId,
          amount: v.data.amount,
          currency: v.data.currency,
          expiryDate: v.data.expiryDate ?? null,
          note: v.data.note ?? null,
        },
        auth.userId,
      );
      return result;
    } catch (error) {
      voucherLogger.error({ error }, "voucher:create failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create voucher",
      };
    }
  });

  // List vouchers (optionally filtered by status / client)
  ipcMain.handle("voucher:get-all", (event, filters?: VoucherFilters) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      return getServiceInstance().getVouchers(filters ?? {});
    } catch (error) {
      voucherLogger.error({ error }, "voucher:get-all failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load vouchers",
      };
    }
  });

  // Live validation for checkout (look up a code, report redeemability)
  ipcMain.handle("voucher:validate", (event, code: string) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      return getServiceInstance().validateVoucher(code);
    } catch (error) {
      voucherLogger.error({ error }, "voucher:validate failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to validate voucher",
      };
    }
  });

  // Cancel (void) a pending voucher — admin only
  ipcMain.handle("voucher:cancel", (event, id: number) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      return getServiceInstance().cancelVoucher(id, auth.userId);
    } catch (error) {
      voucherLogger.error({ error }, "voucher:cancel failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to cancel voucher",
      };
    }
  });

  voucherLogger.info("Voucher IPC handlers registered");
}
