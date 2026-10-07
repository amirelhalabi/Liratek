/** @jest-environment jsdom */
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

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const FRESH_SIGN_IN_KEY = "liratek:fresh-sign-in";

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
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { AuthProvider, useAuth } from "../AuthContext";

function Probe() {
  const { user, isLoading, needsOpening, freshSignIn, clearFreshSignIn, login, logout } =
    useAuth();
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
  api.me.mockResolvedValue({ success: true, user: { id: 7, username: "boss", role: "admin" } });
  api.hasOpeningBalanceToday.mockResolvedValue(false);
});

it("a fresh Google sign-in runs the same opening-balance check as a password login", async () => {
  sessionStorage.setItem(FRESH_SIGN_IN_KEY, "1");
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("boss"));
  await waitFor(() => expect(screen.getByTestId("needs-opening").textContent).toBe("true"));
  expect(api.hasOpeningBalanceToday).toHaveBeenCalledTimes(1);
  // The client's own calendar day (rule 27), as login() sends it.
  expect(api.hasOpeningBalanceToday.mock.calls[0]![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // One-shot: a later refresh is a plain restore again.
  expect(sessionStorage.getItem(FRESH_SIGN_IN_KEY)).toBeNull();
});

it("a plain refresh (no marker) restores the session without the check, as before", async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
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
    await waitFor(() => expect(screen.getByTestId("fresh-sign-in").textContent).toBe("true"));
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
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("fresh-sign-in").textContent).toBe("false");
  });

  it("is set by a password login and cleared by logout", async () => {
    api.me.mockResolvedValue({ success: false });
    api.login.mockResolvedValue({ success: true, user: { id: 7, username: "boss", role: "admin" } });
    api.logout.mockResolvedValue({ success: true });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("fresh-sign-in").textContent).toBe("false");
    await act(async () => {
      fireEvent.click(screen.getByText("login"));
    });
    await waitFor(() => expect(screen.getByTestId("fresh-sign-in").textContent).toBe("true"));
    await act(async () => {
      fireEvent.click(screen.getByText("logout"));
    });
    await waitFor(() => expect(screen.getByTestId("fresh-sign-in").textContent).toBe("false"));
  });
});
