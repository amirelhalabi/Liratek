import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import {
  getExchangeService,
  getRateService,
  getCurrencyService,
  createExchangeSchema,
  getExchangeHistorySchema,
} from "@liratek/core";

const router = express.Router();

// All exchange routes require auth
router.use(authenticateJWT);

// GET /api/exchange/rates
router.get("/rates", (_req, res) => {
  const service = getRateService();
  const rates = service.listRates();
  res.json({ success: true, rates });
});

// GET /api/exchange/currencies
router.get("/currencies", (_req, res) => {
  const service = getCurrencyService();
  const currencies = service.listCurrencies();
  res.json({ success: true, currencies });
});

// GET /api/exchange/history
router.get("/history", validateQuery(getExchangeHistorySchema), (req, res) => {
  const limit = req.query.limit as unknown as number;
  const service = getExchangeService();
  const history = service.getHistory(limit);
  res.json({ success: true, history });
});

// POST /api/exchange/transactions (admin)
router.post(
  "/transactions",
  requireRole(["admin"]),
  validateRequest(createExchangeSchema),
  (req, res) => {
    const service = getExchangeService();
    const result = service.addTransaction(req.body);
    res.status(result.success ? 200 : 400).json(result);
  },
);

export default router;
