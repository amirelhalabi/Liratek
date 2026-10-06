import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateParams } from "../middleware/validation.js";
import {
  getExpenseService,
  createExpenseSchema,
  createStockExpenseSchema,
  expenseIdParamSchema,
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

// POST /api/expenses (admin and staff — LIRA-242 owner decision 2026-09-28:
// adding an expense is routine cashier work; voiding/deleting one below
// stays admin-only, matching dbHandlers.ts's "db:add-expense" IPC gate).
router.post(
  "/",
  requireRole(["admin", "staff"]),
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
    // Rule 19c: HTTP 200 even on a service failure — the frontend adapter
    // branches on result.success, never on status code (LIRA-234: this used
    // to 400 on a business-rule refusal, which made `requestJson` throw on
    // web and swallow the real `result.error` behind a generic catch).
    res.json(result);
  },
);

// POST /api/expenses/stock-use (admin and staff — same gate as POST / above
// and the "expenses:add-stock-use" IPC handler). LIRA-262: the shop used one
// of its own items (inventory product, or a Katsh / iPick / Whish App catalog
// item) — an expense at cost, no cash moves. The body carries no amount: the
// service derives the cost. Actor from the JWT, never the body.
router.post(
  "/stock-use",
  requireRole(["admin", "staff"]),
  validateRequest(createStockExpenseSchema),
  (req, res) => {
    const service = getExpenseService();
    const result = service.addStockExpense(req.body, req.user!.userId);
    if (result.success) {
      // Mirrors dbHandlers.ts's expenses:add-stock-use audit.
      auditRest(req, {
        action: "create",
        entity_type: "expense",
        entity_id: result.id != null ? String(result.id) : undefined,
        summary: `Recorded shop use: ${req.body.quantity} × ${req.body.source} item #${req.body.item_id}`,
        metadata: {
          source: req.body.source,
          item_id: req.body.item_id,
          quantity: req.body.quantity,
        },
      });
    }
    // Rule 19c: HTTP 200 even on a service failure (IPC-identical envelope).
    res.json(result);
  },
);

// DELETE /api/expenses/:id (admin)
router.delete(
  "/:id",
  requireRole(["admin"]),
  validateParams(expenseIdParamSchema),
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
    // Rule 19c: HTTP 200 even on a service failure — see the identical note
    // on POST / above.
    res.json(result);
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
