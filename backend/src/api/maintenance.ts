import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import {
  MaintenanceService,
  saveMaintenanceJobSchema,
  getMaintenanceJobsSchema,
  maintenanceIdParamSchema,
  maintenanceUpdateMetadataSchema,
} from "@liratek/core";
import { auditRest } from "../middleware/audit.js";
import { logger } from "../server.js";

const maintenanceService = new MaintenanceService();

const router = express.Router();

// All maintenance routes require auth
router.use(authenticateJWT);

// GET /api/maintenance/jobs - Get maintenance jobs
router.get(
  "/jobs",
  validateQuery(getMaintenanceJobsSchema),
  (req, res): void => {
    try {
      const statusFilter = req.query.status as string | undefined;
      const jobs = maintenanceService.getJobs(statusFilter);
      res.json({ success: true, jobs });
    } catch (error) {
      logger.error({ error }, "Get maintenance jobs error");
      res.status(500).json({ success: false, error: "Failed to fetch jobs" });
    }
  },
);

// POST /api/maintenance/jobs - Create or update maintenance job (admin and
// staff — LIRA-242 owner decision 2026-09-28: creating a job AND advancing
// its status/editing it are routine cashier work; DELETE below stays
// admin-only). `req.user!.userId` is the acting user (LIRA-246a) — taken
// from the JWT, never the body — recorded on the status-history row this
// save appends.
router.post(
  "/jobs",
  requireRole(["admin", "staff"]),
  validateRequest(saveMaintenanceJobSchema),
  async (req, res): Promise<void> => {
    try {
      const result = maintenanceService.saveJob(req.body, req.user!.userId);

      if (!result.success) {
        // Rule 19c: a service refusal is HTTP 200 + the IPC-identical
        // `{ success: false, error }` — the adapter branches on `success`,
        // and requestJson throws on a non-2xx (LIRA-263).
        res.status(200).json(result);
        return;
      }

      // Mirrors maintenanceHandlers.ts's maintenance:save audit (action
      // branches on whether an id was supplied — create vs update).
      auditRest(req, {
        action: req.body.id ? "update" : "create",
        entity_type: "maintenance_job",
        entity_id: String(req.body.id ?? result.id ?? ""),
        summary: `${req.body.id ? "Updated" : "Created"} maintenance job: ${req.body.device_name}`,
      });

      res.json(result);
    } catch (error) {
      logger.error({ error }, "Save maintenance job error");
      res.status(200).json({ success: false, error: "Failed to save job" });
    }
  },
);

// DELETE /api/maintenance/jobs/:id - Delete maintenance job
router.delete(
  "/jobs/:id",
  requireRole(["admin"]),
  async (req, res): Promise<void> => {
    try {
      // LIRA-306 (rule 23): the shared core schema the IPC handler and the
      // offline replay use; a bad id keeps the HTTP 200 envelope.
      const parsed = maintenanceIdParamSchema.safeParse({ id: req.params.id });
      if (!parsed.success) {
        res.status(200).json({ success: false, error: "Invalid job ID" });
        return;
      }
      const id = parsed.data.id;

      const result = maintenanceService.deleteJob(id);

      if (!result.success) {
        // Rule 19c: a service refusal is HTTP 200 + the IPC-identical
        // `{ success: false, error }` — the adapter branches on `success`,
        // and requestJson throws on a non-2xx (LIRA-263).
        res.status(200).json(result);
        return;
      }

      // Mirrors maintenanceHandlers.ts's maintenance:delete audit.
      auditRest(req, {
        action: "delete",
        entity_type: "maintenance_job",
        entity_id: String(id),
        summary: `Deleted maintenance job #${id}`,
      });

      res.json(result);
    } catch (error) {
      logger.error({ error }, "Delete maintenance job error");
      res.status(200).json({ success: false, error: "Failed to delete job" });
    }
  },
);

// POST /api/maintenance/update-metadata - edit a job's non-financial details
// (client name, device, issue, note). REST twin of the IPC channel
// "maintenance:update-metadata" (LIRA-306 T093 — it had none): same roles
// (admin + staff), the shared core schema, the SAME service method;
// `editedBy` is the JWT's username, never the body. IPC-identical envelope,
// HTTP 200 even on a refusal (rule 19c).
router.post(
  "/update-metadata",
  requireRole(["admin", "staff"]),
  validateRequest(maintenanceUpdateMetadataSchema),
  (req, res): void => {
    try {
      const result = maintenanceService.updateMaintenanceMetadata(
        req.body.id,
        {
          client_name: req.body.client_name,
          device_name: req.body.device_name,
          issue_description: req.body.issue_description,
          note: req.body.note,
        },
        req.user!.username,
      );

      if (
        result.success &&
        result.oldValues &&
        Object.keys(result.oldValues).length > 0
      ) {
        // Mirrors maintenanceHandlers.ts's maintenance:update-metadata audit.
        auditRest(req, {
          action: "edit_metadata",
          entity_type: "maintenance_job",
          entity_id: String(req.body.id),
          summary: `Edited maintenance job #${req.body.id} metadata`,
          old_values: result.oldValues,
          new_values: req.body,
        });
      }

      res
        .status(200)
        .json(
          result.success
            ? { success: true, data: result.entity }
            : { success: false, error: result.error },
        );
    } catch (error) {
      logger.error({ error }, "Update maintenance metadata error");
      res
        .status(200)
        .json({ success: false, error: "Failed to update job details" });
    }
  },
);

// GET /api/maintenance/jobs/:id/history - one job's status transition
// history, chronological (oldest first). Mirrors the IPC
// "maintenance:getStatusHistory" channel, which carries no requireRole call
// of its own (same as "maintenance:get-jobs" above) — so this route adds
// none beyond the router-level authenticateJWT either, to match. `id` is
// parsed manually (not via getMaintenanceStatusHistorySchema through
// validateParams) — that schema's `id` is a plain z.number(), which fails
// against a URL param (always a string) the same way the DELETE route above
// would if it used it; parseInt+isNaN mirrors that proven-working DELETE
// route in this same file instead.
router.get("/jobs/:id/history", (req, res): void => {
  try {
    const jobId = parseInt(req.params.id, 10);
    if (isNaN(jobId)) {
      // Rule 19c: HTTP 200 even on failure.
      res.status(200).json({ success: false, error: "Invalid job ID" });
      return;
    }

    const history = maintenanceService.getStatusHistory(jobId);
    res.status(200).json({ success: true, data: history });
  } catch (error) {
    logger.error({ error }, "Get maintenance status history error");
    res
      .status(200)
      .json({ success: false, error: "Failed to fetch status history" });
  }
});

export default router;
