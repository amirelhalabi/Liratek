import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getMobileServiceItemService,
  mobileServiceItemCreateSchema,
  mobileServiceItemUpdateSchema,
  mobileServiceItemSeedSchema,
} from "@liratek/core";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// Mobile Service Items (dynamic catalog). LIRA W6.b scoped this route to
// ONLY the ops the Settings manager's editable validity-days/credits fields
// exercise: admin listing + update; count/seed were added next (the "Reset
// Data" feature wipes this table and relies on a re-seed on next load — a
// gap the web transport had NO recovery path for at all, rule 19b), then
// create. delete + toggle-active are the last two ops — the Settings
// catalog manager (`MobileServicesManager.tsx`) called
// `window.api.mobileServiceItems.delete/toggleActive` directly, which is
// `undefined` in a browser and made the WHOLE panel report "Failed to load"
// (the `count()` call above it threw first, during `load()`). Every op the
// manager needs is now mirrored here — no gap left in this feature.
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
    // Rule 19c envelope parity: a business-rule failure from the service
    // (e.g. duplicate label) is a HANDLED failure, not a malformed request —
    // it must stay HTTP 2xx so requestJson() resolves to {success:false}
    // instead of throwing (same fix as this file's toggle-active/delete
    // routes below). 201 is kept on success only because it's still a 2xx
    // `res.ok` status that requestJson() never distinguishes from 200.
    res.status(result.success ? 201 : 200).json(result);
  } catch (error) {
    logger.error({ error }, "Create mobile service item error");
    res.status(500).json({ success: false, error: "Failed to create item" });
  }
});

// GET /api/mobile-service-items/count — total catalog row count. Mirrors the
// IPC `mobile-service-items:count` handler, which has no role gate beyond an
// authenticated session — auth only, matching this router's existing
// authenticateJWT (no requireRole). Static path, declared before PUT /:id.
//
// Used by MobileServiceItemsContext to decide whether the catalog needs
// re-seeding (count === 0) — the same check that runs on desktop, now
// reachable on the web transport.
//
// HTTP 200 even on failure (rule 19c): the IPC handler always resolves to an
// envelope, never throws, and the frontend's requestJson() throws on any
// non-2xx status — a 500 here would make the web path abort differently from
// desktop's swallowed {success:false}.
router.get("/count", (_req, res): void => {
  try {
    const service = getMobileServiceItemService();
    const data = service.getCount();
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Count mobile service items error");
    res.status(200).json({ success: false, error: "Failed to count items" });
  }
});

// POST /api/mobile-service-items/seed (admin/staff) — bulk-insert the
// fresh-install catalog; `seedFromCatalog` itself is the guard that no-ops
// when the table is already populated. Mirrors the IPC
// `mobile-service-items:seed` handler: SAME roles, and validated against the
// SAME core Zod schema (`mobileServiceItemSeedSchema` — rule 14, not
// redefined here). Static path, declared before PUT /:id.
//
// HTTP 200 even on failure (rule 19c) — same reasoning as GET /count above:
// requestJson() throws on any non-2xx, which would abort
// MobileServiceItemsContext.load() before its Promise.all() runs (dropping
// the sibling getItemCosts()/getVoucherImages() calls too), a failure mode
// the IPC transport never has.
router.post("/seed", requireRole(["admin", "staff"]), (req, res): void => {
  const parsed = mobileServiceItemSeedSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    res.status(200).json({
      success: false,
      error: firstIssue?.message ?? "Invalid seed payload",
    });
    return;
  }
  try {
    const service = getMobileServiceItemService();
    const result = service.seedFromCatalog(parsed.data);
    if (result.success) {
      // Mirrors mobileServiceItemHandlers.ts's mobile-service-items:seed
      // audit (create/mobile_service_item). Gated on result.success, per
      // auditRest's own contract (audit.ts) — unlike the IPC helper, which
      // audits unconditionally, this file's REST audits only real writes.
      auditRest(req, {
        action: "create",
        entity_type: "mobile_service_item",
        summary: `Seeded ${result.count ?? 0} mobile service items from catalog`,
      });
    }
    res.status(200).json(result);
  } catch (error) {
    logger.error({ error }, "Seed mobile service items error");
    res.status(200).json({ success: false, error: "Failed to seed items" });
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
    // Rule 19c envelope parity: a business-rule failure from the service
    // (e.g. "Item not found") is a HANDLED failure — HTTP 200 always, so
    // requestJson() resolves to {success:false} instead of throwing.
    res.status(200).json(result);
  } catch (error) {
    logger.error({ error }, "Update mobile service item error");
    res.status(500).json({ success: false, error: "Failed to update" });
  }
});

