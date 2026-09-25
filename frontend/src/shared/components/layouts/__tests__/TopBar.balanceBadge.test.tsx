/** @jest-environment jsdom */
/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule, 2026-09-24
 * batch: build first, verify once at the end).
 *
 * LIRA-212 Tier A — TopBar's session account-balance badge.
 *
 * Pre-fix behaviour (rule 17 — this is what these tests must FAIL against,
 * by temporarily reverting the balance-fetch effect to call
 * `window.api.debt.getClientBalance(...)` directly):
 *   - `window.api` is `undefined` in the browser, so that call threw a
 *     TypeError synchronously, the surrounding try/catch swallowed it, and
 *     the badge never rendered on web at all (rule 19 violation).
 *   - The refresh listener was `appEvents.on("debt:repayment", handler)`,
 *     which nothing in frontend/src ever emitted — so even on desktop the
 *     badge went stale after a Debts-page write until the session changed
 *     or the app reloaded.
 *
 * Post-fix: the badge reads `useApi().getClientBalance` (the existing
 * dual-mode adapter — desktop IPC / web REST), through a ref per rule 25,
 * and refreshes on the new "debt:changed" event that every account write
 * and session checkout now emits.
 *
 * INTENTIONALLY UNSTABLE `useApi()` mock (see
 * `CurrencyContext.authGate.test.tsx` for the precedent): a fresh object
 * literal every call is what production's module-level `backendApiAdapter`
 * singleton hides — if TopBar ever put `api` itself (instead of `apiRef`)
 * into an effect's dependency array, this mock would turn that into an
 * infinite synchronous render loop instead of quietly passing.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { appEvents } from "@liratek/ui";
import TopBar from "../TopBar";

const mockGetClients = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetLowStockProducts = jest.fn();
const mockGetAllSettings = jest.fn();
const mockGetSystemExpectedBalancesDynamic = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Fresh object every call — see the file-level comment above. Do NOT
  // memoize this; it is what catches a re-introduced `[api]` dependency.
  useApi: () => ({
    getClients: mockGetClients,
    getClientBalance: mockGetClientBalance,
    getLowStockProducts: mockGetLowStockProducts,
    getAllSettings: mockGetAllSettings,
    getSystemExpectedBalancesDynamic: mockGetSystemExpectedBalancesDynamic,
  }),
}));

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({
    user: { username: "cashier", role: "staff" },
    logout: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopName: () => "",
}));

jest.mock("@/contexts/FeatureFlagContext", () => ({
  // customerSessions: false keeps CustomerSessionButton (and its own,
  // unrelated dependency tree) out of this render entirely.
  useFeatureFlags: () => ({
    flags: { customerSessions: false, sessionManagement: true },
  }),
}));

jest.mock("@/hooks/useVoiceBotSettings", () => ({
  useVoiceBotSettings: () => ({ config: { enabled: false } }),
}));

// TopBar imports these unconditionally (they render behind flags, but the
// import itself is eager). VoiceBotButton's chain reaches
// HuggingFaceASRClient, which reads `import.meta.env` at module scope —
// ts-jest compiles to CommonJS and TS1343s on that syntax outside the one
// mapped exception (frontend/jest.config.ts, `@/config/viteEnv`). Without
// this mock the whole suite fails in setup/transform, before any test body
// runs (rule 28a) — the exact risk reviewer finding #1 named.
jest.mock("@/components/VoiceBotButton", () => ({
  VoiceBotButton: () => null,
}));
// Not rendered here (customerSessions: false above), but mocked defensively
// so its own import chain (SessionFloatingWindow, StartSessionModal) can
// never resurface the same failure mode if that flag or this test changes.
jest.mock("@/features/sessions/components/CustomerSessionButton", () => ({
  CustomerSessionButton: () => null,
}));

jest.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

jest.mock("@/shared/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
}));

let mockActiveSession: { id: number; customer_phone?: string } | null = null;
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: mockActiveSession }),
}));

const CLIENT = { id: 42, phone_number: "70123456" };

describe("TopBar — session account-balance badge (LIRA-212 Tier A)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveSession = { id: 1, customer_phone: "70123456" };
    mockGetClients.mockResolvedValue([CLIENT]);
    mockGetLowStockProducts.mockResolvedValue([]);
    mockGetAllSettings.mockResolvedValue([]);
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({});
    // No `window.api` -- this IS "web mode" (rule 19). The pre-fix code
    // called `window.api.debt.getClientBalance` straight off this
    // `undefined`, which is exactly what should have thrown.
    expect((window as any).api).toBeUndefined();
  });

  it("renders the balance badge via the dual-mode adapter with no window.api present", async () => {
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 50, balance_lbp: 0 },
    });

    render(<TopBar />);

    await waitFor(() => {
      expect(mockGetClientBalance).toHaveBeenCalledWith(CLIENT.id);
    });
    await waitFor(() => {
      expect(screen.getByText("$50.00")).toBeInTheDocument();
    });
    expect(screen.getByText("Debt")).toBeInTheDocument();
    // Confirms the fetch never went near the raw bridge.
    expect((window as any).api).toBeUndefined();
  });

  it("refreshes live on 'debt:changed', emitted by every account write and session checkout", async () => {
    mockGetClientBalance
      .mockResolvedValueOnce({
        success: true,
        data: { balance_usd: 50, balance_lbp: 0 },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { balance_usd: 10, balance_lbp: 0 },
      });

    render(<TopBar />);

    await waitFor(() => {
      expect(screen.getByText("$50.00")).toBeInTheDocument();
    });
    expect(mockGetClientBalance).toHaveBeenCalledTimes(1);

    act(() => {
      appEvents.emit("debt:changed");
    });

    await waitFor(() => {
      expect(mockGetClientBalance).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText("$10.00")).toBeInTheDocument();
    });
  });

  it("does NOT refresh on the retired 'debt:repayment' event (dead listener removed, not merely unused)", async () => {
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 50, balance_lbp: 0 },
    });

    render(<TopBar />);

    await waitFor(() => {
      expect(mockGetClientBalance).toHaveBeenCalledTimes(1);
    });

    act(() => {
      // "debt:repayment" is no longer a typed event (removed from
      // `EventMap`), but `emit`'s untyped string fallback overload still
      // lets it be fired — which is exactly what proves nothing listens
      // for it any more.
      appEvents.emit("debt:repayment");
    });

    // No await-worthy state change is expected; give any stray microtask a
    // turn, then assert the call count did not move.
    await Promise.resolve();
    expect(mockGetClientBalance).toHaveBeenCalledTimes(1);
  });

  it("shows no badge when the session has no matching client (no debt, no credit)", async () => {
    mockActiveSession = { id: 1, customer_phone: "00000000" };
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 0, balance_lbp: 0 },
    });

    render(<TopBar />);

    await waitFor(() => {
      expect(mockGetClients).toHaveBeenCalled();
    });
    expect(mockGetClientBalance).not.toHaveBeenCalled();
    expect(screen.queryByText("Debt")).not.toBeInTheDocument();
    expect(screen.queryByText("Credit")).not.toBeInTheDocument();
  });
});
