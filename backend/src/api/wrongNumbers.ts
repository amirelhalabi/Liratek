/**
 * Wrong-number card recharge REST routes — HTTP twin of
 * electron-app/handlers/wrongNumberHandlers.ts (LIRA-312).
 *
 * Same core service and schemas as the IPC handlers (rules 14, 19). Auth
 * mirrors IPC: the list needs only `authenticateJWT`; recording a wrong
 * number and entering credits received are admin + staff (owner decision
 * 2026-10-12); undo stays the admin-only `POST /api/transactions/:id/void`.
 * The actor comes from the JWT, never the body (rule 19c). Envelope mirrors
 * IPC exactly — HTTP 200 even on failure, `{ success, data?, error? }`.
 * Tenant-scoped via authenticateJWT -> runWithTenant.
 */
import express from "express";
import {
  getWrongNumberService,
  listWrongNumbersQuerySchema,
  recordWrongNumberSchema,
  wrongNumberCreditsSchema,
  wrongNumberSaleCardQuerySchema,
  type ListWrongNumbersQuery,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

router.use(authenticateJWT);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

// GET /api/wrong-numbers?sale_transaction_id=…&expense_transaction_id=…&id=…
router.get("/", validateQuery(listWrongNumbersQuerySchema), (req, res) => {
  try {
    const data = getWrongNumberService().list(
      req.query as unknown as ListWrongNumbersQuery,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/wrong-numbers/sale-card/:saleTransactionId — LIRA-325: the card
// a sale sold (data: null when it cannot be told). Static prefix, so it never
// collides with the `/:id/credits` route.
router.get("/sale-card/:saleTransactionId", (req, res) => {
  try {
    const parsed = wrongNumberSaleCardQuerySchema.safeParse({
      sale_transaction_id: req.params.saleTransactionId,
    });
    if (!parsed.success) {
      res.json({
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid sale id",
      });
      return;
    }
    res.json({
      success: true,
      data: getWrongNumberService().getSaleCard(
        parsed.data.sale_transaction_id,
      ),
    });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/wrong-numbers — record a wrong-number card (admin, staff).
router.post(
  "/",
  requireRole(["admin", "staff"]),
  validateRequest(recordWrongNumberSchema),
  (req, res) => {
    try {
      const result = getWrongNumberService().recordWrongNumber(
        req.body,
        (req as AuthRequest).user!.userId,
      );
      if (result.success) {
        auditRest(req as AuthRequest, {
          action: "create",
          entity_type: "wrong_number_card",
          entity_id: String(result.data.id),
          summary: `Wrong number${req.body.wrong_number ? ` ${req.body.wrong_number}` : ""} (${req.body.provider} card)`,
          metadata: {
            expense_transaction_id: result.data.expense_transaction_id,
            sale_transaction_id: req.body.sale_transaction_id ?? null,
          },
        });
      }
      res.json(result);
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// POST /api/wrong-numbers/:id/credits — credits sent back (admin, staff).
router.post(
  "/:id/credits",
  requireRole(["admin", "staff"]),
  validateRequest(wrongNumberCreditsSchema),
  (req, res) => {
    try {
      if (Number(req.params.id) !== req.body.wrong_number_card_id) {
        res.json({
          success: false,
          error: "Record id in the path and body do not match.",
        });
        return;
      }
      const result = getWrongNumberService().recordCreditsReceived(
        req.body,
        (req as AuthRequest).user!.userId,
      );
      if (result.success) {
        auditRest(req as AuthRequest, {
          action: "create",
          entity_type: "wrong_number_card",
          entity_id: String(req.body.wrong_number_card_id),
          summary: `Credits received $${req.body.amount_usd} (wrong-number card #${req.body.wrong_number_card_id})`,
          metadata: {
            transaction_id: result.data.transaction_id,
            carrier_line_id: req.body.carrier_line_id,
          },
        });
      }
      res.json(result);
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

export default router;
