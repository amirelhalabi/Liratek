/** @jest-environment jsdom */
/**
 * CurrencyProvider — auth gate (web-mode currency-symbol bug)
 *
 * `frontend/tests/e2e-web/lira-web-026-general-drawer-foreign-currency.spec.ts`
 * timed out polling the Dashboard for a `€` figure; the REST helpers in that
 * spec already proved the underlying data was correct (EUR is present in
 * both `/api/closing/system-expected-balances-dynamic` and
 * `/api/currencies/countable-drawer-currencies`) — only the RENDER was wrong.
 *
 * Root cause: `loadCurrencies` used to be a mount-only effect
 * (`useEffect(() => { loadCurrencies(); }, [loadCurrencies])`) that fired
 * once at app boot. In web mode `GET /api/currencies` is JWT-gated
 * (`backend/src/api/currencies.ts`), and `CurrencyProvider` used to be
 * mounted ABOVE `AuthProvider` in `App.tsx`. A boot-time fetch with no JWT
 * yet -> 401 -> `currencies` stayed `[]` forever (no retry after login).
 * `getSymbol` falls back to the raw code when a currency isn't found, and
 * `formatAmount` only prefixes `$`/`€`/`£`, so every amount rendered like
 * "300.00 EUR" instead of "€300.00". Desktop was unaffected because IPC
 * needs no JWT.
 *
 * The fix has two parts (this file only re-tests the second one directly —
 * the provider placement in App.tsx is a plain JSX reorder with no separate
 * unit to assert):
 *   1. `CurrencyProvider` moved below `AuthProvider` in App.tsx.
 *   2. The load effect here is gated on `useAuth().isAuthenticated` and
 *      re-runs on the false -> true transition, mirroring
 *      `MobileServiceItemsProvider`'s existing auth gate.
 *
 * These tests assert the FORMATTED OUTPUT of `formatAmount`, not just that
 * the currency array is non-empty — the formatted string is exactly what the
 * failing e2e spec polls the DOM for, so that's what must be guarded.
 *
 * INTENTIONALLY UNSTABLE `useApi()` MOCK — do not "fix" this to a memoized
 * object. `useApi: () => ({ getCurrencies: mockGetCurrencies })` returns a
 * brand-new object identity on every render, on purpose. That first exposed
 * a real bug: `loadCurrencies` was `useCallback(..., [api])`, so a churning
 * `api` identity gave `loadCurrencies` a new identity every render, which
 * the load effect depended on -> effect re-fires -> state update -> re-render
 * -> new `api` identity -> infinite loop (jest never returned). Production
 * only avoided this by accident, because `backendApiAdapter` happens to be a
 * module-level singleton passed straight through `ApiProvider` as the
 * context value — an implicit contract the provider itself did not enforce.
 * The fix reads `api` through a ref (`apiRef`) so `loadCurrencies` has a
 * stable identity with no stale closure, regardless of the adapter's
 * identity. Memoizing this mock would silently drop that regression
 * coverage.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { CurrencyProvider, useCurrencyContext } from "../CurrencyContext";

const mockGetCurrencies = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Fresh object literal every call — see the file-level comment above.
  useApi: () => ({
    getCurrencies: mockGetCurrencies,
  }),
}));

// `useAuth()` is called fresh on every render of `CurrencyProvider`, so
// reassigning this before calling `rerender()` is enough to simulate the
// unauthenticated -> authenticated transition without standing up the real
// AuthProvider (session restore, setup-required checks, etc. are irrelevant
// to this bug and would only add unrelated async noise).
let mockIsAuthenticated = false;
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

const CURRENCIES = [
  {
    id: 1,
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    decimal_places: 2,
    is_active: 1,
  },
  {
    id: 3,
    code: "EUR",
    name: "Euro",
    symbol: "€",
    decimal_places: 2,
    is_active: 1,
  },
];

/** Reads the context the way a real consumer (e.g. Dashboard) would. */
function Probe() {
  const { currencies, formatAmount } = useCurrencyContext();
  return (
    <div>
      <span data-testid="count">{currencies.length}</span>
      <span data-testid="formatted">{formatAmount(300, "EUR")}</span>
    </div>
  );
}

describe("CurrencyProvider — auth gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAuthenticated = false;
    mockGetCurrencies.mockResolvedValue(CURRENCIES);
  });

  it("does not call getCurrencies while unauthenticated and exposes no currencies", async () => {
    render(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>,
    );

    // Let any stray microtask flush before asserting the negative.
    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("0");
    });

    expect(mockGetCurrencies).not.toHaveBeenCalled();
    // Pre-fix symptom, reproduced directly: no symbol data yet -> the CODE
    // leaks into the formatted string instead of the € symbol.
    expect(screen.getByTestId("formatted").textContent).toBe("300.00 EUR");
  });

  it("fetches currencies once authenticated and resolves the real symbol", async () => {
    mockIsAuthenticated = true;

    render(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>,
    );

    await waitFor(() => {
      expect(mockGetCurrencies).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("formatted").textContent).toBe("€300.00");
    });
  });

  it("re-runs the load on the unauthenticated -> authenticated transition", async () => {
    const { rerender } = render(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>,
    );

    // Still logged out: no fetch, code-fallback formatting.
    expect(mockGetCurrencies).not.toHaveBeenCalled();
    expect(screen.getByTestId("formatted").textContent).toBe("300.00 EUR");

    // Simulate login and force CurrencyProvider to re-render and re-read
    // useAuth() (a mount-only effect — the actual bug — would never pick
    // this up).
    mockIsAuthenticated = true;
    rerender(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>,
    );

    await waitFor(() => {
      expect(mockGetCurrencies).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("formatted").textContent).toBe("€300.00");
    });
  });
});
