/**
 * LIRA-326 — pay a Mobile Recharge basket of 2+ providers ONCE.
 *
 * Shared by KatshForm and FinancialForm (rule 14): builds the one payload
 * (`buildBasketCheckoutPayload`) and sends it through the dual-transport
 * adapter (`useApi().rechargeBasketCheckout`, rule 19). The server records it
 * as an automatic walk-in customer session, one sale per provider.
 *
 * Rule 25: `api` and the operator are read through refs, so the returned
 * function has a stable identity.
 */
import { useCallback, useEffect, useRef } from "react";
import { useApi } from "@liratek/ui";
import { useOptionalAuth } from "@/features/auth/context/AuthContext";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import logger from "@/utils/logger";
import {
  buildBasketCheckoutPayload,
  buildPartnerOrderPayload,
  type BuildBasketCheckoutInput,
  type BuildPartnerOrderInput,
} from "../utils/basketCheckout";

export type BasketCheckoutResult =
  | { success: true }
  | { success: false; error: string };

export function useRechargeBasketCheckout(): (
  input: Omit<BuildBasketCheckoutInput, "userId">,
) => Promise<BasketCheckoutResult> {
  const api = useApi();
  const apiRef = useRef(api);
  const userId = useOptionalAuth()?.user?.id;
  const userIdRef = useRef(userId);
  // Synced after render (react-hooks/refs); the callback only runs later,
  // from a click, so it always sees the latest values.
  useEffect(() => {
    apiRef.current = api;
    userIdRef.current = userId;
  }, [api, userId]);

  return useCallback(async (input) => {
    const operator = userIdRef.current;
    if (!operator) {
      return {
        success: false,
        error: "Sign in again to take this payment.",
      };
    }
    try {
      const payload = buildBasketCheckoutPayload({
        ...input,
        userId: operator,
      });
      const result = await apiRef.current.rechargeBasketCheckout(payload);
      if (result?.success) return { success: true };
      return {
        success: false,
        error: result?.error || "Failed to process payment",
      };
    } catch (err) {
      logger.error("Recharge basket checkout failed:", err);
      return {
        success: false,
        error: getApiErrorMessage(err, "Failed to process payment"),
      };
    }
  }, []);
}

export type PartnerOrderResult =
  | { success: true }
  | { success: false; error: string };

/**
 * LIRA-327 — "For Partner" across the basket: every provider's partner
 * sales in ONE all-or-nothing submit (`useApi().rechargePartnerOrder`, rule
 * 19). Same ref pattern as the checkout above (rule 25).
 */
export function useRechargePartnerOrder(): (
  input: Omit<BuildPartnerOrderInput, "userId">,
) => Promise<PartnerOrderResult> {
  const api = useApi();
  const apiRef = useRef(api);
  const userId = useOptionalAuth()?.user?.id;
  const userIdRef = useRef(userId);
  useEffect(() => {
    apiRef.current = api;
    userIdRef.current = userId;
  }, [api, userId]);

  return useCallback(async (input) => {
    const operator = userIdRef.current;
    if (!operator) {
      return { success: false, error: "Sign in again to submit this order." };
    }
    try {
      const payload = buildPartnerOrderPayload({ ...input, userId: operator });
      const result = await apiRef.current.rechargePartnerOrder(payload);
      if (result?.success) return { success: true };
      return {
        success: false,
        error: result?.error || "Failed to process partner transaction",
      };
    } catch (err) {
      logger.error("Recharge partner order failed:", err);
      return {
        success: false,
        error: getApiErrorMessage(err, "Failed to process partner transaction"),
      };
    }
  }, []);
}
