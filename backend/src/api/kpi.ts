/**
 * LIRA-364 — the Monthly progress read, web side (desktop twin: IPC
 * `kpi:list-snapshots`). Admin-only, read-only, the IPC-identical envelope
 * (HTTP 200 even on failure). Snapshots are created by the automatic capture
 * alone, so there is no write route.
 */
import { Router } from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { getKpiSnapshotService, type KpiProgressResponse } from "@liratek/core";
import { logger } from "../server.js";

const router = Router();

// GET /api/kpi/snapshots — { success, enabled, snapshots }
router.get(
  "/snapshots",
  authenticateJWT,
  requireRole(["admin"]),
  (_req, res) => {
    let body: KpiProgressResponse;
    try {
      body = { success: true, ...getKpiSnapshotService().getProgress() };
    } catch (error) {
      logger.error({ error }, "Monthly progress read failed");
      body = { success: false, error: "Failed to load monthly progress" };
    }
    res.json(body);
  },
);

export default router;
