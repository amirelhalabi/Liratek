import express from "express";
import { authenticateJWT } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { getRechargeService, createRechargeSchema } from "@liratek/core";
import { logger } from "../server.js";

const router = express.Router();

// All recharge routes require auth
router.use(authenticateJWT);

// GET /api/recharge/stock - Get virtual stock
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
router.post(
  "/process",
  validateRequest(createRechargeSchema),
  async (req, res): Promise<void> => {
    try {
      const rechargeService = getRechargeService();
      const result = rechargeService.processRecharge(req.body);

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

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
