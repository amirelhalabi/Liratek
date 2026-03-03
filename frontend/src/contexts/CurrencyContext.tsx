/**
 * Currency Context
 *
 * Provides application-wide currency data loaded from the database.
 * Replaces feature-scoped useCurrencies hooks with a single source of truth.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useApi } from "@liratek/ui";

export interface CurrencyInfo {
  id: number;
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  is_active: number;
}

interface CurrencyContextType {
  currencies: CurrencyInfo[];
  activeCurrencies: CurrencyInfo[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getSymbol: (code: string) => string;
  getDecimals: (code: string) => number;
  formatAmount: (
    amount: number | null | undefined,
    currencyCode: string,
  ) => string;
  getCurrenciesForModule: (moduleKey: string) => Promise<CurrencyInfo[]>;
  getCurrenciesForDrawer: (drawerName: string) => Promise<CurrencyInfo[]>;
}

const CurrencyContext = createContext<CurrencyContextType | null>(null);

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const api = useApi();
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCurrencies = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.getCurrencies();
      setCurrencies(Array.isArray(data) ? (data as CurrencyInfo[]) : []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load currencies",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCurrencies();
  }, [loadCurrencies]);

  const activeCurrencies = currencies.filter((c) => c.is_active);

  const getSymbol = useCallback(
    (code: string): string => {
      const c = currencies.find((x) => x.code === code);
      return c?.symbol || code;
    },
    [currencies],
  );

  const getDecimals = useCallback(
    (code: string): number => {
      const c = currencies.find((x) => x.code === code);
      return c?.decimal_places ?? 2;
    },
    [currencies],
  );

  const formatAmount = useCallback(
    (amount: number | null | undefined, currencyCode: string): string => {
      // Guard: null/undefined/NaN amounts (can come from DB aggregates with no rows)
      const safe = Number(amount ?? 0);
      const safeAmt = isNaN(safe) ? 0 : safe;
      const decimals = getDecimals(currencyCode);
      const sym = getSymbol(currencyCode);
      const formatted = safeAmt.toFixed(decimals);
      // Prefix-style for $, €, £; suffix-style for LBP, USDT, etc.
      if (["$", "€", "£"].includes(sym)) return `${sym}${formatted}`;
      return `${formatted} ${sym}`;
    },
    [getDecimals, getSymbol],
  );

  const getCurrenciesForModule = useCallback(
    async (moduleKey: string): Promise<CurrencyInfo[]> => {
      try {
        const result = await api.getCurrenciesByModule(moduleKey);
        return (result ?? []) as CurrencyInfo[];
      } catch {
        return [];
      }
    },
    [api],
  );

  const getCurrenciesForDrawer = useCallback(
    async (drawerName: string): Promise<CurrencyInfo[]> => {
      try {
        const result = await api.getFullCurrenciesByDrawer(drawerName);
        return (result ?? []) as CurrencyInfo[];
      } catch {
        return [];
      }
    },
    [api],
  );

  return (
    <CurrencyContext.Provider
      value={{
        currencies,
        activeCurrencies,
        isLoading,
        error,
        refresh: loadCurrencies,
        getSymbol,
        getDecimals,
        formatAmount,
        getCurrenciesForModule,
        getCurrenciesForDrawer,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
};

export function useCurrencyContext(): CurrencyContextType {
  const ctx = useContext(CurrencyContext);
  if (!ctx)
    throw new Error("useCurrencyContext must be used within CurrencyProvider");
  return ctx;
}
