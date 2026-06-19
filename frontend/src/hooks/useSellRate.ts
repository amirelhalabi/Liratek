/**
 * useSellRate Hook
 *
 * Shared Money-IN exchange-rate source. Loads the USD↔LBP rates from the DB and
 * returns `getExchangeRates(rates).sellRate` — the rate the shop SELLS USD at
 * (higher, favourable to us). Every Money-IN surface (session checkout, recharge
 * forms, app transfers) must read the rate from here so the recorded rate is
 * consistent across the app.
 *
 * Do NOT use this for exchange-module / mid-rate consumers — those need the
 * market/buy rate via `useExchangeRate` instead.
 *
 * Usage:
 *   const { sellRate, isLoading } = useSellRate();
 */

import { useState, useEffect } from "react";
import { useApi } from "@liratek/ui";
import { getExchangeRates } from "@/utils/exchangeRates";

/** Fallback when the rate cannot be loaded (matches the legacy inline default). */
const SELL_RATE_FALLBACK = 89500;

interface SellRateResult {
  /** Current SELL rate (1 USD = X LBP). */
  sellRate: number;
  /** True while the rate is being loaded from the DB. */
  isLoading: boolean;
}

export function useSellRate(): SellRateResult {
  const api = useApi();
  const [sellRate, setSellRate] = useState<number>(SELL_RATE_FALLBACK);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api
      .getRates()
      .then((rates: unknown[]) => {
        if (cancelled) return;
        setSellRate(getExchangeRates(rates).sellRate);
      })
      .catch(() => {
        /* keep fallback */
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  return { sellRate, isLoading };
}
