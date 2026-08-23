import { useEffect, useMemo, useState } from "react";
import type { CurrencyRate } from "@liratek/core";
import logger from "@/utils/logger";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import {
  fetchLiveRatesSnapshot,
  CURRENCY_NAMES,
  getCurrencySymbol,
  EXCLUDED_CURRENCIES,
} from "@/utils/liveExchangeRates";

/**
 * The Exchange module's currency list — extracted (2026-08-23,
 * EXCHANGE_LOT_SETTLEMENT.md Q3 refinement, AC1) from the Exchange page's own
 * `CurrencySelector`, so BOTH the Exchange page's "From"/"To" picker AND
 * DrawerTopUpModal's "Other Currencies" picker offer the exact same set,
 * instead of DrawerTopUpModal being restricted to a currency's General-drawer
 * configuration (the previous, narrower policy — see
 * `docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md`, now superseded for
 * the top-up picker specifically by this hook).
 *
 * `options` is the merge of:
 *  - "locally configured, feed-excluded" active currencies — i.e. codes in
 *    `EXCLUDED_CURRENCIES` (the set the live feed deliberately omits because
 *    they're managed in Settings instead) other than USD/LBP. Today that is
 *    exactly EUR — behavior-identical to the Exchange page's previous
 *    hardcoded `code === "EUR"` lookup, but keyed off the SAME constant the
 *    feed itself uses to decide what to leave out (rule 14 — one source, not
 *    a second EUR literal).
 *  - every currency the live FX feed carries (`liveCurrencyRates` — already
 *    excludes USD/LBP/EUR, see `liveExchangeRates.ts`).
 *
 * USD and LBP are never in `options` — both callers give them a dedicated,
 * always-visible slot instead (Exchange's `fixedCodes` buttons; the top-up
 * modal's dedicated USD/LBP amount inputs).
 *
 * Also returns the raw feed pieces (`liveCurrencyRates`, `marketRates`,
 * `liveUpdatedUtc`, `liveLoading`) the Exchange page needs directly for its
 * own rate calculations and market-reference panel — extracting the fetch
 * effect here means Exchange no longer owns it, but callers that only need
 * the picker (DrawerTopUpModal) can ignore those fields.
 */
export interface ExchangeCurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export interface UseExchangeCurrencyListResult {
  /** Configured (feed-excluded) currencies + the live feed, merged. Never
   *  includes USD/LBP. */
  options: ExchangeCurrencyOption[];
  /** Raw live-feed rates (USD/LBP/EUR excluded) — feeds exchange-rate math. */
  liveCurrencyRates: CurrencyRate[];
  /** Full feed (LBP/EUR included) for the market-reference panel. */
  marketRates: CurrencyRate[];
  /** The feed's own publish time, verbatim — never a live ticker. */
  liveUpdatedUtc: string | undefined;
  liveLoading: boolean;
}

/**
 * @param enabled Gates the live-feed fetch — default `true` (the Exchange
 *   page's own pre-extraction behavior: fetch immediately on mount). Pass
 *   `false` while a consumer that isn't always "the currency exchange
 *   screen" — e.g. DrawerTopUpModal, which stays mounted under the Dashboard
 *   whether or not its dialog is open — doesn't need the feed yet. Matches
 *   this same file's/this codebase's existing convention of gating
 *   fetch effects on `isOpen` rather than firing on every mount
 *   (DrawerTopUpModal's own `getSourceDrawers`/`getSystemExpectedBalancesDynamic`
 *   effects do the same).
 */
export function useExchangeCurrencyList(
  enabled = true,
): UseExchangeCurrencyListResult {
  const { activeCurrencies } = useCurrencyContext();
  const [liveCurrencyRates, setLiveCurrencyRates] = useState<CurrencyRate[]>(
    [],
  );
  const [marketRates, setMarketRates] = useState<CurrencyRate[]>([]);
  const [liveUpdatedUtc, setLiveUpdatedUtc] = useState<string | undefined>();
  const [liveLoading, setLiveLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await fetchLiveRatesSnapshot();
        if (cancelled) return;
        setLiveCurrencyRates(snapshot.rates);
        setMarketRates(snapshot.marketRates);
        setLiveUpdatedUtc(snapshot.lastUpdatedUtc);
      } catch (e) {
        logger.error("Failed to load live rates", e);
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const options = useMemo<ExchangeCurrencyOption[]>(() => {
    const configured = activeCurrencies
      .filter(
        (c) =>
          EXCLUDED_CURRENCIES.has(c.code) &&
          c.code !== "USD" &&
          c.code !== "LBP",
      )
      .map((c) => ({
        code: c.code,
        name: c.name || CURRENCY_NAMES[c.code] || c.code,
        symbol: c.symbol || getCurrencySymbol(c.code),
      }));

    const fed = liveCurrencyRates.map((r) => ({
      code: r.to_code,
      name: CURRENCY_NAMES[r.to_code] ?? r.to_code,
      symbol: getCurrencySymbol(r.to_code),
    }));

    return [...configured, ...fed];
  }, [activeCurrencies, liveCurrencyRates]);

  return { options, liveCurrencyRates, marketRates, liveUpdatedUtc, liveLoading };
}