// PUT /api/mobile-service-items/:id/toggle-active (admin) — flips is_active.
// Mirrors the IPC `mobile-service-items:toggle-active` handler: same role,
// same service call, no request body (nothing to validate). Static-ish path
// (`/:id/toggle-active`, two segments) never collides with `/:id` (one
// segment) or `/:id`'s PUT above regardless of declaration order, but it's
// placed right after PUT /:id for readability.
router.put(
  "/:id/toggle-active",
  requireRole(["admin"]),
  (req, res): void => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, error: "Invalid id" });
      return;
    }
    try {
      const service = getMobileServiceItemService();
      const result = service.toggleActive(id);
      if (result.success) {
        // Mirrors mobileServiceItemHandlers.ts's
        // mobile-service-items:toggle-active audit (toggle/mobile_service_item)
        // action/entity, but NOT its unconditional call site: the IPC handler
        // calls `audit(...)` even when `result.success` is false, logging a
        // "Toggled #N" row for a toggle that never happened. `auditRest`'s own
        // contract (audit.ts) is explicit that callers gate on
        // `result.success` first — a failed toggle is not an action taken, so
        // it is not worth an audit row. This is a deliberate REST/IPC
        // divergence (the IPC side's unconditional audit is the one out of
        // step with the documented contract), not an oversight.
        auditRest(req, {
          action: "toggle",
          entity_type: "mobile_service_item",
          entity_id: String(id),
          summary: `Toggled mobile service item #${id}`,
        });
      }
      // Rule 19c envelope parity: a business-rule failure from the service
      // (e.g. "Item not found") is a HANDLED failure — HTTP 200 always, so
      // requestJson() resolves to {success:false} instead of throwing an
      // ApiError the adapter's caller never expects.
      res.status(200).json(result);
    } catch (error) {
      logger.error({ error }, "Toggle mobile service item error");
      res.status(500).json({ success: false, error: "Failed to toggle item" });
    }
  },
);

// DELETE /api/mobile-service-items/:id (admin) — hard delete. Mirrors the
// IPC `mobile-service-items:delete` handler: same role, same service call.
router.delete("/:id", requireRole(["admin"]), (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }
  try {
    const service = getMobileServiceItemService();
    const result = service.deleteItem(id);
    if (result.success) {
      // Mirrors mobileServiceItemHandlers.ts's mobile-service-items:delete
      // audit (delete/mobile_service_item) action/entity, but NOT its
      // unconditional call site: the IPC handler calls `audit(...)` even
      // when `result.success` is false, logging a "Deleted #N" row for an
      // item that was never deleted. `auditRest`'s own contract (audit.ts)
      // is explicit that callers gate on `result.success` first — a failed
      // delete is not an action taken, so it is not worth an audit row (and
      // would actively mislead anyone reading the audit log later). This is
      // a deliberate REST/IPC divergence (the IPC side's unconditional audit
      // is the one out of step with the documented contract), not an
      // oversight.
      auditRest(req, {
        action: "delete",
        entity_type: "mobile_service_item",
        entity_id: String(id),
        summary: `Deleted mobile service item #${id}`,
      });
    }
    // Rule 19c envelope parity: a business-rule failure from the service
    // (e.g. "Item not found") is a HANDLED failure — HTTP 200 always, so
    // requestJson() resolves to {success:false} instead of throwing an
    // ApiError the adapter's caller never expects.
    res.status(200).json(result);
  } catch (error) {
    logger.error({ error }, "Delete mobile service item error");
    res.status(500).json({ success: false, error: "Failed to delete item" });
  }
});

export default router;
