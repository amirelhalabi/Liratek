import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { getModuleService } from "@liratek/core";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// All module routes require auth
router.use(authenticateJWT);

// GET /api/modules - List all modules
router.get("/", (_req, res): void => {
  try {
    const moduleService = getModuleService();
    const modules = moduleService.getAll();
    res.json({ success: true, modules });
  } catch (error) {
    logger.error({ error }, "List modules error");
    res.status(500).json({ success: false, error: "Failed to fetch modules" });
  }
});

// GET /api/modules/enabled - List enabled modules (for sidebar)
router.get("/enabled", (_req, res): void => {
  try {
    const moduleService = getModuleService();
    const modules = moduleService.getEnabledModules();
    res.json({ success: true, modules });
  } catch (error) {
    logger.error({ error }, "List enabled modules error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch enabled modules" });
  }
});

// GET /api/modules/toggleable - List toggleable (non-system) modules
router.get("/toggleable", (_req, res): void => {
  try {
    const moduleService = getModuleService();
    const modules = moduleService.getToggleableModules();
    res.json({ success: true, modules });
  } catch (error) {
    logger.error({ error }, "List toggleable modules error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch toggleable modules" });
  }
});

// PATCH /api/modules/:key/enabled - Toggle a single module (admin only)
router.patch(
  "/:key/enabled",
  requireRole(["admin"]),
  async (req, res): Promise<void> => {
    try {
      const moduleService = getModuleService();
      const result = moduleService.setModuleEnabled(
        req.params.key,
        req.body.enabled,
      );

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      // Mirrors moduleHandlers.ts's modules:setEnabled audit (toggle/module).
      auditRest(req, {
        action: "toggle",
        entity_type: "module",
        entity_id: req.params.key,
        summary: `${req.body.enabled ? "Enabled" : "Disabled"} module "${req.params.key}"`,
      });

      res.json(result);
    } catch (error) {
      logger.error({ error }, "Toggle module error");
      res
        .status(500)
        .json({ success: false, error: "Failed to toggle module" });
    }
  },
);

// PUT /api/modules/bulk-enabled - Bulk toggle modules (admin only)
router.put(
  "/bulk-enabled",
  requireRole(["admin"]),
  async (req, res): Promise<void> => {
    try {
      const moduleService = getModuleService();
      const result = moduleService.bulkSetEnabled(req.body.updates);

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      // Mirrors moduleHandlers.ts's modules:bulkSetEnabled audit
      // (update/module, bulk — no single entity_id).
      auditRest(req, {
        action: "update",
        entity_type: "module",
        summary: `Bulk toggled ${req.body.updates.length} modules`,
        metadata: { updates: req.body.updates },
      });

      res.json(result);
    } catch (error) {
      logger.error({ error }, "Bulk toggle modules error");
      res
        .status(500)
        .json({ success: false, error: "Failed to bulk toggle modules" });
    }
  },
);

export default router;
