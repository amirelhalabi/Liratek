import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getMobileServiceItemService,
  mobileServiceItemCreateSchema,
  mobileServiceItemUpdateSchema,
} from "@liratek/core";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// Mobile Service Items (dynamic catalog). LIRA W6.b scoped this route to
// ONLY the ops the Settings manager's editable validity-days/credits fields
// exercise: admin listing + update. create/delete/toggle/seed/public-list
// remain desktop-IPC-only (pre-existing gap predating this ticket — see the
// W6 report) — retrofitting the full CRUD surface to REST is a separate,
// larger effort.
router.use(authenticateJWT);

// GET /api/mobile-service-items — all active items (public catalog read).
// No role gate — mirrors the IPC `mobile-service-items:get-all` handler.
router.get("/", (_req, res): void => {
  try {
    const service = getMobileServiceItemService();
    const data = service.getAll();
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Get mobile service items error");
    res.status(500).json({ success: false, error: "Failed to get items" });
  }
});

// GET /api/mobile-service-items/admin — every item including inactive
// (the Settings manager's list).
router.get("/admin", requireRole(["admin"]), (_req, res): void => {
  try {
    const service = getMobileServiceItemService();
    const data = service.getAllIncludingInactive();
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Get mobile service items (admin) error");
    res.status(500).json({ success: false, error: "Failed to get items" });
  }
});

// POST /api/mobile-service-items (admin) — create a new catalog item
// (LIRA-090: mirrors the `mobile-service-items:create` IPC handler, adding
// the three LIRA-090 split columns to the shared schema — rule 14/19).
// Validated against `mobileServiceItemCreateSchema` from @liratek/core.
router.post("/", requireRole(["admin"]), (req, res): void => {
  const parsed = mobileServiceItemCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    res.status(400).json({
      success: false,
      error: firstIssue?.message ?? "Invalid mobile service item payload",
    });
    return;
  }
  try {
    const service = getMobileServiceItemService();
    const result = service.create(parsed.data);
    if (result.success) {
      // Mirrors mobileServiceItemHandlers.ts's mobile-service-items:create
      // audit (create/mobile_service_item).
      auditRest(req, {
        action: "create",
        entity_type: "mobile_service_item",
        summary: `Created mobile service item: ${parsed.data.label} (${parsed.data.provider})`,
      });
    }
    res.status(result.success ? 201 : 400).json(result);
  } catch (error) {
    logger.error({ error }, "Create mobile service item error");
    res.status(500).json({ success: false, error: "Failed to create item" });
  }
});

// PUT /api/mobile-service-items/:id (admin) — validated against the SAME
// schema the IPC handler uses (rule 14/19).
router.put("/:id", requireRole(["admin"]), (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }
  const parsed = mobileServiceItemUpdateSchema.safeParse({
    ...req.body,
    id,
  });
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    res.status(400).json({
      success: false,
      error: firstIssue?.message ?? "Invalid mobile service item payload",
    });
    return;
  }
  try {
    const { id: _id, ...data } = parsed.data;
    void _id; // stripped from the payload — the URL param is authoritative
    const service = getMobileServiceItemService();
    const result = service.update(id, data);
    if (result.success) {
      // Mirrors mobileServiceItemHandlers.ts's mobile-service-items:update
      // audit (update/mobile_service_item).
      auditRest(req, {
        action: "update",
        entity_type: "mobile_service_item",
        entity_id: String(id),
        summary: `Updated mobile service item #${id}`,
      });
    }
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error({ error }, "Update mobile service item error");
    res.status(500).json({ success: false, error: "Failed to update" });
  }
});

export default router;
