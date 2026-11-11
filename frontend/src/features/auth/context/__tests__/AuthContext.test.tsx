/**
 * AuthContext — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import { AuthProvider, useAuth } from "../AuthContext";

// Rule 25: a STABLE adapter reference, never a fresh literal per call.
const api = {
  me: jest.fn(),
  hasOpeningBalanceToday: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
};

jest.mock("@liratek/ui", () => ({ useApi: () => api }));

jest.mock("@/api/httpClient", () => ({
  UNAUTHORIZED_EVENT: "test:unauthorized",
  SESSION_CHANGED_EVENT: "test:session-changed",
  getToken: () => "jwt",
  getImpersonationToken: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  (api.me as unknown as jest.Mock).mockReset();
  (api.hasOpeningBalanceToday as unknown as jest.Mock).mockReset();
  (api.login as unknown as jest.Mock).mockReset();
  (api.logout as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("AuthContext.restoreRetry", () => {
  beforeAll(resetBetweenFiles);

  /**
   * A page RELOAD restores the web session with `api.me()`. Only a 401 means the
   * session is over — httpClient already clears the token and signs out for
   * that. Any other failure (429 "too many requests", a network blip, a 5xx)
   * says nothing about the session, yet it used to be swallowed and the app
   * showed the login page while still holding a valid token. Seen for real when
   * two browsers shared one login: the other one spent the per-user rate limit,
   * and every refresh "logged out" the first.
   */

  function Probe() {
    const { user, isLoading } = useAuth();
    return (
      <div>
        <span data-testid="loading">{String(isLoading)}</span>
        <span data-testid="user">{user?.username ?? ""}</span>
      </div>
    );
  }

  const BOSS = {
    success: true,
    user: { id: 7, username: "boss", role: "admin" },
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    // clearAllMocks keeps unconsumed `…Once` values; they would leak across tests.
    api.me.mockReset();
    sessionStorage.clear();
    delete (window as unknown as { api?: unknown }).api;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("retries a rate-limited restore instead of showing the login page", async () => {
    api.me
      .mockRejectedValueOnce({ status: 429, message: "Too many requests" })
      .mockRejectedValueOnce({ status: 429, message: "Too many requests" })
      .mockResolvedValueOnce(BOSS);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(
      () => expect(screen.getByTestId("user").textContent).toBe("boss"),
      {
        timeout: 60_000,
      },
    );
    expect(api.me).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("retries a network failure too", async () => {
    api.me
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(BOSS);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(
      () => expect(screen.getByTestId("user").textContent).toBe("boss"),
      {
        timeout: 60_000,
      },
    );
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 401 — that session really is over", async () => {
    api.me.mockRejectedValue({ status: 401, message: "Session expired" });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    jest.advanceTimersByTime(120_000);
    expect(api.me).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("user").textContent).toBe("");
  });

  it("gives up after a bounded number of attempts", async () => {
    api.me.mockRejectedValue({ status: 429, message: "Too many requests" });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(
      () => expect(screen.getByTestId("loading").textContent).toBe("false"),
      {
        timeout: 300_000,
      },
    );
    const calls = api.me.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    jest.advanceTimersByTime(300_000);
    expect(api.me).toHaveBeenCalledTimes(calls);
    expect(screen.getByTestId("user").textContent).toBe("");
  });
});

describe("AuthContext.ssoOpening", () => {
  beforeAll(resetBetweenFiles);

  /**
   * After "Continue with Google" the shop's login page trades the hand-off for
   * a session and RELOADS the app (useSsoHandoff). The app then boots through
   * the session-restore path, which never asked whether today's opening
   * balance exists — only the password `login()` did. A fresh Google sign-in
   * must leave the auth state exactly as a password sign-in does
   * (`needsOpening`), while a plain page refresh stays as it was (no check).
   *
   * The one-shot marker is written by useSsoHandoff just before the reload.
   */

  const FRESH_SIGN_IN_KEY = "liratek:fresh-sign-in";

  function Probe() {
    const {
      user,
      isLoading,
      needsOpening,
      freshSignIn,
      clearFreshSignIn,
      login,
      logout,
    } = useAuth();
    return (
      <div>
        <span data-testid="loading">{String(isLoading)}</span>
        <span data-testid="user">{user?.username ?? ""}</span>
        <span data-testid="needs-opening">{String(needsOpening)}</span>
        <span data-testid="fresh-sign-in">{String(freshSignIn)}</span>
        <button onClick={() => clearFreshSignIn()}>consume</button>
        <button onClick={() => void login("boss", "pw")}>login</button>
        <button onClick={() => void logout()}>logout</button>
      </div>
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    delete (window as unknown as { api?: unknown }).api;
    api.me.mockResolvedValue({
      success: true,
      user: { id: 7, username: "boss", role: "admin" },
    });
    api.hasOpeningBalanceToday.mockResolvedValue(false);
  });

  it("a fresh Google sign-in runs the same opening-balance check as a password login", async () => {
    sessionStorage.setItem(FRESH_SIGN_IN_KEY, "1");
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("boss"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("needs-opening").textContent).toBe("true"),
    );
    expect(api.hasOpeningBalanceToday).toHaveBeenCalledTimes(1);
    // The client's own calendar day (rule 27), as login() sends it.
    expect(api.hasOpeningBalanceToday.mock.calls[0]![0]).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    // One-shot: a later refresh is a plain restore again.
    expect(sessionStorage.getItem(FRESH_SIGN_IN_KEY)).toBeNull();
  });

  it("a plain refresh (no marker) restores the session without the check, as before", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("user").textContent).toBe("boss");
    expect(api.hasOpeningBalanceToday).not.toHaveBeenCalled();
    expect(screen.getByTestId("needs-opening").textContent).toBe("false");
  });

  // The auto-open Checkpoint window keys off `freshSignIn`, NOT `needsOpening`:
  // needsOpening is false as soon as ANY drawer was counted today, while the
  // window must still open for a drawer that was not.
  describe("freshSignIn — the one-shot 'this is a new sign-in' signal", () => {
    it("is set by a fresh Google sign-in, and cleared once consumed", async () => {
      sessionStorage.setItem(FRESH_SIGN_IN_KEY, "1");
      api.hasOpeningBalanceToday.mockResolvedValue(true);
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("fresh-sign-in").textContent).toBe("true"),
      );
      // Set even when the shop already has a checkpoint today.
      expect(screen.getByTestId("needs-opening").textContent).toBe("false");
      fireEvent.click(screen.getByText("consume"));
      expect(screen.getByTestId("fresh-sign-in").textContent).toBe("false");
    });

    it("is NOT set by a plain refresh", async () => {
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("loading").textContent).toBe("false"),
      );
      expect(screen.getByTestId("fresh-sign-in").textContent).toBe("false");
    });

    it("is set by a password login and cleared by logout", async () => {
      api.me.mockResolvedValue({ success: false });
      api.login.mockResolvedValue({
        success: true,
        user: { id: 7, username: "boss", role: "admin" },
      });
      api.logout.mockResolvedValue({ success: true });
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("loading").textContent).toBe("false"),
      );
      expect(screen.getByTestId("fresh-sign-in").textContent).toBe("false");
      await act(async () => {
        fireEvent.click(screen.getByText("login"));
      });
      await waitFor(() =>
        expect(screen.getByTestId("fresh-sign-in").textContent).toBe("true"),
      );
      await act(async () => {
        fireEvent.click(screen.getByText("logout"));
      });
      await waitFor(() =>
        expect(screen.getByTestId("fresh-sign-in").textContent).toBe("false"),
      );
    });
  });
});
