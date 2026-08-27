/**
 * Exchange lot REST routes — HTTP twin of
 * electron-app/handlers/exchangeLotHandlers.ts (EXCHANGE_LOT_SETTLEMENT.md
 * Phase 4a).
 *
 * Read/admin API surface over the FIFO cost-basis lot engine
 * (`ExchangeLotService`/`ExchangeLotRepository`). Does NOT wire the engine
 * into the exchange create/void/refund write path (Phase 3, a concurrent
 * change elsewhere). Auth mirrors the IPC handler: reads (`preview`,
 * `positions`, `breakdown`) require only `authenticateJWT` (same as
 * `exchange:get-history`/`wallet-exchange:history` have no extra role gate
 * on the desktop side); `adjust` (Q15) is admin-ONLY on both transports.
 * Envelope mirrors IPC exactly — HTTP 200 even on failure, `{ success,
 * data?, error? }`. Tenant-scoped via authenticateJWT -> runWithTenant.
 */
import express from "express";
import {
  getExchangeLotService,
  getUserRepository,
  previewLotSettlementSchema,
  lotBreakdownSchema,
  adjustLotPositionSchema,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateRequest, validateParams } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

router.use(authenticateJWT);
const adminGate = requireRole(["admin"]);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

/** Same lookup-with-fallback the IPC handler uses for `created_by` (a TEXT
 *  username column, not a user-id FK) — never trusts a client-sent actor. */
function resolveActingUsername(userId: number): string {
  let username = `user-${userId}`;
  try {
    const user = getUserRepository().findById(userId);
    if (user) username = user.username;
  } catch {
    // fallback to user-{id}
  }
  return username;
}

// POST /api/exchange-lots/preview — FIFO dry-run (Q10 loss-confirm dialog)
router.post(
  "/preview",
  validateRequest(previewLotSettlementSchema),
  (req, res) => {
    try {
      const result = getExchangeLotService().previewSettlement(req.body);
      res.json(result);
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// GET /api/exchange-lots/positions — per-currency open position + Q11
// indicative unrealized P&L (display-only)
router.get("/positions", (_req, res) => {
  try {
    res.json({ success: true, data: getExchangeLotService().getPositions() });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/exchange-lots/breakdown/:exchangeId — expandable history-row
// settlement breakdown, fetched lazily on expand
router.get(
  "/breakdown/:exchangeId",
  validateParams(lotBreakdownSchema),
  (req, res) => {
    try {
      const exchangeId = req.params.exchangeId as unknown as number;
      res.json({
        success: true,
        data: getExchangeLotService().getBreakdown(exchangeId),
      });
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// POST /api/exchange-lots/adjust — Q15 admin-only manual position adjustment
router.post(
  "/adjust",
  adminGate,
  validateRequest(adjustLotPositionSchema),
  (req, res) => {
    try {
      const userId = (req as AuthRequest).user!.userId;
      const createdBy = resolveActingUsername(userId);
      const result = getExchangeLotService().adjustPosition(
        req.body,
        createdBy,
      );
      if (result.success) {
        auditRest(req as AuthRequest, {
          action: "create",
          entity_type: "exchange_position_adjustment",
          summary: `Exchange lot adjustment: ${req.body.qty > 0 ? "+" : ""}${req.body.qty} ${req.body.currencyCode}`,
          metadata: {
            currency_code: req.body.currencyCode,
            qty: req.body.qty,
            unit_cost_usd: req.body.unitCostUsd,
            note: req.body.note,
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
