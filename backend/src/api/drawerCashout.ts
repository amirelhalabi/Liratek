/**
 * Drawer cash-out REST routes — HTTP twin of
 * electron-app/handlers/drawerCashoutHandlers.ts.
 *
 * Pulls cash OUT of the General drawer (owner takes cash) for a reason that
 * is neither a business expense nor a drawer-to-drawer transfer — never
 * touches expenses/profit. Admin-ONLY (stricter than Drawer Top-Up's
 * admin+staff): this is a no-counterpart cash outflow with shrinkage risk.
 * Money logic + validation live in the core DrawerCashoutService/schema
 * (unchanged); this is a transport addition. Envelope mirrors IPC: POST
 * returns the service result verbatim, reads return `{ success, data }`;
 * HTTP 200 even on failure. Tenant-scoped via authenticateJWT → runWithTenant.
 */
import express from "express";
import {
  getDrawerCashoutService,
  createDrawerCashoutSchema,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

router.use(authenticateJWT);
const writeGate = requireRole(["admin"]);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

// GET /api/drawer-cashout/history?limit=
router.get("/history", (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json({
      success: true,
      data: getDrawerCashoutService().getHistory(limit),
    });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/drawer-cashout — cash pulled OUT of the General drawer
router.post(
  "/",
  writeGate,
  validateRequest(createDrawerCashoutSchema),
  (req, res) => {
    try {
      const userId = (req as AuthRequest).user!.userId;
      const result = getDrawerCashoutService().addCashout(req.body, userId);
      if (result.success) {
        // Mirrors drawerCashoutHandlers.ts's drawer-cashout:create audit.
        auditRest(req, {
          action: "create",
          entity_type: "drawer_cashout",
          summary: `Drawer cash-out: $${req.body.amount_usd} USD + ${req.body.amount_lbp} LBP`,
          metadata: {
            amount_usd: req.body.amount_usd,
            amount_lbp: req.body.amount_lbp,
            extra_currencies: req.body.extra_currencies ?? null,
            notes: req.body.notes,
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
