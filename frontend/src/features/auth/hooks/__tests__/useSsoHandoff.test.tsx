/** @jest-environment jsdom */
/**
 * The `?sso=<token>` hand-off on a shop's login page (LIRA-280).
 *
 *   - exchanged exactly ONCE, even under StrictMode's double effect run: the
 *     token is single-use, so a second exchange would fail and paint an error
 *     over a sign-in that worked;
 *   - removed from the address bar immediately;
 *   - success restarts the app at home (the session is already stored by
 *     `ssoExchange`); failure shows a message and leaves the form usable.
 */

import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

const ssoExchange = jest.fn();
const reloadAtHome = jest.fn();

jest.mock("@/api/backendApi", () => ({
  ssoExchange: (...args: unknown[]) => ssoExchange(...args),
  isElectron: () => false,
}));
jest.mock("@/features/auth/utils/browserNavigation", () => {
  const actual = jest.requireActual("@/features/auth/utils/browserNavigation");
  return { ...actual, reloadAtHome: () => reloadAtHome() };
});

import { useSsoHandoff } from "../useSsoHandoff";

function Probe() {
  const { exchanging, error } = useSsoHandoff();
  return (
    <div>
      <span data-testid="exchanging">{String(exchanging)}</span>
      <span data-testid="error">{error ?? ""}</span>
    </div>
  );
}

function renderAt(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
  return render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
}

beforeEach(() => {
  ssoExchange.mockReset();
  reloadAtHome.mockReset();
});

it("exchanges the token once, clears it from the URL, then restarts at home", async () => {
  ssoExchange.mockResolvedValue({ success: true, data: { token: "jwt" } });
  renderAt("#/login?sso=tok-1");
  await waitFor(() => expect(reloadAtHome).toHaveBeenCalledTimes(1));
  expect(ssoExchange).toHaveBeenCalledTimes(1);
  expect(ssoExchange).toHaveBeenCalledWith({ token: "tok-1" });
  expect(window.location.hash).toBe("#/login");
});

it("shows a message when the hand-off is refused", async () => {
  ssoExchange.mockResolvedValue({
    success: false,
    error: "This sign-in link is not valid. Please sign in again.",
    code: "SSO_INVALID",
  });
  renderAt("#/login?sso=used");
  await waitFor(() =>
    expect(screen.getByTestId("error").textContent).toMatch(/not valid/),
  );
  expect(screen.getByTestId("exchanging").textContent).toBe("false");
  expect(reloadAtHome).not.toHaveBeenCalled();
});

it("does nothing without a token", () => {
  renderAt("#/login");
  expect(ssoExchange).not.toHaveBeenCalled();
  expect(screen.getByTestId("exchanging").textContent).toBe("false");
});
