/**
 * useExchangeRate Hook
 *
 * Loads the USD→LBP exchange rate from the database (rates table).
 * Falls back to the legacy EXCHANGE_RATE constant when unavailable.
 *
 * Usage:
 *   const { rate, isLoading } = useExchangeRate("USD", "LBP");
 */

import { useState, useEffect } from "react";
import * as api from "../api/backendApi";
import { EXCHANGE_RATE } from "@liratek/ui";

interface ExchangeRateResult {
  /** Current exchange rate */
  rate: number;
  /** True while the rate is being loaded from DB */
  isLoading: boolean;
}

/**
 * Load a specific exchange rate pair from the DB.
 * Falls back to the legacy `EXCHANGE_RATE` constant for USD→LBP.
 */
export function useExchangeRate(
  fromCode = "USD",
  toCode = "LBP",
): ExchangeRateResult {
  const [rate, setRate] = useState<number>(
    fromCode === "USD" && toCode === "LBP" ? EXCHANGE_RATE : 1,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rates = await api.getRates();
        if (cancelled) return;
        const match = rates.find(
          (r: { from_code: string; to_code: string; rate: number }) =>
            r.from_code === fromCode && r.to_code === toCode,
        );
        if (match) {
          setRate(match.rate);
        }
      } catch {
        // Keep fallback
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fromCode, toCode]);

  return { rate, isLoading };
}
