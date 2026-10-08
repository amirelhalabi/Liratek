/** @jest-environment jsdom */
/**
 * The www landing page for Google sign-in (`/#/auth/google`, LIRA-280):
 * explains a refused sign-in, and lets an account linked in several shops
 * pick one. Codes are compared, never message text.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const googleChooseShop = jest.fn();
const navigateAway = jest.fn();

jest.mock("@/api/backendApi", () => ({
  googleChooseShop: (...args: unknown[]) => googleChooseShop(...args),
  isElectron: () => false,
}));
jest.mock("@/features/auth/utils/browserNavigation", () => {
  const actual = jest.requireActual("@/features/auth/utils/browserNavigation");
  return { ...actual, navigateAway: (url: string) => navigateAway(url) };
});
const themeValue = { theme: "dark" };
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => themeValue }));
jest.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import GoogleAuth from "../GoogleAuth";

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
const CHOOSE_TICKET = `${b64url({ alg: "HS256" })}.${b64url({
  sub: "g",
  shops: [
    { tenantId: 2, name: "Two Shop", slug: "two" },
    { tenantId: 3, name: "Three Shop", slug: "three" },
  ],
})}.sig`;

function renderAt(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
  return render(<GoogleAuth />);
}

beforeEach(() => {
  googleChooseShop.mockReset();
  navigateAway.mockReset();
});

it("explains that no shop uses this Google account, and offers sign-up", () => {
  renderAt("#/auth/google?error=no_account");
  expect(screen.getByText(/no LiraTek account is connected/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /sign up/i })).toBeInTheDocument();
});

// LIRA-290: Google sign-up with a Gmail that already owns a shop.
it("explains that the email already has a shop, with a Sign in instead link", () => {
  renderAt("#/auth/google?error=email_has_shop");
  const notice = screen.getByTestId("signup-email-has-shop");
  expect(notice).toHaveTextContent("This email already has a LiraTek shop.");
  expect(
    screen.getByRole("link", { name: /sign in instead/i }),
  ).toHaveAttribute("href", "/login");
  expect(screen.queryByText(/did not work/i)).toBeNull();
});

it("explains that today's limit for new shops was reached", () => {
  renderAt("#/auth/google?error=signup_limit");
  expect(screen.getByText(/limit for new shops/i)).toBeInTheDocument();
});

it("explains that this Google account already has a shop (one Google account = one shop) and offers sign-in", () => {
  renderAt("#/auth/google?error=already_connected");
  expect(
    screen.getByText(/already connected to a LiraTek shop/i),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
});

it("explains a cancelled or failed sign-in", () => {
  renderAt("#/auth/google?error=cancelled");
  expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
});

it("lists the shops and opens the chosen one through its hand-off URL", async () => {
  googleChooseShop.mockResolvedValue({
    success: true,
    data: { redirectUrl: "https://three.liratek.shop/#/login?sso=x" },
  });
  renderAt(`#/auth/google?choose=${CHOOSE_TICKET}`);
  expect(screen.getByRole("button", { name: /Two Shop/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Three Shop/ }));
  await waitFor(() =>
    expect(navigateAway).toHaveBeenCalledWith(
      "https://three.liratek.shop/#/login?sso=x",
    ),
  );
  expect(googleChooseShop).toHaveBeenCalledWith({
    ticket: CHOOSE_TICKET,
    tenantId: 3,
  });
});

it("shows the refusal when the choice is no longer valid", async () => {
  googleChooseShop.mockResolvedValue({
    success: false,
    error: "This Google sign-in has expired. Please continue with Google again.",
    code: "GOOGLE_TICKET_INVALID",
  });
  renderAt(`#/auth/google?choose=${CHOOSE_TICKET}`);
  fireEvent.click(screen.getByRole("button", { name: /Two Shop/ }));
  expect(await screen.findByText(/has expired/)).toBeInTheDocument();
  expect(navigateAway).not.toHaveBeenCalled();
});
