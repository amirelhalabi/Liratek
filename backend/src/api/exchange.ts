import express from "express";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import {
  getExchangeService,
  getRateService,
  getCurrencyService,
  createExchangeSchema,
  getExchangeHistorySchema,
  updateExchangeMetadataSchema,
} from "@liratek/core";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// updateExchangeMetadataSchema now lives in packages/core/src/validators/
// exchange.ts (EXCHANGE_LOT_SETTLEMENT.md Phase 6, rule 14/19 cleanup) —
// shared with the exchange:update-metadata IPC handler's own validation.

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
    if (result.success) {
      // Mirrors exchangeHandlers.ts's exchange:add-transaction audit.
      auditRest(req, {
        action: "create",
        entity_type: "exchange_transaction",
        summary: `Exchange ${req.body.amountIn} ${req.body.fromCurrency} → ${req.body.toCurrency}`,
        metadata: {
          fromCurrency: req.body.fromCurrency,
          toCurrency: req.body.toCurrency,
          amountIn: req.body.amountIn,
        },
      });
    }
    res.status(result.success ? 200 : 400).json(result);
  },
);

// POST /api/exchange/update-metadata (admin+staff) — edit non-financial
// metadata (client name / note) on an exchange_transactions row. Mirrors the
// `exchange:update-metadata` IPC handler's envelope reshaping exactly:
// { success: true, data: entity } / { success: false, error }. Closes a
// rule-19 REST gap — HistoryModal.tsx previously called
// window.api.exchange.updateMetadata directly with no web-mode route at all.
router.post(
  "/update-metadata",
  requireRole(["admin", "staff"]),
  validateRequest(updateExchangeMetadataSchema),
  (req, res) => {
    const service = getExchangeService();
    // Never trust a client-sent actor — mirrors the IPC handler's
    // server-side username resolution (which looks the user up by
    // auth.userId; the JWT already carries the resolved username).
    const editedBy = (req as AuthRequest).user!.username;
    const result = service.updateExchangeMetadata(
      req.body.id,
      { client_name: req.body.client_name, note: req.body.note },
      editedBy,
    );
    if (
      result.success &&
      result.oldValues &&
      Object.keys(result.oldValues).length > 0
    ) {
      // Mirrors exchangeHandlers.ts's exchange:update-metadata audit.
      auditRest(req, {
        action: "edit_metadata",
        entity_type: "exchange_transaction",
        entity_id: String(req.body.id),
        summary: `Edited exchange #${req.body.id} metadata`,
        old_values: result.oldValues,
        new_values: req.body,
      });
    }
    res.json(
      result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error },
    );
  },
);

export default router;
