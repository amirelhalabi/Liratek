/** @jest-environment jsdom */
/**
 * "Create your shop" reads as its own page, never as the sign-in page
 * (LIRA-287): heading "Create your shop" and a 2-step indicator
 * "1 Email · 2 Shop details" — step 1 current on the request form and on
 * "Check your inbox", step 2 current on the full form opened from the
 * emailed link.
 */

import { render, screen, within } from "@testing-library/react";

const checkSignupInvite = jest.fn();
const publicAuthInfo = jest.fn();

jest.mock("@/api/backendApi", () => ({
  signup: jest.fn(),
  checkSignupInvite: (...args: unknown[]) => checkSignupInvite(...args),
  publicAuthInfo: (...args: unknown[]) => publicAuthInfo(...args),
  requestSignupLink: jest.fn(),
  googleAuthStatus: () => Promise.resolve({ success: true, data: { enabled: false } }),
  isElectron: () => false,
}));
jest.mock("@/features/auth/components/TurnstileWidget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile-widget" />,
}));

// Rule 25: stable references across renders.
let searchParams = new URLSearchParams("");
const setSearch = jest.fn();
const navigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams, setSearch],
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Signup from "../Signup";

beforeEach(() => {
  checkSignupInvite.mockReset();
  publicAuthInfo.mockReset();
  publicAuthInfo.mockResolvedValue({
    success: true,
    data: { emailInvitesEnabled: true, selfServeEnabled: true, turnstileSiteKey: null },
  });
});

function steps() {
  return within(screen.getByRole("list", { name: "Sign-up steps" }));
}

it("request form: 'Create your shop' with step 1 (Email) current", async () => {
  searchParams = new URLSearchParams("");
  render(<Signup />);
  expect(
    await screen.findByRole("heading", { name: "Create your shop" }),
  ).toBeInTheDocument();
  expect(steps().getByText("Email").closest("li")).toHaveAttribute(
    "aria-current",
    "step",
  );
  expect(steps().getByText("Shop details").closest("li")).not.toHaveAttribute(
    "aria-current",
  );
});

it("opened from the emailed link: step 2 (Shop details) current", async () => {
  searchParams = new URLSearchParams("invite=abc");
  checkSignupInvite.mockResolvedValue({
    success: true,
    data: {
      email: "owner@shop.com",
      shopNameHint: null,
      expiresAt: "2026-10-10T09:00:00.000Z",
    },
  });
  render(<Signup />);
  await screen.findByTestId("signup-email");
  expect(
    screen.getByRole("heading", { name: "Create your shop" }),
  ).toBeInTheDocument();
  expect(steps().getByText("Shop details").closest("li")).toHaveAttribute(
    "aria-current",
    "step",
  );
});
