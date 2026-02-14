/**
 * useSystemExpected Hook
 * Fetches system expected balances for closing
 */

import { useState, useCallback } from "react";
import type { SystemExpectedBalances } from "../types";
import * as api from "../../../api/backendApi";

export function useSystemExpected() {
  const [systemExpected, setSystemExpected] =
    useState<SystemExpectedBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSystemExpected = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const balances = await api.getSystemExpectedBalances();
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
      const drawerKeyMap: Record<string, keyof SystemExpectedBalances> = {
        General: "generalDrawer",
        OMT_System: "omtDrawer",
        OMT_App: "omtAppDrawer",
        Whish_App: "whishDrawer",
        Binance: "binanceDrawer",
        MTC: "mtcDrawer",
        Alfa: "alfaDrawer",
        IPEC: "ipecDrawer",
        Katch: "katchDrawer",
        Wish_App_Money: "wishAppDrawer",
      };

      const drawerKey = drawerKeyMap[drawer] ?? ("generalDrawer" as const);
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
