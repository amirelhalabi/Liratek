/**
 * Rates API Endpoints
 *
 * Handles exchange rate management
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { getRateService, setRateSchema } from "@liratek/core";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = Router();
const rateService = getRateService();

// GET /api/rates
router.get("/", requireAuth, async (_req, res) => {
  try {
    const rates = rateService.listRates();
    res.json({ success: true, rates });
  } catch (error) {
    logger.error({ error }, "List rates error");
    res.status(500).json({ success: false, error: "Failed to list rates" });
  }
});

// POST /api/rates
router.post(
  "/",
  requireAuth,
  requireRole(["admin"]),
  validateRequest(setRateSchema),
  async (req, res) => {
    try {
      const result = rateService.setRate(req.body);

      if (result.success) {
        logger.info(
          {
            fromCurrency: req.body.fromCurrency,
            toCurrency: req.body.toCurrency,
            rate: req.body.rate,
          },
          "Exchange rate set",
        );
        // Mirrors rateHandlers.ts's rates:set audit (update/exchange_rate).
        auditRest(req, {
          action: "update",
          entity_type: "exchange_rate",
          entity_id: req.body.to_code,
          summary: `Set rate USD→${req.body.to_code}: market=${req.body.market_rate}, buy=${req.body.buy_rate}, sell=${req.body.sell_rate}`,
          new_values: {
            market_rate: req.body.market_rate,
            buy_rate: req.body.buy_rate,
            sell_rate: req.body.sell_rate,
            is_stronger: req.body.is_stronger,
          },
        });
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error({ error }, "Set rate error");
      res.status(500).json({ success: false, error: "Failed to set rate" });
    }
  },
);

// DELETE /api/rates/:fromCurrency/:toCurrency
router.delete(
  "/:fromCurrency/:toCurrency",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const { fromCurrency, toCurrency } = req.params;
      const result = rateService.deleteRate(fromCurrency, toCurrency);

      if (result.success) {
        logger.info({ fromCurrency, toCurrency }, "Exchange rate deleted");
        // Mirrors rateHandlers.ts's rates:delete audit (delete/exchange_rate).
        auditRest(req, {
          action: "delete",
          entity_type: "exchange_rate",
          entity_id: toCurrency,
          summary: `Deleted rate USD→${toCurrency}`,
        });
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error({ error }, "Delete rate error");
      res.status(500).json({ success: false, error: "Failed to delete rate" });
    }
  },
);

export default router;
