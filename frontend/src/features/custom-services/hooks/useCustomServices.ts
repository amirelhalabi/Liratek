/**
 * useCustomServices Hook
 *
 * Fetches Custom Services from dedicated custom_services API and computes today's stats.
 */

import { useState, useEffect, useCallback } from "react";
import { useApi } from "@liratek/ui";
import logger from "../../../utils/logger";

export interface CustomServiceEntry {
  id: number;
  description: string;
  cost_usd: number;
  cost_lbp: number;
  price_usd: number;
  price_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  paid_by: string;
  status: string;
  client_id: number | null;
  client_name: string | null;
  phone_number: string | null;
  note: string | null;
  created_by: number | null;
  created_at: string;
}

export interface CustomServiceSummary {
  count: number;
  totalCostUsd: number;
  totalCostLbp: number;
  totalPriceUsd: number;
  totalPriceLbp: number;
  totalProfitUsd: number;
  totalProfitLbp: number;
}

export function useCustomServices() {
  const api = useApi();
  const [history, setHistory] = useState<CustomServiceEntry[]>([]);
  const [summary, setSummary] = useState<CustomServiceSummary>({
    count: 0,
    totalCostUsd: 0,
    totalCostLbp: 0,
    totalPriceUsd: 0,
    totalPriceLbp: 0,
    totalProfitUsd: 0,
    totalProfitLbp: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [services, summaryData] = await Promise.all([
        api.getCustomServices(),
        api.getCustomServicesSummary(),
      ]);
      setHistory(services ?? []);
      setSummary(
        summaryData ?? {
          count: 0,
          totalCostUsd: 0,
          totalCostLbp: 0,
          totalPriceUsd: 0,
          totalPriceLbp: 0,
          totalProfitUsd: 0,
          totalProfitLbp: 0,
        },
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load service history";
      setError(message);
      logger.error("[useCustomServices] Error:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    history,
    summary,
    loading,
    error,
    reload: loadData,
  };
}
