/**
 * Service Provider REST routes — the web-transport mirror of
 * electron-app/handlers/serviceProviderHandlers.ts.
 *
 * Phase 4a (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b): the read path
 * needed by the Partners "System Association" dropdown (GET /active).
 * `authenticateJWT` only — no additional `requireRole`, mirroring GET
 * /api/payment-methods/active (paymentMethods.ts) and the GET /api/partners
 * reads (partners.ts): config-table/list reads are open to any authenticated
 * role in this codebase, matching the IPC handler and the `/partners` page
 * itself (no extra role restriction).
 *
 * Phase 5 (this addition): the write path (create/update/delete) plus the
 * admin listing (GET /, includes inactive/system rows) — mirrors
 * paymentMethods.ts's REST shape: `requireRole(["admin"])` on every write,
 * `validateRequest` against the SAME core Zod schema the IPC handler uses
 * (rule 14), IPC-identical envelope. See ServiceProviderService's own doc
 * comment for the two money-safety invariants enforced at the service layer
 * (new providers always settle to `General`; `code` is never editable).
 */

import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getServiceProviderService,
  createServiceProviderSchema,
  updateServiceProviderSchema,
} from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import { logger } from "../server.js";

const router = express.Router();

// All service-provider routes require auth — a role-free READ route is
// still not an auth-free route: authenticateJWT establishes the tenant
// context the repository fail-closes on (mirrors partners.ts's comment).
router.use(authenticateJWT);

// GET /api/service-providers - list ALL service providers (including
// inactive/system) — the Settings management UI. Any role (see doc comment).
router.get("/", (_req, res): void => {
  try {
    const service = getServiceProviderService();
    const providers = service.listAll();
    res.json({ success: true, providers });
  } catch (error) {
    logger.error({ error }, "List service providers error");
    res.status(500).json({
      success: false,
      error: "Failed to fetch service providers",
    });
  }
});

// GET /api/service-providers/active - list active service providers
router.get("/active", (_req, res): void => {
  try {
    const service = getServiceProviderService();
    const providers = service.listActive();
    res.json({ success: true, providers });
  } catch (error) {
    logger.error({ error }, "List active service providers error");
    res.status(500).json({
      success: false,
      error: "Failed to fetch active service providers",
    });
  }
});

// POST /api/service-providers - create a service provider (admin)
router.post(
  "/",
  requireRole(["admin"]),
  validateRequest(createServiceProviderSchema),
  (req, res): void => {
    try {
      const service = getServiceProviderService();
      const result = service.createProvider(req.body);
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      // Mirrors serviceProviderHandlers.ts's service-providers:create audit.
      auditRest(req, {
        action: "create",
        entity_type: "service_provider",
        summary: `Created service provider "${req.body.code}"`,
      });
      res.status(201).json(result);
    } catch (error) {
      logger.error({ error }, "Create service provider error");
      res
        .status(500)
        .json({ success: false, error: "Failed to create service provider" });
    }
  },
);

// PUT /api/service-providers/:id - update a service provider (admin)
router.put(
  "/:id",
  requireRole(["admin"]),
  validateRequest(updateServiceProviderSchema),
  (req, res): void => {
    try {
      const service = getServiceProviderService();
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ success: false, error: "Invalid id" });
        return;
      }
      const result = service.updateProvider(id, req.body);
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      // Mirrors serviceProviderHandlers.ts's service-providers:update audit.
      auditRest(req, {
        action: "update",
        entity_type: "service_provider",
        entity_id: String(id),
        summary: `Updated service provider #${id}`,
      });
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Update service provider error");
      res
        .status(500)
        .json({ success: false, error: "Failed to update service provider" });
    }
  },
);

// DELETE /api/service-providers/:id - delete a service provider (admin,
// non-system only — the service/repository rejects a system row)
router.delete("/:id", requireRole(["admin"]), (req, res): void => {
  try {
    const service = getServiceProviderService();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Invalid id" });
      return;
    }
    const result = service.deleteProvider(id);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    // Mirrors serviceProviderHandlers.ts's service-providers:delete audit.
    auditRest(req, {
      action: "delete",
      entity_type: "service_provider",
      entity_id: String(id),
      summary: `Deleted service provider #${id}`,
    });
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Delete service provider error");
    res
      .status(500)
      .json({ success: false, error: "Failed to delete service provider" });
  }
});

export default router;
