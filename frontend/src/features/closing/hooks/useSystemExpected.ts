/**
 * useSystemExpected Hook
 * Fetches system expected balances for closing (dynamic format)
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import logger from "@/utils/logger";
import { useApi } from "@liratek/ui";

/** Dynamic balances: Record<drawerName, Record<currencyCode, balance>> */
export type DynamicBalances = Record<string, Record<string, number>>;

export function useSystemExpected() {
  const { t } = useTranslation("closing");
  const api = useApi();
  const [systemExpected, setSystemExpected] = useState<DynamicBalances | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSystemExpected = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const balances = await api.getSystemExpectedBalancesDynamic();
      setSystemExpected(balances);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("save.expectedFailed");
      setError(message);
      logger.error("[useSystemExpected] Error:", err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const getExpectedAmount = useCallback(
    (drawer: string, currencyCode: string): number => {
      if (!systemExpected) return 0;
      return systemExpected[drawer]?.[currencyCode] ?? 0;
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
