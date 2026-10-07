/** @jest-environment jsdom */
/**
 * Owner decision 2026-10-07: creating a shop with Google is open whenever
 * Google is configured, even while the emailed self-serve form is switched
 * off. The /signup page must then offer "Continue with Google" instead of
 * saying sign-up is not available.
 */

import { render, screen } from "@testing-library/react";

const publicAuthInfo = jest.fn();
const googleAuthStatus = jest.fn();

jest.mock("@/api/backendApi", () => ({
  signup: jest.fn(),
  checkSignupInvite: jest.fn(),
  publicAuthInfo: (...a: unknown[]) => publicAuthInfo(...a),
  googleAuthStatus: (...a: unknown[]) => googleAuthStatus(...a),
  requestSignupLink: jest.fn(),
  isElectron: () => false,
}));
jest.mock("@/features/auth/components/TurnstileWidget", () => ({
  TurnstileWidget: () => null,
}));
const themeValue = { theme: "dark" };
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => themeValue }));
const searchState: [URLSearchParams, jest.Mock] = [new URLSearchParams(""), jest.fn()];
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => searchState,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Signup from "../Signup";

const START = "https://www.liratek.shop/api/auth/google/start";

beforeEach(() => {
  publicAuthInfo.mockResolvedValue({
    success: true,
    data: { enabled: false, selfServeEnabled: false, turnstileSiteKey: null },
  });
});

it("self-serve off, Google on: offers Continue with Google (intent=signup)", async () => {
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: { enabled: true, startUrl: START, shop: null },
  });
  render(<Signup />);
  const link = await screen.findByRole("link", { name: /continue with google/i });
  expect(link).toHaveAttribute("href", `${START}?intent=signup`);
  expect(screen.queryByText(/not available right now/i)).toBeNull();
});

it("self-serve off, Google off: still says sign-up is not available", async () => {
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: { enabled: false, startUrl: null, shop: null },
  });
  render(<Signup />);
  expect(await screen.findByText(/not available right now/i)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /continue with google/i })).toBeNull();
});
