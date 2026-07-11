import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  getDebtService,
  addRepaymentSchema,
  debtCashOutSchema,
  debtAccountEntrySchema,
} from "@liratek/core";
import type { AuthRequest } from "../middleware/auth.js";

const router = express.Router();

// All debts routes require auth
router.use(authenticateJWT);

const writeGate = requireRole(["admin", "staff"]);

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

// GET /api/debts/clients/:clientId/balance — per-currency raw balance
// (a client may hold a USD credit and an LBP debt at once; see FEATURE_GUIDE §5)
router.get("/clients/:clientId/balance", (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!Number.isFinite(clientId)) {
    res.status(400).json({ success: false, error: "Invalid clientId" });
    return;
  }
  try {
    const balance = getDebtService().getClientBalance(clientId);
    res.json({ success: true, data: balance });
  } catch (error) {
    res.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get balance",
    });
  }
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

// POST /api/debts/cash-out (admin+staff) — withdraw a client's prepaid credit
router.post(
  "/cash-out",
  writeGate,
  validateRequest(debtCashOutSchema),
  (req, res) => {
    const userId = (req as AuthRequest).user!.userId;
    const result = getDebtService().cashOut({ ...req.body, userId });
    res.json(result);
  },
);

// POST /api/debts/account-entry (admin+staff) — manual till-moving credit/debt
router.post(
  "/account-entry",
  writeGate,
  validateRequest(debtAccountEntrySchema),
  (req, res) => {
    const userId = (req as AuthRequest).user!.userId;
    const result = getDebtService().addAccountCashEntry({
      ...req.body,
      userId,
    });
    res.json(result);
  },
);

export default router;
