/**
 * Audit-log REST routes — HTTP twin of electron-app/handlers/auditHandlers.ts.
 *
 * Read-only access to the user-action audit trail (distinct from /api/activity,
 * which is the sync/activity log). No money movement. Envelopes mirror IPC:
 * search → `{ success, rows, total }`, recent/by-entity → `{ success, rows }`,
 * HTTP 200 even on failure. Tenant-scoped via authenticateJWT → runWithTenant
 * (AuditRepository scopes by getCurrentTenantId).
 */
import express from "express";
import { getAuditService, type AuditFilters } from "@liratek/core";
import { authenticateJWT, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticateJWT);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

// GET /api/audit/recent?limit= (admin)
router.get("/recent", requireRole(["admin"]), (req, res) => {
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

// POST /api/audit/search (admin) — filters in the body (rich filter object)
router.post("/search", requireRole(["admin"]), (req, res) => {
  try {
    const filters = (req.body ?? {}) as AuditFilters;
    const result = getAuditService().search(filters);
    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

export default router;
