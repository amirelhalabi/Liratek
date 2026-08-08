import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateParams } from "../middleware/validation.js";
import {
  getExpenseService,
  createExpenseSchema,
  deleteExpenseSchema,
} from "@liratek/core";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// All expenses routes require auth
router.use(authenticateJWT);

// GET /api/expenses/today
router.get("/today", (_req, res) => {
  const service = getExpenseService();
  const expenses = service.getTodayExpenses();
  res.json({ success: true, expenses });
});

// POST /api/expenses (admin)
router.post(
  "/",
  requireRole(["admin"]),
  validateRequest(createExpenseSchema),
  (req, res) => {
    const service = getExpenseService();
    const result = service.addExpense(req.body, req.user!.userId);
    if (result.success) {
      // Mirrors dbHandlers.ts's db:add-expense audit.
      auditRest(req, {
        action: "create",
        entity_type: "expense",
        summary: `Added expense: ${req.body.category} $${req.body.amount_usd}`,
        metadata: {
          category: req.body.category,
          amount_usd: req.body.amount_usd,
        },
      });
    }
    res.status(result.success ? 200 : 400).json(result);
  },
);

// DELETE /api/expenses/:id (admin)
router.delete(
  "/:id",
  requireRole(["admin"]),
  validateParams(deleteExpenseSchema),
  (req, res) => {
    const id = req.params.id as unknown as number;
    const service = getExpenseService();
    const result = service.deleteExpense(id, req.user!.userId);
    if (result.success) {
      // Mirrors dbHandlers.ts's db:delete-expense audit.
      auditRest(req, {
        action: "delete",
        entity_type: "expense",
        entity_id: String(id),
        summary: `Deleted expense #${id}`,
      });
    }
    res.status(result.success ? 200 : 400).json(result);
  },
);

export default router;
