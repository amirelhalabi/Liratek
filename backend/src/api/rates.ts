/**
 * Rates API Endpoints
 *
 * Handles exchange rate management
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { getRateService, setRateSchema } from "@liratek/core";
import { logger } from "../server.js";

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
router.delete("/:fromCurrency/:toCurrency", requireAuth, async (req, res) => {
  try {
    const { fromCurrency, toCurrency } = req.params;
    const result = rateService.deleteRate(fromCurrency, toCurrency);

    if (result.success) {
      logger.info({ fromCurrency, toCurrency }, "Exchange rate deleted");
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logger.error({ error }, "Delete rate error");
    res.status(500).json({ success: false, error: "Failed to delete rate" });
  }
});

export default router;
