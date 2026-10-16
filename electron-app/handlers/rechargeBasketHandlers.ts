/**
 * LIRA-326 — Mobile Recharge basket checkout (iPick + Katsh + Whish App picks
 * from two or more providers, paid ONCE).
 *
 * Thin wrapper over the shared core RechargeBasketService, which creates an
 * automatic customer session and checks it out through SessionCheckoutService
 * (one sale per provider, one payment). REST twin:
 * POST /api/recharge-basket/checkout (backend/src/api/rechargeBasket.ts) —
 * same schema, same roles, same envelope (rule 19).
 *
 * LIRA-327 adds `recharge-basket:partner-order`: "For Partner" across the
 * basket — every provider's partner sales booked all-or-nothing by the core
 * RechargePartnerOrderService. REST twin: POST
 * /api/recharge-basket/partner-order.
 */
import { ipcMain } from "electron";
import {
  getRechargeBasketService,
  getRechargePartnerOrderService,
  getUserRepository,
  type RechargeBasketCheckoutRequest,
  type RechargePartnerOrderRequest,
} from "@liratek/core";
import { requireRole } from "../session.js";
import {
  validatePayload,
  RechargeBasketCheckoutSchema,
  RechargePartnerOrderSchema,
} from "../schemas/index.js";
import { audit } from "./auditHelper.js";

export function registerRechargeBasketHandlers() {
  ipcMain.handle(
    "recharge-basket:checkout",
    async (event, request: unknown) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      // The operator is the session's; the wire userId is replaced before
      // validation (same as the REST twin), never trusted.
      const withOperator =
        request !== null &&
        typeof request === "object" &&
        !Array.isArray(request)
          ? { ...(request as Record<string, unknown>), userId: auth.userId }
          : request;
      const validation = validatePayload(
        RechargeBasketCheckoutSchema,
        withOperator,
      );
      if (!validation.ok) return { success: false, error: validation.error };

      const username =
        getUserRepository().findByIdSafe(auth.userId)?.username ||
        String(auth.userId);

      try {
        // The AUTHENTICATED operator, never the wire-supplied userId.
        const result = await getRechargeBasketService().checkout(
          {
            ...(validation.data as unknown as RechargeBasketCheckoutRequest),
            userId: auth.userId,
          },
          { username },
        );

        if (result.success) {
          audit(event.sender.id, {
            action: "create",
            entity_type: "customer_session",
            entity_id: String(result.sessionId),
            summary: `Mobile Recharge basket: ${result.results?.length ?? 0} items, USD ${(result.checkoutTotalUsd ?? 0).toFixed(2)}, LBP ${(result.checkoutTotalLbp ?? 0).toFixed(0)}`,
          });
        }
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Checkout failed",
        };
      }
    },
  );

  ipcMain.handle("recharge-basket:partner-order", (event, request: unknown) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };

    // The operator is the session's, never the wire's (same as the REST twin).
    const withOperator =
      request !== null && typeof request === "object" && !Array.isArray(request)
        ? { ...(request as Record<string, unknown>), userId: auth.userId }
        : request;
    const validation = validatePayload(
      RechargePartnerOrderSchema,
      withOperator,
    );
    if (!validation.ok) return { success: false, error: validation.error };

    try {
      const order = validation.data as unknown as RechargePartnerOrderRequest;
      const result = getRechargePartnerOrderService().submit({
        ...order,
        userId: auth.userId,
      });
      if (result.success) {
        audit(event.sender.id, {
          action: "create",
          entity_type: "financial_transaction",
          summary: `Mobile Recharge partner order: ${result.ids?.length ?? 0} sales for partner ${order.partnerId}`,
          metadata: { partnerId: order.partnerId, ids: result.ids },
        });
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to process partner transaction",
      };
    }
  });
}
