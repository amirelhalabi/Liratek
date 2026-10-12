/**
 * Resale (for-sale) phone line REST routes — HTTP twin of
 * electron-app/handlers/resaleLineHandlers.ts (LIRA-309).
 *
 * Same core service and schemas as the IPC handlers (rules 14, 19). Auth
 * mirrors IPC: the list needs only `authenticateJWT` (the Mobile Recharge
 * page reads it to recognise the shop's own numbers); saving details is
 * admin-only. Envelope mirrors IPC exactly — HTTP 200 even on failure,
 * `{ success, data?, error? }`. Tenant-scoped via authenticateJWT ->
 * runWithTenant.
 */
import express from "express";
import {
  getResaleLineService,
  listResaleLinesQuerySchema,
  saveResaleLineSchema,
  writeOffResaleLineSchema,
  rechargeResaleLineSchema,
  type ListResaleLinesQuery,
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

// GET /api/resale-lines?carrier=mtc&include_sold=false
router.get("/", validateQuery(listResaleLinesQuerySchema), (req, res) => {
  try {
    const data = getResaleLineService().listLines(
      req.query as unknown as ListResaleLinesQuery,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// PUT /api/resale-lines/:productId — create or update a line's details (admin)
router.put(
  "/:productId",
  requireRole(["admin"]),
  validateRequest(saveResaleLineSchema),
  (req, res) => {
    try {
      if (Number(req.params.productId) !== req.body.product_id) {
        res.json({
          success: false,
          error: "Product id in the path and body do not match.",
        });
        return;
      }
      const result = getResaleLineService().saveDetails(req.body);
      if (result.success) {
        auditRest(req as AuthRequest, {
          action: "update",
          entity_type: "resale_line",
          entity_id: String(req.body.product_id),
          summary: `Saved phone line details for product #${req.body.product_id}`,
          metadata: {
            carrier: req.body.carrier,
            validity_expires_at: req.body.validity_expires_at ?? null,
            credits: req.body.credits ?? null,
          },
        });
      }
      res.json(result);
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// POST /api/resale-lines/:productId/write-off — book a LOST line's cost as a
// loss (admin), through the existing reversible stock-expense flow (FR-016).
// The actor comes from the JWT, never the body (rule 19c).
router.post(
  "/:productId/write-off",
  requireRole(["admin"]),
  validateRequest(writeOffResaleLineSchema),
  (req, res) => {
    try {
      if (Number(req.params.productId) !== req.body.product_id) {
        res.json({
          success: false,
          error: "Product id in the path and body do not match.",
        });
        return;
      }
      const result = getResaleLineService().writeOff(
        req.body,
        (req as AuthRequest).user!.userId,
      );
      if (result.success) {
        auditRest(req as AuthRequest, {
          action: "create",
          entity_type: "resale_line",
          entity_id: String(req.body.product_id),
          summary: `Wrote off lost phone line (product #${req.body.product_id})`,
          metadata: { expense_id: result.data.expense_id },
        });
      }
      res.json(result);
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// POST /api/resale-lines/:productId/recharge — internal recharge of a line held
// for sale (LIRA-309 US3); admin or staff, actor from the JWT.
router.post(
  "/:productId/recharge",
  requireRole(["admin", "staff"]),
  validateRequest(rechargeResaleLineSchema),
  (req, res) => {
    try {
      if (Number(req.params.productId) !== req.body.product_id) {
        res.json({
          success: false,
          error: "Product id in the path and body do not match.",
        });
        return;
      }
      const result = getResaleLineService().recharge(
        req.body,
        (req as AuthRequest).user!.userId,
      );
      if (result.success) {
        auditRest(req as AuthRequest, {
          action: "create",
          entity_type: "resale_line",
          entity_id: String(req.body.product_id),
          summary: `Recharged line for sale (product #${req.body.product_id}, ${req.body.source})`,
          metadata: {
            transaction_id: result.data.transaction_id,
            cost_usd: result.data.cost_usd,
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
