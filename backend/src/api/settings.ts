import express from "express";
import { getSettingsService } from "@liratek/core";
import { authenticateJWT, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// GET /api/settings - Get all settings
//
// DELIBERATELY UNAUTHENTICATED (the only open settings endpoint): the web
// frontend reads it BEFORE login — Login.tsx renders the shop name via
// useShopName() → useShopInfo() → api.getAllSettings(), and
// FeatureFlagProvider (mounted above AuthProvider in App.tsx) fires the same
// call at boot. Securing it would blank the login-screen shop name and pin
// feature flags to their defaults. Everything below this route requires auth.
router.get("/", async (_req, res): Promise<void> => {
  try {
    const settingsService = getSettingsService();
    const settings = await settingsService.getAllSettings();
    res.json({ success: true, settings });
  } catch (error) {
    logger.error({ error }, "Get all settings error");
    res.status(500).json({ success: false, error: "Failed to fetch settings" });
  }
});

// All remaining settings routes require auth (WP2 — this router previously
// mounted with NO auth at all).
router.use(authenticateJWT);

// GET /api/settings/:key - Get a specific setting
router.get("/:key", async (req, res): Promise<void> => {
  try {
    const { key } = req.params;
    const settingsService = getSettingsService();
    const setting = await settingsService.getSetting(key);

    if (!setting) {
      res.status(404).json({ success: false, error: "Setting not found" });
      return;
    }

    res.json({ success: true, setting });
  } catch (error) {
    logger.error({ error }, "Get setting error");
    res.status(500).json({ success: false, error: "Failed to fetch setting" });
  }
});

// PUT /api/settings/:key - Update a setting
router.put("/:key", async (req, res): Promise<void> => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      res.status(400).json({ success: false, error: "Value is required" });
      return;
    }

    const settingsService = getSettingsService();
    await settingsService.updateSetting(key, value);

    // Mirrors dbHandlers.ts's db:update-setting/settings:update audit
    // (update/setting).
    auditRest(req as AuthRequest, {
      action: "update",
      entity_type: "setting",
      entity_id: key,
      summary: `Updated setting "${key}"`,
      new_values: { value },
    });

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Update setting error");
    res.status(500).json({ success: false, error: "Failed to update setting" });
  }
});

export default router;
