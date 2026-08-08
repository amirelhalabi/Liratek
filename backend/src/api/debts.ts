import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  getDebtService,
  addRepaymentSchema,
  addCreditSchema,
  debtCashOutSchema,
  debtAccountEntrySchema,
  debtUseCreditSchema,
  debtUpdateMetadataSchema,
  debtWriteOffSchema,
} from "@liratek/core";
import type { AuthRequest } from "../middleware/auth.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// All debts routes require auth
router.use(authenticateJWT);

const writeGate = requireRole(["admin", "staff"]);
// CQ-10 (D4): standalone write-offs are admin-ONLY on both transports —
// stricter than the admin+staff settlement paths above.
const adminGate = requireRole(["admin"]);

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
// CQ-9 role alignment: the IPC twin (debt:client-balance) gates this with
// requireRole(["admin","staff"]) — this route had no role gate at all
// (open to any authenticated role), a real drift now closed.
router.get("/clients/:clientId/balance", writeGate, (req, res) => {
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

// POST /api/debts/repayments (admin+staff)
// CQ-9 role alignment: was admin-only, but the IPC twin (debt:add-repayment)
// allows admin+staff — REST was stricter than desktop for the same action.
router.post(
  "/repayments",
  writeGate,
  validateRequest(addRepaymentSchema),
  (req, res) => {
    const service = getDebtService();
    const result = service.addRepayment(req.body);
    if (result.success) {
      // Mirrors debtHandlers.ts's debt:add-repayment audit.
      auditRest(req, {
        action: "create",
        entity_type: "repayment",
        summary: `Repayment for client #${req.body.clientId}: $${req.body.amountUSD} + ${req.body.amountLBP} LBP`,
        metadata: {
          clientId: req.body.clientId,
          amountUSD: req.body.amountUSD,
          amountLBP: req.body.amountLBP,
        },
      });
    }
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
    if (result.success) {
      // Mirrors debtHandlers.ts's debt:cash-out audit.
      auditRest(req, {
        action: "create",
        entity_type: "credit_cash_out",
        summary: `Credit cash out for client #${req.body.clientId}: $${req.body.amountUSD} + ${req.body.amountLBP} LBP`,
        metadata: {
          clientId: req.body.clientId,
          amountUSD: req.body.amountUSD,
          amountLBP: req.body.amountLBP,
        },
      });
    }
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
    if (result.success) {
      // Mirrors debtHandlers.ts's debt:add-account-entry audit.
      auditRest(req, {
        action: "create",
        entity_type: "account_cash_entry",
        summary: `Account ${req.body.direction} for client #${req.body.clientId}: $${req.body.amountUSD} + ${req.body.amountLBP} LBP${req.body.moveCash === false ? " (paper, no cash moved)" : ""}`,
        metadata: {
          direction: req.body.direction,
          clientId: req.body.clientId,
          amountUSD: req.body.amountUSD,
          amountLBP: req.body.amountLBP,
          moveCash: req.body.moveCash !== false,
        },
      });
    }
    res.json(result);
  },
);

// POST /api/debts/credit (admin+staff) — record a prepaid credit (shop owes
// customer). Same core DebtService.addCredit the IPC handler uses; userId from JWT.
router.post(
  "/credit",
  writeGate,
  validateRequest(addCreditSchema),
  (req, res) => {
    const userId = (req as AuthRequest).user!.userId;
    const result = getDebtService().addCredit({ ...req.body, userId });
    if (result.success) {
      // Mirrors debtHandlers.ts's debt:add-credit audit.
      auditRest(req, {
        action: "create",
        entity_type: "credit",
        summary: `Credit added for client #${req.body.clientId}: $${req.body.amountUsd} + ${req.body.amountLbp} LBP`,
        metadata: {
          clientId: req.body.clientId,
          amountUsd: req.body.amountUsd,
          amountLbp: req.body.amountLbp,
        },
      });
    }
    res.json(result);
  },
);

// POST /api/debts/use-credit (admin+staff) — consume a client's prepaid
// credit balance. Same core DebtService.useCredit the IPC handler
// (debt:use-credit) uses; userId from JWT. CQ-9: closes a REST gap — this
// channel previously had no web-mode route at all.
router.post(
  "/use-credit",
  writeGate,
  validateRequest(debtUseCreditSchema),
  (req, res) => {
    const userId = (req as AuthRequest).user!.userId;
    const result = getDebtService().useCredit({ ...req.body, userId });
    if (result.success) {
      // Mirrors debtHandlers.ts's debt:use-credit audit.
      auditRest(req, {
        action: "create",
        entity_type: "credit_used",
        summary: `Credit used for client #${req.body.clientId}: $${req.body.amountUsd} + ${req.body.amountLbp} LBP`,
        metadata: {
          clientId: req.body.clientId,
          amountUsd: req.body.amountUsd,
          amountLbp: req.body.amountLbp,
        },
      });
    }
    res.json(result);
  },
);

// POST /api/debts/update-metadata (admin+staff) — edit non-financial
// metadata (currently just `note`) on a debt_ledger row. Mirrors the
// `debts:update-metadata` IPC handler's envelope reshaping exactly:
// { success: true, data: entity } / { success: false, error }. CQ-9: closes
// a REST gap — this channel previously had no web-mode route at all.
router.post(
  "/update-metadata",
  writeGate,
  validateRequest(debtUpdateMetadataSchema),
  (req, res) => {
    const editedBy = (req as AuthRequest).user!.username;
    const result = getDebtService().updateDebtMetadata(
      req.body.id,
      { note: req.body.note },
      editedBy,
    );
    if (
      result.success &&
      result.oldValues &&
      Object.keys(result.oldValues).length > 0
    ) {
      // Mirrors debtHandlers.ts's debts:update-metadata audit.
      auditRest(req, {
        action: "edit_metadata",
        entity_type: "debt_ledger",
        entity_id: String(req.body.id),
        summary: `Edited debt record #${req.body.id} metadata`,
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

// POST /api/debts/write-off (admin-only, D4) — forgive part of a client's
// debt with NO settlement attached. Mirrors the `debt:write-off` IPC handler
// exactly (same schema, same envelope).
router.post(
  "/write-off",
  adminGate,
  validateRequest(debtWriteOffSchema),
  (req, res) => {
    const userId = (req as AuthRequest).user!.userId;
    const result = getDebtService().writeOffDebt({ ...req.body, userId });
    if (result.success) {
      // Mirrors debtHandlers.ts's debt:write-off audit.
      auditRest(req, {
        action: "write_off",
        entity_type: "debt_write_off",
        summary: `Debt write-off for client #${req.body.clientId}: $${req.body.amountUSD} + ${req.body.amountLBP} LBP`,
        metadata: {
          clientId: req.body.clientId,
          amountUSD: req.body.amountUSD,
          amountLBP: req.body.amountLBP,
          reason: req.body.reason,
        },
      });
    }
    res.json(result);
  },
);

export default router;
