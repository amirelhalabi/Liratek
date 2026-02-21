import { ipcMain } from "electron";
import { getProfitService } from "@liratek/core";
/* eslint-disable @typescript-eslint/no-require-imports */

export function registerProfitHandlers(): void {
  const svc = getProfitService();

  // All profit IPC calls require admin role
  function requireAdmin() {
    try {
      const { requireRole } = require("../session");
      requireRole(["admin"]);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Admin access required",
      );
    }
  }

  ipcMain.handle("profits:summary", (_e, from: string, to: string) => {
    requireAdmin();
    return svc.getSummary(from, to);
  });

  ipcMain.handle("profits:by-module", (_e, from: string, to: string) => {
    requireAdmin();
    return svc.getByModule(from, to);
  });

  ipcMain.handle("profits:by-date", (_e, from: string, to: string) => {
    requireAdmin();
    return svc.getByDate(from, to);
  });

  ipcMain.handle(
    "profits:by-payment-method",
    (_e, from: string, to: string) => {
      requireAdmin();
      return svc.getByPaymentMethod(from, to);
    },
  );

  ipcMain.handle("profits:by-user", (_e, from: string, to: string) => {
    requireAdmin();
    return svc.getByUser(from, to);
  });

  ipcMain.handle(
    "profits:by-client",
    (_e, from: string, to: string, limit?: number) => {
      requireAdmin();
      return svc.getByClient(from, to, limit);
    },
  );
}
