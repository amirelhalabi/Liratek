import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateParams } from "../middleware/validation.js";
import {
  getExpenseService,
  createExpenseSchema,
  deleteExpenseSchema,
  expenseUpdateMetadataSchema,
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

// POST /api/expenses/update-metadata (admin + staff — matches
// dbHandlers.ts's "expenses:update-metadata" IPC gate). `editedBy` comes
// from the JWT's username claim, never the client body. Static path,
// registered before this router would ever need a parameterized sibling
// (rule 19 convention — see inventory.ts's/loto.ts's ordering comments).
router.post(
  "/update-metadata",
  requireRole(["admin", "staff"]),
  validateRequest(expenseUpdateMetadataSchema),
  (req, res) => {
    const editedBy = req.user!.username;
    const service = getExpenseService();
    const result = service.updateExpenseMetadata(
      req.body.id,
      {
        description: req.body.description,
        category: req.body.category,
        note: req.body.note,
      },
      editedBy,
    );

    if (
      result.success &&
      result.oldValues &&
      Object.keys(result.oldValues).length > 0
    ) {
      // Mirrors dbHandlers.ts's expenses:update-metadata audit
      // (edit_metadata/expense).
      auditRest(req, {
        action: "edit_metadata",
        entity_type: "expense",
        entity_id: String(req.body.id),
        summary: `Edited expense #${req.body.id} metadata`,
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
