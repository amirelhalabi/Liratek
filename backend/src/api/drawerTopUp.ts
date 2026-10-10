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
  createDrawerTransferSchema,
  drawerTopUpCreateSchema,
  drawerTopUpFromDrawerSchema,
  type DrawerTopUpCreateInput,
  type DrawerTopUpFromDrawerInput,
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

// POST /api/drawer-topup — cash top-up into a drawer.
// LIRA-297: validated against the shared core `drawerTopUpCreateSchema` — the
// exact schema `drawer-topup:create` (IPC) uses — instead of `Number(x) || 0`
// coercion. That coercion let a negative amount through on the web (the
// service only refuses when BOTH USD and LBP are <= 0) while desktop refused
// it. The schema keeps every key this route forwarded (amount_usd/lbp, notes,
// transaction_time, extra_currencies with each entry's currency_code, amount,
// acquisition_usd_per_unit, market_usd_per_unit_hint — the keys
// DrawerTopUpService/Repository read); the service still owns the
// per-entry checks (USD/LBP not allowed as an extra, codes upper-cased) and
// the cost-basis resolution.
router.post(
  "/",
  writeGate,
  validateRequest(drawerTopUpCreateSchema),
  (req, res) => {
    try {
      const userId = (req as AuthRequest).user!.userId;
      const topUpData = req.body as DrawerTopUpCreateInput;
      const result = getDrawerTopUpService().addTopUp(topUpData, userId);
      if (result.success) {
        const extraCount = topUpData.extra_currencies?.length ?? 0;
        // Mirrors drawerTopUpHandlers.ts's drawer-topup:create audit.
        auditRest(req, {
          action: "create",
          entity_type: "drawer_topup",
          summary:
            `Drawer top-up: $${topUpData.amount_usd} USD + ${topUpData.amount_lbp} LBP` +
            (extraCount > 0 ? ` + ${extraCount} other currencies` : ""),
          metadata: {
            amount_usd: topUpData.amount_usd,
            amount_lbp: topUpData.amount_lbp,
            extra_currencies: topUpData.extra_currencies,
            notes: topUpData.notes,
          },
        });
      }
      res.json(result);
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// POST /api/drawer-topup/from-drawer — transfer from a source drawer.
// LIRA-297: same core `drawerTopUpFromDrawerSchema` as the IPC channel
// (replaces the hand-written source_drawer check + `Number(x) || 0`).
router.post(
  "/from-drawer",
  writeGate,
  validateRequest(drawerTopUpFromDrawerSchema),
  (req, res) => {
    try {
      const userId = (req as AuthRequest).user!.userId;
      const fromDrawerData = req.body as DrawerTopUpFromDrawerInput;
      const result = getDrawerTopUpService().topUpFromDrawer(
        fromDrawerData,
        userId,
      );
      if (result.success) {
        // Mirrors drawerTopUpHandlers.ts's drawer-topup:create-from-drawer audit.
        auditRest(req, {
          action: "create",
          entity_type: "drawer_topup",
          summary: `Drawer transfer from ${fromDrawerData.source_drawer}: $${fromDrawerData.amount_usd} USD + ${fromDrawerData.amount_lbp} LBP`,
          metadata: {
            source_drawer: fromDrawerData.source_drawer,
            amount_usd: fromDrawerData.amount_usd,
            amount_lbp: fromDrawerData.amount_lbp,
            notes: fromDrawerData.notes,
          },
        });
      }
      res.json(result);
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// POST /api/drawer-topup/transfer — generic, reversible cash transfer
// between any two of the shop's own drawers (Primary Cash Drawer plan §8.6).
// General <-> the primary cash drawer (OMT_System/Whish_System) is the pair
// the UI exposes. Replaces the retired "/fund-system" route (one-directional,
// owner-confirmed 2026-07-29 float model). Validation (distinct drawers,
// at-least-one-currency) lives in the shared core schema (rule 14) so IPC
// and REST reject the exact same malformed payloads. `userId` is injected
// from the JWT (rule 19c) — never trusted from the body — and the service
// result (including any AppError's `code`/`details`, the general envelope
// §8.5) is returned verbatim, envelope-identical to IPC, HTTP 200 even on
// failure.
router.post(
  "/transfer",
  writeGate,
  validateRequest(createDrawerTransferSchema),
  (req, res) => {
    try {
      const userId = (req as AuthRequest).user!.userId;
      const {
        fromDrawer,
        toDrawer,
        amount_usd,
        amount_lbp,
        notes,
        transaction_time,
      } = req.body;
      const result = getDrawerTopUpService().transferBetweenDrawers({
        fromDrawer,
        toDrawer,
        amountUsd: amount_usd,
        amountLbp: amount_lbp,
        notes,
        transactionTime: transaction_time,
        createdBy: userId,
      });
      if (result.success) {
        // Mirrors drawerTopUpHandlers.ts's drawer-topup:transfer audit.
        auditRest(req, {
          action: "create",
          entity_type: "drawer_transfer",
          summary: `Drawer Transfer: ${fromDrawer} → ${toDrawer} — $${amount_usd} USD + ${amount_lbp} LBP`,
          metadata: {
            from_drawer: fromDrawer,
            to_drawer: toDrawer,
            amount_usd,
            amount_lbp,
            notes,
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
