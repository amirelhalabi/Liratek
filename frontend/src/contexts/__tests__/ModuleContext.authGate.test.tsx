/** @jest-environment jsdom */
/**
 * ModuleProvider / FeatureFlagProvider — auth gate
 *
 * Reported live 2026-09-08: immediately after signing in, the sidebar showed
 * only "Checkpoint Timeline", the dashboard was missing its Total Debt tile,
 * and Drawer Balances showed one card instead of ten. A plain reload fixed it
 * completely.
 *
 * Root cause, identical in shape to the CurrencyProvider bug next door: the
 * load effect fired once on mount, and both providers were mounted ABOVE
 * `AuthProvider` in App.tsx. In web mode `/api/modules/enabled` is JWT-gated,
 * so a boot-time fetch with no token was rejected, the module list stayed
 * empty, and nothing ever retried. On reload the token was already in
 * localStorage, so the same fetch succeeded — hence "broken until refresh".
 *
 * Desktop was unaffected because IPC needs no JWT, which is exactly why this
 * survived until the app was driven over REST.
 *
 * The fix has two parts. This file covers the second directly; the first is a
 * plain JSX reorder in App.tsx with no separate unit to assert, though it is
 * load-bearing for this one — `useAuth()` THROWS outside `AuthProvider`, so
 * the gate could not even run from the old position.
 *   1. Both providers moved below `AuthProvider`.
 *   2. The load effect is gated on `useAuth().isAuthenticated` and re-runs on
 *      the false -> true transition.
 *
 * INTENTIONALLY UNSTABLE `useApi()` MOCK — do not "fix" this to a memoized
 * object. Returning a fresh object every render is what the CurrencyContext
 * test discovered catches a real infinite loop: with `useCallback(..., [api])`,
 * a churning adapter identity gives the loader a new identity each render, the
 * effect depends on it, it re-fires, sets state, re-renders, forever. Both
 * providers now read `api` through a ref for that reason. Memoizing this mock
 * would silently drop the coverage.
 */

import { render, screen, waitFor } from "@testing-library/react";

const getEnabledModules = jest.fn();
const getFeatureFlags = jest.fn();

let isAuthenticated = false;

jest.mock("@liratek/ui", () => ({
  // Deliberately a NEW object identity on every render — see the header.
  useApi: () => ({ getEnabledModules, getFeatureFlags }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated }),
}));

import { ModuleProvider, useModules } from "../ModuleContext";

const MODULES = [
  { key: "pos", label: "Point of Sale", icon: "cart", is_enabled: 1 },
  { key: "clients", label: "Clients", icon: "users", is_enabled: 1 },
  { key: "loto", label: "Loto", icon: "ticket", is_enabled: 0 },
];

/** Renders the enabled-module labels the sidebar would show. */
function Probe() {
  const { enabledModules } = useModules();
  return (
    <div data-testid="modules">
      {enabledModules.length === 0
        ? "none"
        : enabledModules.map((m) => m.label).join(",")}
    </div>
  );
}

function renderProvider() {
  return render(
    <ModuleProvider>
      <Probe />
    </ModuleProvider>,
  );
}

describe("ModuleProvider auth gate", () => {
  beforeEach(() => {
    getEnabledModules.mockReset();
    getEnabledModules.mockResolvedValue(MODULES);
    isAuthenticated = false;
  });

  it("does NOT fetch before the user is authenticated", async () => {
    renderProvider();

    // The pre-fix behaviour: fetch at boot, get rejected, cache empty forever.
    await waitFor(() => {
      expect(screen.getByTestId("modules")).toHaveTextContent("none");
    });
    expect(getEnabledModules).not.toHaveBeenCalled();
  });

  it("fetches once the user IS authenticated", async () => {
    isAuthenticated = true;
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("modules")).toHaveTextContent(
        "Point of Sale,Clients",
      );
    });
    // Disabled modules stay out of the sidebar.
    expect(screen.getByTestId("modules")).not.toHaveTextContent("Loto");
  });

  it("loads on the false -> true transition, without a reload", async () => {
    // This is the actual bug: the app mounts unauthenticated, the user logs in,
    // and the module list must fill in by itself.
    const { rerender } = renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("modules")).toHaveTextContent("none");
    });

    isAuthenticated = true;
    rerender(
      <ModuleProvider>
        <Probe />
      </ModuleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("modules")).toHaveTextContent(
        "Point of Sale,Clients",
      );
    });
  });

  it("does not re-fetch endlessly despite an unstable api identity", async () => {
    isAuthenticated = true;
    renderProvider();

    await waitFor(() => {
      expect(getEnabledModules).toHaveBeenCalled();
    });

    // Settle, then confirm the effect is not re-firing on every render. A
    // churning `api` identity used to make this climb without bound (and hang
    // the test runner outright).
    await new Promise((r) => setTimeout(r, 150));
    expect(getEnabledModules.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("keeps the previous list when a fetch fails", async () => {
    isAuthenticated = true;
    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId("modules")).toHaveTextContent("Point of Sale");
    });

    // A transient failure must not blank the sidebar.
    getEnabledModules.mockRejectedValueOnce(new Error("network"));
    window.dispatchEvent(new Event("modules-changed"));

    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByTestId("modules")).toHaveTextContent("Point of Sale");
  });
});
