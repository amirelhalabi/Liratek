import express from "express";
import { authenticateJWT } from "../middleware/auth.js";
import { getItemCostService } from "@liratek/core";
import { logger } from "../server.js";

const router = express.Router();

// All item-costs routes require auth
router.use(authenticateJWT);

// GET /api/item-costs - Get all saved item costs
router.get("/", (_req, res): void => {
  try {
    const itemCostService = getItemCostService();
    const costs = itemCostService.getAllCosts();
    res.json({ success: true, costs });
  } catch (error) {
    logger.error({ error }, "Get item costs error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch item costs" });
  }
});

// POST /api/item-costs - Save/update an item cost
router.post("/", (req, res): void => {
  try {
    const { provider, category, itemKey, cost, currency } = req.body;

    if (!provider || !category || !itemKey || cost === undefined || !currency) {
      res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
      return;
    }

    const itemCostService = getItemCostService();
    itemCostService.setCost(provider, category, itemKey, cost, currency);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Set item cost error");
    res.status(500).json({ success: false, error: "Failed to save item cost" });
  }
});

export default router;
