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

import { render, screen, waitFor } from "@testing-library/react";

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
  const { user, isLoading, needsOpening } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user">{user?.username ?? ""}</span>
      <span data-testid="needs-opening">{String(needsOpening)}</span>
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
