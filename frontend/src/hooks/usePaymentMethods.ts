/**
 * usePaymentMethods Hook
 *
 * Loads active payment methods from the database.
 * Provides convenient filtered lists for different use cases.
 *
 * Usage:
 *   const { methods, drawerAffectingMethods, allMethods, loading } = usePaymentMethods();
 */

import { useState, useEffect, useCallback } from "react";
import { useApi } from "@liratek/ui";
import type { PaymentMethodEntity } from "@liratek/ui";

export type { PaymentMethodEntity };

interface UsePaymentMethodsResult {
  /** All active payment methods */
  methods: PaymentMethodEntity[];
  /** Only methods that affect a drawer (excludes DEBT) */
  drawerAffectingMethods: PaymentMethodEntity[];
  /** All active methods including DEBT */
  allMethods: PaymentMethodEntity[];
  /** True while loading */
  loading: boolean;
  /** Re-fetch methods from DB */
  refresh: () => Promise<void>;
}

/**
 * Load active payment methods from the database.
 * Filters are computed from the loaded data.
 */
export function usePaymentMethods(): UsePaymentMethodsResult {
  const api = useApi();
  const [methods, setMethods] = useState<PaymentMethodEntity[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const active = await api.getActivePaymentMethods();
      setMethods(active);
    } catch {
      // Keep existing if fetch fails
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const drawerAffectingMethods = methods.filter((m) => m.affects_drawer === 1);

  return {
    methods,
    drawerAffectingMethods,
    allMethods: methods,
    loading,
    refresh,
  };
}
