/**
 * Audit-log REST routes — HTTP twin of electron-app/handlers/auditHandlers.ts.
 *
 * Read-only access to the user-action audit trail (distinct from /api/activity,
 * which is the sync/activity log). No money movement. Envelopes mirror IPC:
 * search → `{ success, rows, total }`, recent/by-entity → `{ success, rows }`,
 * HTTP 200 even on failure. Tenant-scoped via authenticateJWT → runWithTenant
 * (AuditRepository scopes by getCurrentTenantId).
 *
 * LIRA-198: the /audit page is no longer admin_only, so every read route
 * here is open to admin AND staff, byte-identical to the IPC role sets in
 * auditHandlers.ts (rule 19c). There are no write routes on this surface.
 */
import express from "express";
import { getAuditService, type AuditFilters } from "@liratek/core";
import { authenticateJWT, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticateJWT);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

// GET /api/audit/recent?limit= (admin + staff — LIRA-198)
// No current consumer: the adapter exposes audit.getRecent
// (frontend/src/api/backendApi.ts:4568-4577, ElectronApiAdapter.ts:813) but
// nothing in frontend/src or packages/ui/src calls it — the Audit Log tab
// (AuditLogViewer.tsx) drives entirely off audit.search. Widened anyway per
// the owner's BROAD-scope decision; this note is so a future reader does not
// mistake this for a live path. Its IPC twin audit:get-recent
// (electron-app/handlers/auditHandlers.ts) carries the identical note.
router.get("/recent", requireRole(["admin", "staff"]), (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json({ success: true, rows: getAuditService().getRecent(limit) });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/audit/by-entity?entityType=&entityId= (admin + staff)
router.get("/by-entity", requireRole(["admin", "staff"]), (req, res) => {
  try {
    const { entityType, entityId } = req.query as {
      entityType?: string;
      entityId?: string;
    };
    if (!entityType || !entityId) {
      res.json({
        success: false,
        error: "entityType and entityId are required",
      });
      return;
    }
    res.json({
      success: true,
      rows: getAuditService().getByEntity(entityType, entityId),
    });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/audit/search (admin + staff — LIRA-198; the /audit Audit Log
// tab's ONLY data call, AuditLogViewer.tsx:73). POST, but a READ: the filter
// object is too rich for a query string. Roles match the IPC twin
// audit:search.
router.post("/search", requireRole(["admin", "staff"]), (req, res) => {
  try {
    const filters = (req.body ?? {}) as AuditFilters;
    const result = getAuditService().search(filters);
    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

export default router;
