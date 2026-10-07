/** @jest-environment jsdom */
/**
 * `/#/signup?google=<ticket>` (LIRA-280) opens the Google sign-up form — no
 * emailed-link step, no Turnstile — while every other sign-up mode is
 * unchanged.
 */

import { render, screen } from "@testing-library/react";

jest.mock("@/api/backendApi", () => ({
  signup: jest.fn(),
  checkSignupInvite: jest.fn(),
  publicAuthInfo: jest.fn(() => new Promise(() => undefined)),
  requestSignupLink: jest.fn(),
  isElectron: () => false,
}));
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
const searchParams = new URLSearchParams("google=tkt");
const searchState: [URLSearchParams, jest.Mock] = [searchParams, jest.fn()];
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => searchState,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Signup from "../Signup";

it("renders the Google sign-up form for a ?google= ticket", () => {
  render(<Signup />);
  expect(screen.getByTestId("google-signup").textContent).toBe("tkt");
});
