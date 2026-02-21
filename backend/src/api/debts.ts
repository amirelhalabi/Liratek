import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { getDebtService, addRepaymentSchema } from "@liratek/core";

const router = express.Router();

// All debts routes require auth
router.use(authenticateJWT);

// GET /api/debts/debtors
router.get("/debtors", (_req, res) => {
  const service = getDebtService();
  const debtors = service.getDebtors();
  res.json({ success: true, debtors });
});

// GET /api/debts/clients/:clientId/history
router.get("/clients/:clientId/history", (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!Number.isFinite(clientId)) {
    res.status(400).json({ success: false, error: "Invalid clientId" });
    return;
  }

  const service = getDebtService();
  const history = service.getClientHistory(clientId);
  res.json({ success: true, history });
});

// GET /api/debts/clients/:clientId/total
router.get("/clients/:clientId/total", (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!Number.isFinite(clientId)) {
    res.status(400).json({ success: false, error: "Invalid clientId" });
    return;
  }

  const service = getDebtService();
  const total = service.getClientTotal(clientId);
  res.json({ success: true, total });
});

// POST /api/debts/repayments (admin)
router.post(
  "/repayments",
  requireRole(["admin"]),
  validateRequest(addRepaymentSchema),
  (req, res) => {
    const service = getDebtService();
    const result = service.addRepayment(req.body);
    res.status(result.success ? 200 : 400).json(result);
  },
);

export default router;
