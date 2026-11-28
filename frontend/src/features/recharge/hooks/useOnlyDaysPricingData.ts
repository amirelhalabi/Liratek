/**
 * The data Only Days pricing needs, loaded once per grid (LIRA-406; moved
 * from KatshForm so the Whish App grid uses the same load).
 *
 * `sell_days_lbp` / `sell_credit_lbp` / `max_returned_credits_usd` live on
 * `mobile_service_items` but the shared `ServiceItem` type does not map them
 * through, so they are read here through the dual-mode adapter (rule 19).
 * `getActiveMobileServiceItems` is a public read, safe for every operator.
 *
 * Rule 25: `api` is read through a ref and is never an effect dependency.
 * `catalogPricingRef` gives memoised callbacks (the Only Days toggle) the
 * latest map without changing their identity.
 */
import { useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import logger from "@/utils/logger";
import {
  TELECOM_CREDIT_SELL_PRICE_SETTING_KEY,
  type CatalogPricingRow,
} from "../utils/onlyDaysPricing";

export interface OnlyDaysPricingData {
  catalogPricing: Map<number, CatalogPricingRow>;
  catalogPricingRef: { readonly current: Map<number, CatalogPricingRow> };
  tenantCreditSellPriceLbp: number | null;
}

export function useOnlyDaysPricingData(): OnlyDaysPricingData {
  const api = useApi();
  const apiRef = useRef(api);
  const [catalogPricing, setCatalogPricing] = useState<
    Map<number, CatalogPricingRow>
  >(new Map());
  const [tenantCreditSellPriceLbp, setTenantCreditSellPriceLbp] = useState<
    number | null
  >(null);
  const catalogPricingRef = useRef(catalogPricing);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    catalogPricingRef.current = catalogPricing;
  }, [catalogPricing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [items, settings] = await Promise.all([
          apiRef.current.getActiveMobileServiceItems(),
          apiRef.current.getAllSettings(),
        ]);
        if (cancelled) return;
        const map = new Map<number, CatalogPricingRow>();
        for (const it of items) {
          map.set(it.id, {
            sell_days_lbp: it.sell_days_lbp,
            sell_credit_lbp: it.sell_credit_lbp,
            max_returned_credits_usd: it.max_returned_credits_usd,
          });
        }
        setCatalogPricing(map);
        const row = (
          settings as Array<{ key_name: string; value: string }>
        ).find((s) => s.key_name === TELECOM_CREDIT_SELL_PRICE_SETTING_KEY);
        const value = row ? Number(row.value) : NaN;
        if (Number.isFinite(value) && value > 0) {
          setTenantCreditSellPriceLbp(value);
        }
      } catch (err) {
        logger.error("Failed to load Only-Days pricing catalog:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalogPricing, catalogPricingRef, tenantCreditSellPriceLbp };
}
