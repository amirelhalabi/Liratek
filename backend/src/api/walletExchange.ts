/**
 * Wallet exchange REST routes — HTTP twin of
 * electron-app/handlers/walletExchangeHandlers.ts.
 *
 * Converts a provider wallet's (OMT App / Whish App) own USD balance to LBP
 * or vice versa — never touches General, never a customer. Same role tier
 * as the IPC handler (admin + staff — a normal operational action, not a
 * physical-cash withdrawal). Money logic + validation live in the core
 * WalletExchangeService/schema (unchanged); this is a transport addition.
 * Envelope mirrors IPC: POST returns the service result verbatim, reads
 * return `{ success, data }`; HTTP 200 even on failure. Tenant-scoped via
 * authenticateJWT → runWithTenant.
 */
import express from "express";
import {
  getWalletExchangeService,
  createWalletExchangeSchema,
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

// GET /api/wallet-exchange/history?drawerName=&limit=
router.get("/history", (req, res) => {
  try {
    const drawerName = req.query.drawerName as
      | "OMT_App"
      | "Whish_App"
      | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json({
      success: true,
      data: getWalletExchangeService().getHistory(drawerName, limit),
    });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/wallet-exchange — convert a wallet's own USD<->LBP balance
router.post(
  "/",
  writeGate,
  validateRequest(createWalletExchangeSchema),
  (req, res) => {
    try {
      const userId = (req as AuthRequest).user!.userId;
      const result = getWalletExchangeService().exchange(req.body, userId);
      if (result.success) {
        // Mirrors walletExchangeHandlers.ts's wallet-exchange:create audit
        // (create/wallet_exchange).
        auditRest(req as AuthRequest, {
          action: "create",
          entity_type: "wallet_exchange",
          summary: `${String(req.body.drawerName).replace("_", " ")} Exchange: ${req.body.amountIn} ${req.body.fromCurrency} → ${result.amountOut} ${req.body.toCurrency}`,
          metadata: {
            drawer_name: req.body.drawerName,
            from_currency: req.body.fromCurrency,
            to_currency: req.body.toCurrency,
            amount_in: req.body.amountIn,
            amount_out: result.amountOut,
            rate: req.body.rate,
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
