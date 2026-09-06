import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  getProfitService,
  getProfitsAccessService,
  logger,
  PROFITS_PASSWORD_SETTING_KEY,
} from "@liratek/core";
import {
  requireRole,
  requireProfitsAccess,
  grantProfitsUnlock,
  revokeProfitsUnlock,
} from "../session.js";
import { audit } from "./auditHelper.js";
import {
  validatePayload,
  SetProfitsPasswordSchema,
  UnlockProfitsSchema,
} from "../schemas/index.js";

export function registerProfitHandlers(): void {
  logger.info("Registering Profit IPC handlers");

  const svc = getProfitService();
  const accessSvc = getProfitsAccessService();

  // Profits password gate (frozen contract): the 7 data channels below used
  // to gate on role alone (requireAdmin). They now require a LIVE password
  // unlock too — owner decision, "everyone types it", admin included.
  function requireProfitsGate(e: IpcMainInvokeEvent) {
    const auth = requireProfitsAccess(e.sender.id);
    if (!auth.ok) throw new Error(auth.error);
  }

  ipcMain.handle("profits:summary", (e, from: string, to: string) => {
    requireProfitsGate(e);
    return svc.getSummary(from, to);
  });

  ipcMain.handle("profits:by-module", (e, from: string, to: string) => {
    requireProfitsGate(e);
    return svc.getByModule(from, to);
  });

  ipcMain.handle("profits:by-date", (e, from: string, to: string) => {
    requireProfitsGate(e);
    return svc.getByDate(from, to);
  });

  ipcMain.handle("profits:by-payment-method", (e, from: string, to: string) => {
    requireProfitsGate(e);
    return svc.getByPaymentMethod(from, to);
  });

  ipcMain.handle("profits:by-user", (e, from: string, to: string) => {
    requireProfitsGate(e);
    return svc.getByUser(from, to);
  });

  ipcMain.handle(
    "profits:by-client",
    (e, from: string, to: string, limit?: number) => {
      requireProfitsGate(e);
      return svc.getByClient(from, to, limit);
    },
  );

  ipcMain.handle("profits:pending", (e, from: string, to: string) => {
    requireProfitsGate(e);
    return svc.getPendingProfit(from, to);
  });

  // ==================== Profits password gate ====================

  // Read — raw shape, no envelope (adapter contract: reads return raw).
  // admin + staff so the lock screen can decide which message to show
  // ("enter password" vs "ask an admin to set one in Settings").
  ipcMain.handle("profits:password-status", (e) => {
    const auth = requireRole(e.sender.id, ["admin", "staff"]);
    if (!auth.ok) throw new Error(auth.error);
    return { isSet: accessSvc.isPasswordSet() };
  });

  // Write — envelope. Admin only: the password is set ONLY by an admin,
  // from Settings (frozen contract).
  ipcMain.handle("profits:set-password", (e, data) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const validation = validatePayload(SetProfitsPasswordSchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      const result = accessSvc.setPassword(validation.data.password);
      if (result.success) {
        // Never put the password or its hash in new_values — audit the
        // fact a change happened, not the secret itself. Same shape dbHandlers
        // uses for db:update-setting / settings:update.
        audit(e.sender.id, {
          action: "update",
          entity_type: "setting",
          entity_id: PROFITS_PASSWORD_SETTING_KEY,
          summary: "Set profits page password",
        });
      }
      return result;
    } catch (error) {
      logger.error({ error }, "profits:set-password failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed",
      };
    }
  });

  // Write — envelope. admin + staff: everyone unlocks with the same
  // password (fail closed if none is set yet — ProfitsAccessService.verify()
  // returns false when no password is set).
  ipcMain.handle("profits:unlock", (e, data) => {
    try {
      const auth = requireRole(e.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const validation = validatePayload(UnlockProfitsSchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      if (!accessSvc.isPasswordSet()) {
        return {
          success: false,
          error: "No profits password has been set. Ask an admin to set one in Settings.",
        };
      }

      if (!accessSvc.verify(validation.data.password)) {
        // Never log the attempted password — only who tried and failed.
        logger.warn(
          { userId: auth.userId },
          "profits:unlock failed — incorrect password",
        );
        return { success: false, error: "Incorrect password" };
      }

      grantProfitsUnlock(e.sender.id);
      return { success: true };
    } catch (error) {
      logger.error({ error }, "profits:unlock failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed",
      };
    }
  });

  // Write — envelope. admin + staff: navigating away from /profits locks it
  // immediately (client unmount calls this).
  ipcMain.handle("profits:lock", (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      revokeProfitsUnlock(e.sender.id);
      return { success: true };
    } catch (error) {
      logger.error({ error }, "profits:lock failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed",
      };
    }
  });

  logger.info("Profit IPC handlers registered");
}
