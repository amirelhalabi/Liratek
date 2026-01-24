/**
 * useSystemExpected Hook
 * Fetches system expected balances for closing
 */

import { useState, useCallback } from "react";
import type { SystemExpectedBalances } from "../types";

export function useSystemExpected() {
  const [systemExpected, setSystemExpected] =
    useState<SystemExpectedBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSystemExpected = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const balances = window.api
        ? await window.api.closing.getSystemExpectedBalances()
        : await (async () => {
            const { getSystemExpectedBalances } = await import('../../../api/backendApi');
            return getSystemExpectedBalances();
          })();
      setSystemExpected(balances);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to fetch expected balances";
      setError(message);
      console.error("[useSystemExpected] Error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const getExpectedAmount = useCallback(
    (drawer: string, currencyCode: string): number => {
      if (!systemExpected) return 0;
      const drawerKey =
        `${drawer.toLowerCase()}Drawer` as keyof SystemExpectedBalances;
      const drawerBalances = systemExpected[drawerKey];
      return drawerBalances?.[currencyCode.toLowerCase()] || 0;
    },
    [systemExpected],
  );

  return {
    systemExpected,
    loading,
    error,
    fetchSystemExpected,
    getExpectedAmount,
  };
}
