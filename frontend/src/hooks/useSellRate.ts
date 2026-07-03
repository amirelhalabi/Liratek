/**
 * useSellRate Hook
 *
 * Shared USD↔LBP exchange-rate source. Loads the rates from the DB and returns
 * both sides of `getExchangeRates(rates)`:
 *
 *  - `sellRate` — the rate the shop SELLS USD at (higher, favourable to us).
 *    Every Money-IN surface (session checkout, recharge forms, app-transfer
 *    SEND) must read the rate from here so the recorded rate is consistent.
 *  - `buyRate` — the rate the shop BUYS USD at (lower, favourable to us).
 *    Money-OUT surfaces (e.g. an app-transfer RECEIVE cashout, where the shop
 *    pays the customer) must use this one — paying out at the sell rate gives
 *    the customer our margin.
 *
 * Do NOT use this for exchange-module / mid-rate consumers — those need the
 * market rate via `useExchangeRate` instead.
 *
 * Usage:
 *   const { sellRate, buyRate, isLoading } = useSellRate();
 */

import { useState, useEffect } from "react";
import { useApi } from "@liratek/ui";
import { getExchangeRates } from "@/utils/exchangeRates";

/** Fallbacks when the rates cannot be loaded (match the legacy inline defaults). */
const SELL_RATE_FALLBACK = 89500;
const BUY_RATE_FALLBACK = 89000;

interface SellRateResult {
  /** Current SELL rate (1 USD = X LBP) — Money IN, customer pays us. */
  sellRate: number;
  /** Current BUY rate (1 USD = X LBP) — Money OUT, we pay the customer. */
  buyRate: number;
  /** True while the rates are being loaded from the DB. */
  isLoading: boolean;
}

export function useSellRate(): SellRateResult {
  const api = useApi();
  const [sellRate, setSellRate] = useState<number>(SELL_RATE_FALLBACK);
  const [buyRate, setBuyRate] = useState<number>(BUY_RATE_FALLBACK);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api
      .getRates()
      .then((rates: unknown[]) => {
        if (cancelled) return;
        const parsed = getExchangeRates(rates);
        setSellRate(parsed.sellRate);
        setBuyRate(parsed.buyRate);
      })
      .catch(() => {
        /* keep fallbacks */
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  return { sellRate, buyRate, isLoading };
}
