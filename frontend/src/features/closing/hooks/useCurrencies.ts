/**
 * useCurrencies Hook
 * Manages currency data fetching and state
 */

import { useState, useEffect } from "react";
import logger from "@/utils/logger";
import type { Currency } from "../types";
import { useApi } from "@liratek/ui";

export function useCurrencies() {
  const api = useApi();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCurrencies();
  }, []);

  const loadCurrencies = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await api.getCurrencies();
      const items = Array.isArray(list) ? list : [];
      const active = items
        .filter((c: Currency) => c.is_active === 1)
        .map((c: Currency) => ({
          code: c.code,
          name: c.name,
          is_active: c.is_active,
        }));
      setCurrencies(active);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load currencies";
      setError(message);
      logger.error("[useCurrencies] Error:", err);
    } finally {
      setLoading(false);
    }
  };

  return {
    currencies,
    loading,
    error,
    reload: loadCurrencies,
  };
}
