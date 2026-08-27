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
  useRef,
} from "react";
import { useApi } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";

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
  const { isAuthenticated } = useAuth();
  // Not `true` — an unauthenticated app has nothing in flight yet, and the
  // gate below flips this to `false` again on the very first render anyway.
  // Starting `true` would show a permanent spinner to any consumer that
  // renders before login (there currently isn't one, but nothing should
  // depend on that staying true).
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `api` from useApi() is a stable module-level singleton in production
  // (backendApiAdapter, passed straight through ApiProvider), but nothing
  // enforces that at this call site — an adapter that returns a fresh object
  // identity per render (as a mock legitimately can) would give
  // `loadCurrencies` a new identity every render, which the effect below
  // depends on. Reading `api` through a ref keeps `loadCurrencies` stable
  // regardless of the adapter's identity, without a stale closure: the ref
  // is reassigned every render, so `apiRef.current` is always current when
  // the callback actually runs.
  const apiRef = useRef(api);
  apiRef.current = api;

  const loadCurrencies = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await apiRef.current.getCurrencies();
      setCurrencies(Array.isArray(data) ? (data as CurrencyInfo[]) : []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load currencies",
      );
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiRef.current is read at call time, not captured; no dep needed
  }, []);

  // In web mode GET /api/currencies is JWT-gated (backend/src/api/currencies.ts).
  // A mount-only fetch ran once at app boot before login, 401ed, and left
  // `currencies` permanently empty — every amount then fell back to its CODE
  // instead of its SYMBOL (getSymbol below returns `code` when the list is
  // empty). Gate the load on auth and re-run on the false -> true transition
  // (mirrors MobileServiceItemsProvider's isAuthenticated gate). Desktop is
  // unaffected in substance — IPC never needed a JWT — but it now also waits
  // for login, which is already true before any currency-consuming route can
  // render (all of them sit behind ProtectedRoute/AdminRoute).
  useEffect(() => {
    if (!isAuthenticated) {
      // Nothing to show pre-login: don't sit in a permanent "loading" state,
      // and don't carry a stale fetch error (or a previous user's currency
      // list) across a logout.
      setCurrencies([]);
      setIsLoading(false);
      setError(null);
      return;
    }
    loadCurrencies();
  }, [isAuthenticated, loadCurrencies]);

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
      const formatted = safeAmt.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
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
