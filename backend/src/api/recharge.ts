import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { getRechargeService, createRechargeSchema } from "@liratek/core";
import { logger } from "../server.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = express.Router();

// All recharge routes require auth
router.use(authenticateJWT);

// GET /api/recharge/stock - Get virtual stock
// Deliberately NOT role-gated: rule 19c means matching the IPC twin, and
// `recharge:get-stock` (rechargeHandlers.ts:30) has no role check — any
// authenticated session may read stock on desktop. Adding requireRole here
// would make web STRICTER than desktop and 401 staff users on a read.
// If stock should be admin-only, that is a separate decision and must change
// BOTH transports together.
router.get("/stock", (_req, res): void => {
  try {
    const rechargeService = getRechargeService();
    const stock = rechargeService.getStock();
    res.json({ success: true, stock });
  } catch (error) {
    logger.error({ error }, "Get recharge stock error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch recharge stock" });
  }
});

// POST /api/recharge/process - Process recharge transaction
// Role-parity with the desktop IPC handler (recharge:process requires
// requireRole(["admin"]) — rechargeHandlers.ts:51); this route previously had
// no role check at all, so any authenticated web user (any role) could move
// the MTC/Alfa drawers.
//
// `createRechargeSchema` is THE shared contract (rules 14 + 19b): the IPC
// handler validates against the same object, re-exported as `RechargeSchema`
// from electron-app/schemas/index.ts. That matters here because
// `validateRequest` REPLACES the body with the parse result, so anything the
// schema doesn't declare is dropped before the service sees it — which is how
// this route used to lose every split payment leg (CARRIER_LINES_VALIDITY_PLAN.md
// Phase 6a; guarded by __tests__/recharge.api.test.ts). Add new recharge fields
// to the core schema, never to a local copy.
router.post(
  "/process",
  requireRole(["admin"]),
  validateRequest(createRechargeSchema),
  async (req, res): Promise<void> => {
    try {
      const rechargeService = getRechargeService();
      const userId = (req as AuthRequest).user!.userId;
      const result = rechargeService.processRecharge({
        ...req.body,
        userId,
      });

      // Match the IPC envelope: HTTP 200 with { success: false, error }
      // even on a business-rule failure (rule 19c) — the frontend adapter
      // branches on result.success, not the status code.
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Process recharge error");
      res
        .status(500)
        .json({ success: false, error: "Failed to process recharge" });
    }
  },
);

export default router;
