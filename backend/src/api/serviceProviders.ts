/**
 * Service Provider REST routes — the web-transport mirror of
 * electron-app/handlers/serviceProviderHandlers.ts
 * (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4a).
 *
 * Only the read path needed by the Partners "System Association" dropdown
 * is exposed here. `authenticateJWT` only — no additional `requireRole`,
 * mirroring GET /api/payment-methods/active (paymentMethods.ts) and the
 * GET /api/partners reads (partners.ts): config-table/list reads are open
 * to any authenticated role in this codebase, matching the IPC handler and
 * the `/partners` page itself (no extra role restriction).
 */

import express from "express";
import { authenticateJWT } from "../middleware/auth.js";
import { getServiceProviderService } from "@liratek/core";
import { logger } from "../server.js";

const router = express.Router();

// All service-provider routes require auth — a role-free READ route is
// still not an auth-free route: authenticateJWT establishes the tenant
// context the repository fail-closes on (mirrors partners.ts's comment).
router.use(authenticateJWT);

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

export default router;
