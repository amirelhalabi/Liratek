/** @jest-environment jsdom */
/**
 * A page RELOAD restores the web session with `api.me()`. Only a 401 means the
 * session is over — httpClient already clears the token and signs out for
 * that. Any other failure (429 "too many requests", a network blip, a 5xx)
 * says nothing about the session, yet it used to be swallowed and the app
 * showed the login page while still holding a valid token. Seen for real when
 * two browsers shared one login: the other one spent the per-user rate limit,
 * and every refresh "logged out" the first.
 */

import { render, screen, waitFor } from "@testing-library/react";

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
  const { user, isLoading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user">{user?.username ?? ""}</span>
    </div>
  );
}

const BOSS = { success: true, user: { id: 7, username: "boss", role: "admin" } };

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
  await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("boss"), {
    timeout: 60_000,
  });
  expect(api.me).toHaveBeenCalledTimes(3);
  expect(screen.getByTestId("loading").textContent).toBe("false");
});

it("retries a network failure too", async () => {
  api.me.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(BOSS);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("boss"), {
    timeout: 60_000,
  });
  expect(api.me).toHaveBeenCalledTimes(2);
});

it("does NOT retry a 401 — that session really is over", async () => {
  api.me.mockRejectedValue({ status: 401, message: "Session expired" });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
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
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"), {
    timeout: 300_000,
  });
  const calls = api.me.mock.calls.length;
  expect(calls).toBeGreaterThan(1);
  jest.advanceTimersByTime(300_000);
  expect(api.me).toHaveBeenCalledTimes(calls);
  expect(screen.getByTestId("user").textContent).toBe("");
});
