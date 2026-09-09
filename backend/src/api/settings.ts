import express from "express";
import { getSettingsService } from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// GET /api/settings - Get all settings
// Everything in this router requires auth, INCLUDING the list below.
//
// GET / used to sit ABOVE this line, described as deliberately open so the
// login page could render a shop name. That was broken in a way nobody
// noticed: with no `authenticateJWT`, no tenant context is ever
// established -- so the read failed even for a signed-in user, the service
// swallowed the TenantContextError into an empty array, and the route
// answered 200 with `settings: []`. Shop Config showed blank fields and
// saving appeared not to persist, because the WRITE worked and the READ
// always came back empty.
//
// The login page no longer needs it: the header shows the product name
// until a shop is known, and FeatureFlagContext gates its own fetch on
// authentication.
router.use(authenticateJWT);

// GET /api/settings — every setting for the signed-in tenant
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

// GET /api/settings/:key - Get a specific setting
//
// DELIBERATELY left open to ANY authenticated role (no requireRole here) —
// settings drive UI rendering for every role, and SettingsService already
// redacts sensitive keys (SENSITIVE_SETTING_KEYS, e.g. the profits password
// hash) service-side, so an authenticated staff read of an arbitrary key
// cannot leak anything sensitive. This is a choice, not the oversight the
// PUT below used to be (LIRA-178).
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
//
// LIRA-178: admin-only, mirroring the IPC twins `db:update-setting` and
// `settings:update` (electron-app/handlers/dbHandlers.ts), which both call
// requireRole(e.sender.id, ["admin"]). Before this fix, ANY authenticated
// role (staff included) could write ANY row in system_settings over REST —
// e.g. flipping `setup_complete` back to 0 sends the whole app back into the
// setup wizard. Do NOT remove the SENSITIVE_SETTING_KEYS write guard in
// SettingsService.updateSetting on the strength of this route-level fix —
// that guard is defence in depth for a table reachable from several ungated
// read surfaces (this GET /:key route and GET / above).
router.put("/:key", requireRole(["admin"]), async (req, res): Promise<void> => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      res.status(400).json({ success: false, error: "Value is required" });
      return;
    }

    const settingsService = getSettingsService();
    // Must propagate the service's result rather than assume success: e.g.
    // the SENSITIVE_SETTING_KEYS guard (SettingsService.updateSetting)
    // rejects writes to the profits password key with
    // { success: false, error }. The IPC twins `db:update-setting` /
    // `settings:update` (electron-app/handlers/dbHandlers.ts) both
    // `return result` — if this route hardcodes { success: true } it lies
    // about a write that never happened and drifts out of parity with them.
    const result = await settingsService.updateSetting(key, value);

    if (!result.success) {
      // Envelope failure, not HTTP failure (rule 19c) — and no audit row
      // for a write that was rejected, not performed.
      res.json(result);
      return;
    }

    // Mirrors dbHandlers.ts's db:update-setting/settings:update audit
    // (update/setting).
    auditRest(req as AuthRequest, {
      action: "update",
      entity_type: "setting",
      entity_id: key,
      summary: `Updated setting "${key}"`,
      new_values: { value },
    });

    res.json(result);
  } catch (error) {
    logger.error({ error }, "Update setting error");
    res.status(500).json({ success: false, error: "Failed to update setting" });
  }
});

export default router;
