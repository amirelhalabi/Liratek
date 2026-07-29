/**
 * Drawer top-up REST routes — HTTP twin of
 * electron-app/handlers/drawerTopUpHandlers.ts.
 *
 * Moves cash into a drawer (create) or transfers between drawers
 * (create-from-drawer). Money logic + validation live in the core
 * DrawerTopUpService (unchanged); this is a transport addition. Envelopes
 * mirror IPC: create/create-from-drawer return the service result verbatim,
 * reads return `{ success, data }`; HTTP 200 even on failure. Tenant-scoped
 * via authenticateJWT → runWithTenant.
 */
import express from "express";
import {
  getDrawerTopUpService,
  createSystemFloatTopupSchema,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";

const router = express.Router();

router.use(authenticateJWT);
const writeGate = requireRole(["admin", "staff"]);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

// GET /api/drawer-topup/source-drawers — drawers available as a transfer source
router.get("/source-drawers", (_req, res) => {
  try {
    res.json({
      success: true,
      data: getDrawerTopUpService().getSourceDrawers(),
    });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/drawer-topup/history?limit=
router.get("/history", (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json({
      success: true,
      data: getDrawerTopUpService().getHistory(limit),
    });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/drawer-topup — cash top-up into a drawer (service validates amounts)
// extra_currencies (External/Cash-In only) is passed through as-is — the core
// DrawerTopUpService validates each entry's currency_code/amount (no
// duplicate parallel validation here, matching this route's existing style).
router.post("/", writeGate, (req, res) => {
  try {
    const {
      amount_usd,
      amount_lbp,
      notes,
      transaction_time,
      extra_currencies,
    } = req.body ?? {};
    const userId = (req as AuthRequest).user!.userId;
    res.json(
      getDrawerTopUpService().addTopUp(
        {
          amount_usd: Number(amount_usd) || 0,
          amount_lbp: Number(amount_lbp) || 0,
          notes,
          transaction_time,
          extra_currencies: Array.isArray(extra_currencies)
            ? extra_currencies
            : undefined,
        },
        userId,
      ),
    );
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/drawer-topup/from-drawer — transfer from a source drawer
router.post("/from-drawer", writeGate, (req, res) => {
  try {
    const { amount_usd, amount_lbp, source_drawer, notes, transaction_time } =
      req.body ?? {};
    if (!source_drawer || typeof source_drawer !== "string") {
      res.json({ success: false, error: "source_drawer is required" });
      return;
    }
    const userId = (req as AuthRequest).user!.userId;
    res.json(
      getDrawerTopUpService().topUpFromDrawer(
        {
          amount_usd: Number(amount_usd) || 0,
          amount_lbp: Number(amount_lbp) || 0,
          source_drawer,
          notes,
          transaction_time,
        },
        userId,
      ),
    );
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/drawer-topup/fund-system — fund the OMT_System / Whish_System
// spendable float from any drawer holding a spendable balance (owner-
// confirmed 2026-07-29 float model). Validation (target-drawer enum,
// required funding drawer, at-least-one-currency) lives in the shared core
// schema (rule 14) so IPC and REST reject the exact same malformed payloads.
router.post(
  "/fund-system",
  writeGate,
  validateRequest(createSystemFloatTopupSchema),
  (req, res) => {
    try {
      const userId = (req as AuthRequest).user!.userId;
      res.json(getDrawerTopUpService().fundSystemDrawer(req.body, userId));
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

export default router;
