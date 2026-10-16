/**
 * LIRA-326 — Mobile Recharge basket checkout REST route: HTTP twin of
 * electron-app/handlers/rechargeBasketHandlers.ts (`recharge-basket:checkout`).
 *
 * Parity rules (same as sessions.ts /checkout): the SAME core schema and core
 * service (RechargeBasketService → SessionCheckoutService); admin + staff; the
 * operator comes from the JWT, never the body; IPC-identical envelope, HTTP
 * 200 even on failure (the adapter branches on `result.success`).
 */
import { Router, Request, Response } from "express";
import {
  getRechargeBasketService,
  getRechargePartnerOrderService,
  rechargeBasketCheckoutSchema,
  rechargePartnerOrderSchema,
  type RechargeBasketCheckoutInput,
  type RechargeBasketCheckoutRequest,
  type RechargePartnerOrderInput,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { auditRest } from "../middleware/audit.js";

const router = Router();

// authenticateJWT also establishes the tenant context (runWithTenant).
router.use(authenticateJWT);

const writeGate = requireRole(["admin", "staff"]);

// safeParse against the core schema, bridging the zod-major type gap (same
// pattern as sessions.ts). Runtime API is identical.
type SafeParseable<T> = {
  safeParse: (data: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: {
          issues: Array<{ path: (string | number)[]; message: string }>;
        };
      };
};
const checkoutSchema =
  rechargeBasketCheckoutSchema as unknown as SafeParseable<RechargeBasketCheckoutInput>;
const partnerOrderSchema =
  rechargePartnerOrderSchema as unknown as SafeParseable<RechargePartnerOrderInput>;

// POST /api/recharge-basket/checkout
router.post("/checkout", writeGate, async (req: Request, res: Response) => {
  try {
    const authUser = (req as AuthRequest).user;
    // The operator is the JWT's; the body's userId is replaced before parsing
    // so a client never has to (or can) supply it.
    const parsed = checkoutSchema.safeParse({
      ...(req.body ?? {}),
      userId: authUser?.userId ?? 0,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      res.json({ success: false, error: `Validation failed: ${msg}` });
      return;
    }
    const result = await getRechargeBasketService().checkout(
      {
        ...(parsed.data as unknown as RechargeBasketCheckoutRequest),
        userId: authUser?.userId ?? 0,
      },
      { username: authUser?.username || "unknown" },
    );
    if (result.success) {
      // Mirrors rechargeBasketHandlers.ts's audit (create/customer_session).
      auditRest(req as AuthRequest, {
        action: "create",
        entity_type: "customer_session",
        entity_id: String(result.sessionId),
        summary: `Mobile Recharge basket: ${result.results?.length ?? 0} items, USD ${(result.checkoutTotalUsd ?? 0).toFixed(2)}, LBP ${(result.checkoutTotalLbp ?? 0).toFixed(0)}`,
      });
    }
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// POST /api/recharge-basket/partner-order — LIRA-327: "For Partner" across
// the basket. Twin of `recharge-basket:partner-order`.
router.post("/partner-order", writeGate, (req: Request, res: Response) => {
  try {
    const authUser = (req as AuthRequest).user;
    const parsed = partnerOrderSchema.safeParse({
      ...(req.body ?? {}),
      userId: authUser?.userId ?? 0,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      res.json({ success: false, error: `Validation failed: ${msg}` });
      return;
    }
    const result = getRechargePartnerOrderService().submit({
      ...parsed.data,
      userId: authUser?.userId ?? 0,
    });
    if (result.success) {
      // Mirrors rechargeBasketHandlers.ts's partner-order audit.
      auditRest(req as AuthRequest, {
        action: "create",
        entity_type: "financial_transaction",
        summary: `Mobile Recharge partner order: ${result.ids?.length ?? 0} sales for partner ${parsed.data.partnerId}`,
        metadata: { partnerId: parsed.data.partnerId, ids: result.ids },
      });
    }
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
