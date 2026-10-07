/** @jest-environment jsdom */
/**
 * Creating a shop happens on the platform front door, not on a shop's own
 * address (owner UX change 2026-10-07): `/#/signup` on <slug>.<base> sends
 * the browser to https://www.<base>/#/signup. An emailed invite link or a
 * Google sign-up ticket opened on a shop address keeps working there — those
 * are mid-flow and must not be thrown away.
 */

import { render, screen, waitFor } from "@testing-library/react";

const publicAuthInfo = jest.fn();
const checkSignupInvite = jest.fn();

jest.mock("@/api/backendApi", () => ({
  signup: jest.fn(),
  checkSignupInvite: (...a: unknown[]) => checkSignupInvite(...a),
  publicAuthInfo: (...a: unknown[]) => publicAuthInfo(...a),
  googleAuthStatus: jest.fn(() => new Promise(() => undefined)),
  requestSignupLink: jest.fn(),
  isElectron: () => false,
}));

const navigateAway = jest.fn();
let hostname = "cornertech.liratek.shop";
jest.mock("@/features/auth/utils/browserNavigation", () => {
  const actual = jest.requireActual("@/features/auth/utils/browserNavigation");
  return {
    ...actual,
    navigateAway: (url: string) => navigateAway(url),
    currentHostname: () => hostname,
  };
});

jest.mock("@/features/auth/components/TurnstileWidget", () => ({
  TurnstileWidget: () => null,
}));
jest.mock("@/features/auth/components/GoogleSignupForm", () => ({
  __esModule: true,
  default: ({ ticket }: { ticket: string }) => (
    <div data-testid="google-signup">{ticket}</div>
  ),
}));
const themeValue = { theme: "dark" };
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => themeValue }));
// Rule 25: one stable params object per test, swapped in beforeEach.
const searchState: [URLSearchParams, jest.Mock] = [
  new URLSearchParams(""),
  jest.fn(),
];
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => searchState,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Signup from "../Signup";

function status(over: Record<string, unknown>) {
  publicAuthInfo.mockResolvedValue({
    success: true,
    data: {
      emailInvitesEnabled: true,
      selfServeEnabled: true,
      turnstileSiteKey: null,
      platformHost: false,
      baseDomain: null,
      shopName: null,
      ...over,
    },
  });
}

beforeEach(() => {
  publicAuthInfo.mockReset();
  checkSignupInvite.mockReset();
  navigateAway.mockReset();
  searchState[0] = new URLSearchParams("");
});

it("on a shop's address, sends the visitor to www to create a shop", async () => {
  hostname = "cornertech.liratek.shop";
  status({ shopName: "CornerTech" });
  render(<Signup />);
  await waitFor(() =>
    expect(navigateAway).toHaveBeenCalledWith(
      "https://www.liratek.shop/#/signup",
    ),
  );
  // No sign-up form flashes on the shop's address meanwhile.
  expect(screen.queryByTestId("signup-request-email")).toBeNull();
});

it("on www, shows the sign-up form as before", async () => {
  hostname = "www.liratek.shop";
  status({ platformHost: true, baseDomain: "liratek.shop" });
  render(<Signup />);
  expect(await screen.findByTestId("signup-request-email")).toBeInTheDocument();
  expect(navigateAway).not.toHaveBeenCalled();
});

it("on localhost, shows the sign-up form as before", async () => {
  hostname = "localhost";
  status({});
  render(<Signup />);
  expect(await screen.findByTestId("signup-request-email")).toBeInTheDocument();
  expect(navigateAway).not.toHaveBeenCalled();
});

it("an invite link opened on a shop's address still works there", async () => {
  hostname = "cornertech.liratek.shop";
  status({ shopName: "CornerTech" });
  searchState[0] = new URLSearchParams("invite=tok123");
  checkSignupInvite.mockResolvedValue({
    success: true,
    data: { email: "owner@example.com", shopNameHint: "New Shop" },
  });
  render(<Signup />);
  await waitFor(() => expect(checkSignupInvite).toHaveBeenCalledWith("tok123"));
  await new Promise((r) => setTimeout(r, 0));
  expect(navigateAway).not.toHaveBeenCalled();
});

it("a Google sign-up ticket opened on a shop's address still works there", async () => {
  hostname = "cornertech.liratek.shop";
  status({ shopName: "CornerTech" });
  searchState[0] = new URLSearchParams("google=tkt");
  render(<Signup />);
  expect(screen.getByTestId("google-signup").textContent).toBe("tkt");
  await new Promise((r) => setTimeout(r, 0));
  expect(navigateAway).not.toHaveBeenCalled();
});
