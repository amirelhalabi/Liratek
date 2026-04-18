/**
 * Audit Log IPC Handlers
 *
 * Provides read-only access to the audit log for the frontend.
 * All endpoints require admin role.
 */

import { ipcMain } from "electron";
import { getAuditService, auditLogger } from "@liratek/core";
import type { AuditFilters } from "@liratek/core";
import { requireRole } from "../session.js";

export function registerAuditHandlers(): void {
  auditLogger.info("Registering Audit IPC handlers");

  ipcMain.handle("audit:get-recent", (e, limit?: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const service = getAuditService();
      const rows = service.getRecent(limit);
      return { success: true, rows };
    } catch (error) {
      auditLogger.error({ error }, "audit:get-recent failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get audit logs",
      };
    }
  });

  ipcMain.handle("audit:search", (e, filters: AuditFilters) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const service = getAuditService();
      const result = service.search(filters ?? {});
      return { success: true, ...result };
    } catch (error) {
      auditLogger.error({ error }, "audit:search failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to search audit logs",
      };
    }
  });

  ipcMain.handle(
    "audit:get-by-entity",
    (e, entityType: string, entityId: string) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const service = getAuditService();
        const rows = service.getByEntity(entityType, entityId);
        return { success: true, rows };
      } catch (error) {
        auditLogger.error({ error }, "audit:get-by-entity failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to get entity audit logs",
        };
      }
    },
  );

  auditLogger.info("Audit IPC handlers registered");
}
