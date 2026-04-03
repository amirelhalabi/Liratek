/**
 * useExchangeRate Hook
 *
 * Loads the USD↔LBP exchange rate from the database (rates table).
 * Falls back to the legacy EXCHANGE_RATE constant when unavailable.
 *
 * Supports BOTH schemas:
 *   New 4-column: { to_code, market_rate, delta, is_stronger }
 *   Legacy:       { from_code, to_code, rate }
 *
 * Direction semantics (matches currencyConverter.ts):
 *   fromCode="USD" → we give USD = GIVE_USD (+1) → sell rate (higher)
 *   fromCode≠"USD" → we take USD = TAKE_USD (−1) → buy rate (lower)
 *
 * Usage:
 *   const { rate, isLoading } = useExchangeRate("USD", "LBP");
 */

import { useState, useEffect } from "react";
import { EXCHANGE_RATE, useApi } from "@liratek/ui";

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
  const api = useApi();
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

        // ── New 4-column schema ──────────────────────────────────────────
        // The non-USD currency code is what we look up
        const code = fromCode === "USD" ? toCode : fromCode;

        const newMatch = rates.find(
          (r: any) => r.to_code === code && r.market_rate !== undefined,
        );
        if (newMatch) {
          const { market_rate, delta, is_stronger } = newMatch;
          // fromCode="USD" → we give USD (GIVE_USD, action=+1) → sell rate
          // fromCode≠"USD" → we take USD (TAKE_USD, action=−1) → buy rate
          const action = fromCode === "USD" ? +1 : -1;
          const computed = market_rate + is_stronger * (action * delta);
          setRate(computed);
          return;
        }

        // ── Legacy from/to schema ────────────────────────────────────────
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
