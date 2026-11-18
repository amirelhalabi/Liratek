/**
 * usePaymentMethods Hook
 *
 * Loads active payment methods from the database.
 * Provides convenient filtered lists for different use cases.
 *
 * Usage:
 *   const { methods, drawerAffectingMethods, allMethods, loading } = usePaymentMethods();
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import type { PaymentMethodEntity } from "@liratek/ui";
import { labelCashByDrawer } from "@/shared/utils/cashDrawerMethod";

export type { PaymentMethodEntity };

/** A method as the forms list it (owner 2026-11-18): the Cash entry reads
 *  "Cash · General" — the label names the drawer the cash goes to — and
 *  keeps the bare "Cash" in `rawLabel` for screens that relabel it again
 *  (the OMT transfer forms, the OMT Settle Account sheet). */
export type ListedPaymentMethod = PaymentMethodEntity & { rawLabel?: string };

interface UsePaymentMethodsResult {
  /** All active payment methods */
  methods: ListedPaymentMethod[];
  /** Only methods that affect a drawer (excludes DEBT) */
  drawerAffectingMethods: ListedPaymentMethod[];
  /** All active methods including DEBT */
  allMethods: ListedPaymentMethod[];
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
  const { t } = useTranslation("payment");
  const [loaded, setMethods] = useState<PaymentMethodEntity[]>([]);
  // ONE relabel for every form (rule 14): Cash → "Cash · General".
  const methods = useMemo<ListedPaymentMethod[]>(
    () => labelCashByDrawer(loaded, t("cashDrawerChoice.general")),
    [loaded, t],
  );
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

  // Re-fetch when payment methods are changed elsewhere (e.g. Settings)
  useEffect(() => {
    const handler = () => {
      refresh();
    };
    window.addEventListener("payment-methods-changed", handler);
    return () => window.removeEventListener("payment-methods-changed", handler);
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
