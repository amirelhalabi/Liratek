import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  getCustomServiceService,
  createCustomServiceSchema,
  updateCustomServiceFulfillmentSchema,
} from "@liratek/core";
import { auditRest } from "../middleware/audit.js";
import { logger } from "../server.js";

const router = express.Router();

// All custom-services routes require auth
router.use(authenticateJWT);

// GET /api/custom-services - List services (optional ?date=YYYY-MM-DD)
router.get("/", (req, res): void => {
  try {
    const service = getCustomServiceService();
    const filter = req.query.date
      ? { date: String(req.query.date) }
      : undefined;
    const services = service.getServices(filter);
    res.json({ success: true, services });
  } catch (error) {
    logger.error({ error }, "Get custom services error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch custom services" });
  }
});

// GET /api/custom-services/summary - Today's summary stats
router.get("/summary", (_req, res): void => {
  try {
    const service = getCustomServiceService();
    const summary = service.getTodaySummary();
    res.json({ success: true, summary });
  } catch (error) {
    logger.error({ error }, "Get custom services summary error");
    res.status(500).json({ success: false, error: "Failed to fetch summary" });
  }
});

// POST /api/custom-services/fulfillment - Advance fulfilment status
// Matches customServiceHandlers.ts's "custom-services:advance-fulfillment"
// IPC gate (admin + staff — rule 19(c): requireRole must match the desktop
// handler). Static path, registered before /:id (rule 19 convention) — the
// same shape as every other "update-metadata"-style route in this codebase
// (exchange, debts, recharge, loto): `id` travels in the body, validated by
// the SAME schema the IPC handler validates against (rule 14).
router.post(
  "/fulfillment",
  requireRole(["admin", "staff"]),
  validateRequest(updateCustomServiceFulfillmentSchema),
  (req, res): void => {
    try {
      const service = getCustomServiceService();
      const result = service.advanceFulfillmentStatus(
        req.body.id,
        req.body.fulfillment_status,
      );

      if (!result.success) {
        // Rule 19(c) envelope parity — see the POST "/" route below: HTTP
        // 200 even on a business rejection (illegal transition, not found),
        // never a 4xx that would replace the operator-facing reason with a
        // generic network error.
        res.json(result);
        return;
      }

      // Mirrors customServiceHandlers.ts's custom-services:advance-fulfillment
      // audit.
      auditRest(req, {
        action: "advance_fulfillment",
        entity_type: "custom_service",
        entity_id: String(req.body.id),
        summary: `Custom service #${req.body.id} fulfilment -> ${req.body.fulfillment_status}`,
      });

      res.json({ success: true, data: result.entity });
    } catch (error) {
      logger.error({ error }, "Advance custom service fulfilment error");
      res
        .status(500)
        .json({ success: false, error: "Failed to update fulfilment status" });
    }
  },
);

// GET /api/custom-services/:id - Get single service
router.get("/:id", (req, res): void => {
  try {
    const service = getCustomServiceService();
    const record = service.getServiceById(Number(req.params.id));
    if (!record) {
      res.status(404).json({ success: false, error: "Service not found" });
      return;
    }
    res.json({ success: true, service: record });
  } catch (error) {
    logger.error({ error }, "Get custom service error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch custom service" });
  }
});

// POST /api/custom-services - Create service
// Matches customServiceHandlers.ts's "custom-services:add" IPC gate
// (admin only) — rule 19(c): requireRole must match the desktop handler.
router.post(
  "/",
  requireRole(["admin"]),
  validateRequest(createCustomServiceSchema),
  (req, res): void => {
    try {
      const service = getCustomServiceService();
      const result = service.addService(req.body);

      if (!result.success) {
        // Rule 19(c) envelope parity: a BUSINESS failure answers HTTP 200 with
        // { success:false, error } exactly as the IPC channel does. The adapter
        // branches on result.success, never on the status code, and
        // requestJson throws on a non-2xx — so a 400 here replaced the
        // operator-facing reason (e.g. "a via-partner service needs a partner")
        // with a generic network error. 4xx stays for genuine protocol faults
        // (malformed id, missing auth), not for a rule the service rejected.
        res.json(result);
        return;
      }

      // Mirrors customServiceHandlers.ts's custom-services:add audit.
      auditRest(req, {
        action: "create",
        entity_type: "custom_service",
        summary: `Custom service: ${req.body.description}`,
        metadata: {
          description: req.body.description,
          paid_by: req.body.paid_by,
        },
      });

      res.json(result);
    } catch (error) {
      logger.error({ error }, "Create custom service error");
      res
        .status(500)
        .json({ success: false, error: "Failed to create custom service" });
    }
  },
);

// DELETE /api/custom-services/:id - Delete service
// Matches customServiceHandlers.ts's "custom-services:delete" IPC gate
// (admin only) — rule 19(c): requireRole must match the desktop handler.
router.delete("/:id", requireRole(["admin"]), (req, res): void => {
  try {
    const id = Number(req.params.id);
    const service = getCustomServiceService();
    const result = service.deleteService(id);

    if (!result.success) {
      // Rule 19(c) envelope parity - see the POST route above.
      res.json(result);
      return;
    }

    // Mirrors customServiceHandlers.ts's custom-services:delete audit.
    auditRest(req, {
      action: "delete",
      entity_type: "custom_service",
      entity_id: String(id),
      summary: `Deleted custom service #${id}`,
    });

    res.json(result);
  } catch (error) {
    logger.error({ error }, "Delete custom service error");
    res
      .status(500)
      .json({ success: false, error: "Failed to delete custom service" });
  }
});

export default router;
