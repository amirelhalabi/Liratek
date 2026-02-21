/**
 * Activity API Endpoints
 *
 * Handles activity log queries
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getActivityService } from "@liratek/core";
import { logger } from "../server.js";

const router = Router();
const activityService = getActivityService();

// GET /api/activity/recent
router.get("/recent", requireAuth, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const activities = activityService.getRecentLogs(limit);
    res.json({ success: true, activities });
  } catch (error) {
    logger.error({ error }, "Get recent activity error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get activity logs" });
  }
});

export default router;
