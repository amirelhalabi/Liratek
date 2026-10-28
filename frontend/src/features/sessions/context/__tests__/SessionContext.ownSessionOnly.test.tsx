/**
 * LIRA-354 (owner decision 2026-10-29, "only my own session"): a device
 * keeps only the customer session it opened or picked, and gets that one
 * back after a reload. It never joins another device's open session by
 * itself.
 *
 * Before: with no session of its own, every device took the FIRST open
 * session on each poll. A laptop opening Mobile Recharge while the counter
 * PC served "Client4" silently joined Client4, and its sale went into that
 * customer's basket (found on Cornertech, 2026-10-28). After a checkout the
 * till also jumped into another open session by itself.
 *
 * Rule 25: `useApi()` returns ONE module-level object, so the provider's
 * effects see a stable reference exactly as in production.
 */
import { render, screen, waitFor, act } from "@testing-library/react";

const mockApi = {
  session: {
    getActiveSessions: jest.fn(),
    getTodayAllSessions: jest.fn(),
    cartGet: jest.fn(),
    cartAdd: jest.fn(),
    cartRemove: jest.fn(),
    cartClear: jest.fn(),
    getTransactions: jest.fn(),
    delete: jest.fn(),
  },
  getSessionDetails: jest.fn(),
  startSession: jest.fn(),
  closeSession: jest.fn(),
  updateSession: jest.fn(),
  linkTransactionToSession: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const stableFlags = { flags: { customerSessions: true } };
jest.mock("@/contexts/FeatureFlagContext", () => ({
  useFeatureFlags: () => stableFlags,
}));

const stableAuth = { isAuthenticated: true };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => stableAuth,
}));

jest.mock("@/api/realtime", () => ({
  subscribeToInvalidation: () => () => {},
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  SessionProvider,
  useSession,
  REMEMBERED_SESSION_KEY,
} from "../SessionContext";

function Probe() {
  const { activeSession, switchToSession, allActiveSessions } = useSession();
  return (
    <div>
      <div data-testid="session">
        {activeSession ? activeSession.id : "none"}
      </div>
      <div data-testid="open-count">{allActiveSessions.length}</div>
      <button onClick={() => switchToSession(12)}>pick 12</button>
    </div>
  );
}

const session = (id: number) => ({
  id,
  started_at: "2026-10-28 10:00:00",
  started_by: "admin",
  is_active: 1 as const,
});

function renderProvider() {
  return render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
}

describe("SessionContext — a device keeps only its own session (LIRA-354)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockApi.session.getActiveSessions.mockResolvedValue({
      success: true,
      sessions: [session(12)],
    });
    mockApi.session.getTodayAllSessions.mockResolvedValue({
      success: true,
      sessions: [],
    });
    mockApi.session.cartGet.mockResolvedValue({ success: true, items: [] });
    mockApi.session.getTransactions.mockResolvedValue({
      success: true,
      transactions: [],
    });
    mockApi.getSessionDetails.mockResolvedValue({ success: true });
  });

  it("does not join another device's open session", async () => {
    renderProvider();
    // The open session was loaded (the list knows it) ...
    await waitFor(() =>
      expect(screen.getByTestId("open-count").textContent).toBe("1"),
    );
    // ... but this device did not take it.
    expect(screen.getByTestId("session").textContent).toBe("none");
  });

  it("gets back, after a reload, the session this device picked", async () => {
    const first = renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("open-count").textContent).toBe("1"),
    );
    await act(async () => {
      screen.getByText("pick 12").click();
    });
    expect(screen.getByTestId("session").textContent).toBe("12");
    first.unmount();

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("session").textContent).toBe("12"),
    );
  });

  it("forgets its session once it is closed elsewhere, and does not jump into another", async () => {
    window.localStorage.setItem(REMEMBERED_SESSION_KEY, "12");
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("session").textContent).toBe("12"),
    );

    // Session 12 is checked out on another till; 13 is someone else's.
    mockApi.session.getActiveSessions.mockResolvedValue({
      success: true,
      sessions: [session(13)],
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("session").textContent).toBe("none"),
    );
    expect(window.localStorage.getItem(REMEMBERED_SESSION_KEY)).toBeNull();
  });
});
