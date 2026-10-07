/** @jest-environment jsdom */
/**
 * "Forgot password?" page (LIRA-275), web only.
 *
 * What must hold:
 *   1. On a shop's own address (the host names the shop) only the email is
 *      asked; the payload has NO `shop` key.
 *   2. On an address that names no shop (www, or host tenancy off) the shop
 *      address is asked too, and a typed `cellcity.liratek.shop` is sent as
 *      the slug `cellcity`.
 *   3. A SHOP_REQUIRED answer reveals the shop field.
 *   4. Success shows the server's generic message — never anything that says
 *      whether the account exists.
 *   5. A 429 (thrown by requestJson) shows a "try again" line, not a crash.
 *   6. With no email set up on the server, the page says so instead of a form.
 *
 * Payloads are parsed through `forgotPasswordSchema` (rule 24). The mocks
 * return stable references (rule 25).
 */

import { StrictMode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { forgotPasswordSchema } from "@liratek/core";

const forgotPassword = jest.fn();
const publicAuthInfo = jest.fn();
let electron = false;

jest.mock("@/api/backendApi", () => ({
  forgotPassword: (...args: unknown[]) => forgotPassword(...args),
  publicAuthInfo: (...args: unknown[]) => publicAuthInfo(...args),
  isElectron: () => electron,
}));

const themeValue = { theme: "dark" };
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => themeValue }));
jest.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import ForgotPassword from "../ForgotPassword";

const GENERIC =
  "If this email belongs to an account in this shop, we've sent a link.";

function hostInfo(over: Record<string, unknown> = {}) {
  publicAuthInfo.mockResolvedValue({
    success: true,
    data: {
      emailInvitesEnabled: true,
      selfServeEnabled: false,
      turnstileSiteKey: null,
      platformHost: false,
      baseDomain: null,
      shopName: "Cell City",
      ...over,
    },
  });
}

function renderPage() {
  return render(
    <StrictMode>
      <ForgotPassword />
    </StrictMode>,
  );
}

const input = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const type = (id: string, value: string) =>
  fireEvent.change(input(id), { target: { value } });

function sentPayload(): Record<string, unknown> {
  const payload = forgotPassword.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  expect(forgotPasswordSchema.safeParse(payload).success).toBe(true);
  return payload;
}

beforeEach(() => {
  forgotPassword.mockReset();
  publicAuthInfo.mockReset();
  electron = false;
});

it("on a shop's address: asks only the email, sends no shop, shows the generic message", async () => {
  hostInfo();
  forgotPassword.mockResolvedValue({ success: true, data: { message: GENERIC } });
  renderPage();

  await screen.findByTestId("forgot-email");
  expect(screen.queryByTestId("forgot-shop")).toBeNull();
  type("forgot-email", " boss@shop.com ");
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  expect(await screen.findByText(GENERIC)).toBeInTheDocument();
  expect(sentPayload()).toEqual({ email: "boss@shop.com" });
  expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
    "href",
    "/login",
  );
});

it("on an address with no shop: asks the shop address and sends its slug", async () => {
  hostInfo({ shopName: null, platformHost: true, baseDomain: "liratek.shop" });
  forgotPassword.mockResolvedValue({ success: true, data: { message: GENERIC } });
  renderPage();

  await screen.findByTestId("forgot-shop");
  type("forgot-email", "boss@shop.com");
  type("forgot-shop", "https://CellCity.liratek.shop/");
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await screen.findByText(GENERIC);
  expect(sentPayload()).toEqual({ email: "boss@shop.com", shop: "cellcity" });
});

it("reveals the shop field when the server answers SHOP_REQUIRED", async () => {
  hostInfo();
  forgotPassword.mockResolvedValue({
    success: false,
    code: "SHOP_REQUIRED",
    error: { code: "SHOP_REQUIRED", message: "Enter your shop's address." },
  });
  renderPage();

  await screen.findByTestId("forgot-email");
  type("forgot-email", "boss@shop.com");
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  expect(await screen.findByTestId("forgot-shop")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Enter your shop's address.");
});

it("shows 'try again' when the per-IP limit throws", async () => {
  hostInfo();
  forgotPassword.mockRejectedValue({
    status: 429,
    message: "Too many requests, please try again later",
  });
  renderPage();

  await screen.findByTestId("forgot-email");
  type("forgot-email", "boss@shop.com");
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many requests, please try again later",
  );
});

it("says reset by email is not available when the server has no email", async () => {
  hostInfo({ emailInvitesEnabled: false });
  renderPage();
  expect(
    await screen.findByText(/not available/i),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("forgot-email")).toBeNull();
});

it("asks the host once, even under StrictMode", async () => {
  hostInfo();
  renderPage();
  await screen.findByTestId("forgot-email");
  await waitFor(() => expect(publicAuthInfo).toHaveBeenCalledTimes(1));
});

it("never calls the server on desktop", async () => {
  electron = true;
  hostInfo();
  renderPage();
  expect(await screen.findByText(/web app/i)).toBeInTheDocument();
  expect(publicAuthInfo).not.toHaveBeenCalled();
});
