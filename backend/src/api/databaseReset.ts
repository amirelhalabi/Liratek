/**
 * Database Reset API (Settings › Reset Data) — LIRA-165, Phase 3.
 *
 * Web-transport mirror of the desktop IPC handlers `database:resetPreview`
 * and `database:reset` (electron-app/handlers/databaseResetHandlers.ts).
 * Both transports call the SAME `@liratek/core` service/repository — this
 * router adds no logic of its own beyond auth, validation, the envelope,
 * and the post-reset audit entry.
 *
 * Admin-only on both transports (matches the IPC `requireRole("admin")`
 * exactly) — a destructive, irreversible wipe of all operational data must
 * never be reachable by "staff".
 *
 * No file backup on this path. The desktop handler takes a local file
 * backup before wiping and aborts on failure (`docs/plans/todo_plans/
 * DATABASE_RESET_PLAN.md` deviation #5) — that only makes sense on a
 * machine with a user-writable Documents folder and no other durability
 * story. On the server the DB is covered by Litestream continuous
 * replication (see `9cbf937f`), and a stateless REST process has nowhere
 * sensible to write a local file anyway, so `DatabaseResetResult.backupPath`
 * is simply omitted here rather than faked.
 *
 * Tenant scoping: every statement the repository runs carries
 * `WHERE tenant_id = ?` (`DatabaseResetRepository` extends `BaseRepository`),
 * and that scoping is automatic here via `authenticateJWT` -> `runWithTenant`
 * — this file adds no manual tenant plumbing on purpose. A reset must never
 * be able to cross tenants; if that guarantee ever needs to move, it belongs
 * in the repository, not in this route.
 */
import express from "express";
import {
  getDatabaseResetService,
  databaseResetSchema,
  type DatabaseResetPreview,
  type DatabaseResetOutcome,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import { logger } from "../server.js";

const router = express.Router();

// Everything in this router is admin-only. authenticateJWT MUST run first —
// requireRole only reads req.user, so without it req.user is undefined and
// the request would 401 with no `success` field rather than the envelope
// below. Mirrors the IPC channels' requireRole("admin") exactly.
router.use(authenticateJWT, requireRole(["admin"]));

// =============================================================================
// GET /api/database/reset/preview — row counts per wipe-bucket table
// =============================================================================
// Static path declared ahead of the mutating POST below (no parameterised
// segments here, but same "specific reads first" convention as the rest of
// the API).
router.get("/reset/preview", (_req, res) => {
  try {
    const preview: DatabaseResetPreview = getDatabaseResetService().preview();
    res.json({ success: true, data: preview });
  } catch (error) {
    logger.error({ error }, "GET /api/database/reset/preview failed");
    // Rule 19c: IPC-identical envelope — HTTP 200 even on failure. The
    // frontend adapter branches on `result.success`, never on status code.
    res.json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load reset preview",
    });
  }
});

// =============================================================================
// POST /api/database/reset — wipe all operational data for the caller's tenant
// =============================================================================
router.post(
  "/reset",
  validateRequest(databaseResetSchema),
  (req: AuthRequest, res) => {
    try {
      // req.body.confirmation only — the actor (for the audit entry below)
      // comes exclusively from req.user, populated by authenticateJWT from
      // the verified JWT. Never trust a userId/role in the request body.
      const { confirmation } = req.body as { confirmation: string };

      const outcome: DatabaseResetOutcome = getDatabaseResetService().reset({
        confirmation,
      });

      // The service returns an envelope, not the result directly — a wrong
      // confirmation phrase comes back as `{ success: false, error }`
      // WITHOUT throwing, so this branch (not the catch below) is what
      // catches a rejected reset. Nothing was deleted on this path, so
      // nothing is audited as deleted — auditRest is skipped entirely.
      if (!outcome.success || !outcome.data) {
        res.json({
          success: false,
          error: outcome.error ?? "Failed to reset database",
        });
        return;
      }

      const result = outcome.data;

      // audit_log itself is one of the wiped tables (plan deviation #3), so
      // this call — made AFTER the reset has committed successfully, per
      // auditRest's contract — lands as the FIRST row in the fresh table:
      // the reset stays auditable even though it just erased the old trail.
      auditRest(req, {
        action: "delete",
        entity_type: "database",
        entity_id: "reset",
        summary: `Reset database (${result.totalDeleted} rows deleted across ${
          Object.keys(result.deletedRows).length
        } tables)`,
        new_values: {
          deletedRows: result.deletedRows,
          totalDeleted: result.totalDeleted,
        },
      });

      // IPC-identical payload shape: `data` is the raw DatabaseResetResult,
      // matching what the desktop handler returns.
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error({ error }, "POST /api/database/reset failed");
      // A wrong confirmation phrase is handled above via `outcome.success`
      // without throwing — this catch is for genuine thrown errors only.
      // Rule 19c still applies: HTTP 200 + { success: false, error }, same
      // as the IPC handler's return value.
      res.json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to reset database",
      });
    }
  },
);

export default router;
