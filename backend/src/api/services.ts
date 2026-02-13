import express from "express";
import { authenticateJWT } from "../middleware/auth.js";
import { getFinancialService } from "../services/index.js";
import { logger } from "../server.js";

const router = express.Router();

// All services routes require auth
router.use(authenticateJWT);

// GET /api/services/history - Get transaction history
router.get("/history", (req, res): void => {
  try {
    const provider =
      typeof req.query.provider === "string" ? req.query.provider : undefined;
    const financialService = getFinancialService();
    const history = financialService.getHistory(provider);
    res.json({ success: true, history });
  } catch (error) {
    logger.error({ error }, "Get services history error");
    res.status(500).json({ success: false, error: "Failed to fetch history" });
  }
});

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
router.post("/transactions", async (req, res): Promise<void> => {
  try {
    const financialService = getFinancialService();
    const result = financialService.addTransaction(req.body);

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    logger.error({ error }, "Add service transaction error");
    res
      .status(500)
      .json({ success: false, error: "Failed to add transaction" });
  }
});

export default router;
