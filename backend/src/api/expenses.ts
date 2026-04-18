import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateParams } from "../middleware/validation.js";
import {
  getExpenseService,
  createExpenseSchema,
  deleteExpenseSchema,
} from "@liratek/core";

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
    res.status(result.success ? 200 : 400).json(result);
  },
);

export default router;
