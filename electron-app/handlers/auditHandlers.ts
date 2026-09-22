/**
 * Audit Log IPC Handlers
 *
 * Provides read-only access to the audit log for the frontend.
 * Read paths are open to admin AND staff (LIRA-198): the /audit page is no
 * longer admin_only, so its viewer must load for staff too. There are no
 * write channels here — audit rows are written server-side by
 * auditHelper.ts, never by the renderer. REST twins in
 * backend/src/api/audit.ts carry the IDENTICAL role sets (rule 19c).
 */

import { ipcMain } from "electron";
import { getAuditService, auditLogger } from "@liratek/core";
import type { AuditFilters } from "@liratek/core";
import { requireRole } from "../session.js";

export function registerAuditHandlers(): void {
  auditLogger.info("Registering Audit IPC handlers");

  // No current consumer: the preload binding exists (audit.getRecent) but
  // nothing in frontend/src calls it — the Audit Log tab (AuditLogViewer.tsx)
  // drives entirely off audit:search. Widened to staff anyway per the
  // owner's BROAD-scope decision; this note is so a future reader does not
  // mistake this for a live path. Its REST twin GET /api/audit/recent
  // (backend/src/api/audit.ts) carries the identical note.
  ipcMain.handle("audit:get-recent", (e, limit?: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin", "staff"]);
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
      const auth = requireRole(e.sender.id, ["admin", "staff"]);
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
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
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
