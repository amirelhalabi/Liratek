import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { getItemCostService, setItemCostSchema } from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
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

// POST /api/item-costs - Save/update an item cost. Validated against core's
// setItemCostSchema — the same schema item-costs:set uses on desktop
// (rule 14); a refusal is the HTTP 200 `{ success: false, error }` envelope
// (rule 19c), not the old hand-rolled 400.
router.post(
  "/",
  requireRole(["admin"]),
  validateRequest(setItemCostSchema),
  (req, res): void => {
    try {
      const { provider, category, itemKey, cost, currency } = req.body;
      const itemCostService = getItemCostService();
      // setCost catches its own DB errors and reports them in its result —
      // return that result, never a blanket `{ success: true }`.
      const result = itemCostService.setCost(
        provider,
        category,
        itemKey,
        cost,
        currency,
      );

      if (result.success) {
        // Mirrors itemCostHandlers.ts's item-costs:set audit.
        auditRest(req, {
          action: "update",
          entity_type: "item_cost",
          entity_id: `${provider}:${category}:${itemKey}`,
          summary: `Set cost for ${provider}/${itemKey}: ${cost} ${currency}`,
        });
      }

      res.json(result);
    } catch (error) {
      logger.error({ error }, "Set item cost error");
      res
        .status(500)
        .json({ success: false, error: "Failed to save item cost" });
    }
  },
);

export default router;
