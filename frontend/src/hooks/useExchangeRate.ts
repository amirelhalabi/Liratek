/**
 * useExchangeRate Hook
 *
 * Loads the USD↔LBP exchange rate from the database (rates table).
 * Falls back to the legacy EXCHANGE_RATE constant when unavailable.
 *
 * Supports BOTH schemas:
 *   Current (v59+): { to_code, market_rate, buy_rate, sell_rate, is_stronger }
 *   Legacy:         { from_code, to_code, rate }
 *
 * Direction semantics (matches useSellRate / getExchangeRates):
 *   fromCode="USD" → we give USD → sell rate (higher, favourable to us)
 *   fromCode≠"USD" → we take USD → buy rate (lower, favourable to us)
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

        // ── Current schema (v59+): explicit buy/sell columns ─────────────
        // (The old `delta` field no longer exists — computing with it made
        // the rate NaN for every consumer as soon as a real rate row existed.)
        const code = fromCode === "USD" ? toCode : fromCode;
        const newMatch = rates.find(
          (r: {
            to_code?: string;
            market_rate?: number;
            buy_rate?: number;
            sell_rate?: number;
          }) => r.to_code === code && r.market_rate !== undefined,
        );
        if (newMatch) {
          // fromCode="USD" → we give USD → sell rate; else we take USD → buy.
          const computed =
            fromCode === "USD"
              ? (newMatch.sell_rate ?? newMatch.market_rate)
              : (newMatch.buy_rate ?? newMatch.market_rate);
          if (
            computed !== undefined &&
            Number.isFinite(computed) &&
            computed > 0
          ) {
            setRate(computed);
          }
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
