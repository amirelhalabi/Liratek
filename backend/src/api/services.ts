import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import {
  getFinancialService,
  createFinancialServiceSchema,
  getFinancialServicesSchema,
} from "@liratek/core";
import { logger } from "../server.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = express.Router();

// All services routes require auth
router.use(authenticateJWT);

// GET /api/services/history - Get transaction history
router.get(
  "/history",
  validateQuery(getFinancialServicesSchema),
  (req, res): void => {
    try {
      const provider = req.query.provider as string | undefined;
      const financialService = getFinancialService();
      const history = financialService.getHistory(provider);
      res.json({ success: true, history });
    } catch (error) {
      logger.error({ error }, "Get services history error");
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch history" });
    }
  },
);

// GET /api/services/analytics - Get analytics (today & month totals)
router.get("/analytics", (_req, res): void => {
  try {
    const financialService = getFinancialService();
    const analytics = financialService.getAnalytics();
    res.json({ success: true, analytics });
  } catch (error) {
    logger.error({ error }, "Get services analytics error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch analytics" });
  }
});

// POST /api/services/transactions - Add transaction
// Role-parity with the desktop IPC handler (electron-app/handlers/omtHandlers.ts
// requires ["admin", "staff"] via requireRole before validating/writing) — this
// route previously had no role check at all, so any authenticated web user
// (any role) could post a financial-service transaction the desktop app
// restricts to admin/staff.
router.post(
  "/transactions",
  requireRole(["admin", "staff"]),
  validateRequest(createFinancialServiceSchema),
  async (req, res): Promise<void> => {
    try {
      const financialService = getFinancialService();
      const userId = (req as AuthRequest).user!.userId;
      const result = financialService.addTransaction({
        ...req.body,
        userId,
      });

      // Match the IPC envelope: HTTP 200 with { success: false, error }
      // even on a business-rule failure (rule 19c) — the frontend adapter
      // branches on result.success, not the status code.
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Add service transaction error");
      res
        .status(500)
        .json({ success: false, error: "Failed to add transaction" });
    }
  },
);

export default router;
