import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { getProfitService } from "@liratek/core";
import { requireRole } from "../session.js";

export function registerProfitHandlers(): void {
  const svc = getProfitService();

  // All profit IPC calls require admin role
  function requireAdmin(e: IpcMainInvokeEvent) {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) throw new Error(auth.error ?? "Admin access required");
  }

  ipcMain.handle("profits:summary", (e, from: string, to: string) => {
    requireAdmin(e);
    return svc.getSummary(from, to);
  });

  ipcMain.handle("profits:by-module", (e, from: string, to: string) => {
    requireAdmin(e);
    return svc.getByModule(from, to);
  });

  ipcMain.handle("profits:by-date", (e, from: string, to: string) => {
    requireAdmin(e);
    return svc.getByDate(from, to);
  });

  ipcMain.handle("profits:by-payment-method", (e, from: string, to: string) => {
    requireAdmin(e);
    return svc.getByPaymentMethod(from, to);
  });

  ipcMain.handle("profits:by-user", (e, from: string, to: string) => {
    requireAdmin(e);
    return svc.getByUser(from, to);
  });

  ipcMain.handle(
    "profits:by-client",
    (e, from: string, to: string, limit?: number) => {
      requireAdmin(e);
      return svc.getByClient(from, to, limit);
    },
  );

  ipcMain.handle("profits:pending", (e, from: string, to: string) => {
    requireAdmin(e);
    return svc.getPendingProfit(from, to);
  });
}
