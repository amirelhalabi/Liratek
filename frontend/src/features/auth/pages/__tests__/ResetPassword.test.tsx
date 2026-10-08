/** @jest-environment jsdom */
/**
 * Reset-password page (LIRA-275): `/#/reset-password?token=…`, web only.
 *
 * What must hold:
 *   1. The link is checked ONCE on load, even under StrictMode (the check
 *      route has a per-IP limiter).
 *   2. A usable link shows whose password is being reset; a dead one shows
 *      the server's generic message and no form.
 *   3. The new password must pass the SAME policy the server enforces
 *      (validatePasswordComplexity) and match the confirmation before it can
 *      be sent; unmet rules are listed.
 *   4. The payload is exactly `{ token, password }` (rule 24: parsed through
 *      `resetPasswordSchema`).
 *   5. Success links to sign-in: the shop's own address when the server
 *      gives one, else the in-app /login.
 *
 * One stable URLSearchParams object for the whole file (rule 25).
 */

import { StrictMode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { resetPasswordSchema } from "@liratek/core";

const checkResetToken = jest.fn();
const resetPassword = jest.fn();
let electron = false;

jest.mock("@/api/backendApi", () => ({
  checkResetToken: (...args: unknown[]) => checkResetToken(...args),
  resetPassword: (...args: unknown[]) => resetPassword(...args),
  isElectron: () => electron,
}));

const themeValue = { theme: "dark" };
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => themeValue }));

let searchParams = new URLSearchParams("token=tok-abc");
const searchState: [URLSearchParams, jest.Mock] = [searchParams, jest.fn()];
jest.mock("react-router-dom", () => ({
  useSearchParams: () => searchState,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import ResetPassword from "../ResetPassword";

const INVALID = "This reset link is not valid. Ask for a new one.";
const GOOD = "N3w!Passw0rd";

function renderPage() {
  return render(
    <StrictMode>
      <ResetPassword />
    </StrictMode>,
  );
}

const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const type = (id: string, value: string) =>
  fireEvent.change(field(id), { target: { value } });
const submit = () => screen.getByRole("button", { name: /set new password/i });

beforeEach(() => {
  checkResetToken.mockReset();
  resetPassword.mockReset();
  electron = false;
  searchParams = new URLSearchParams("token=tok-abc");
  searchState[0] = searchParams;
  checkResetToken.mockResolvedValue({
    success: true,
    data: { username: "boss", shopName: "Cell City" },
  });
});

it("checks the link once and shows whose password it resets", async () => {
  renderPage();
  expect(await screen.findByText(/boss/)).toBeInTheDocument();
  expect(screen.getByText(/Cell City/)).toBeInTheDocument();
  await waitFor(() => expect(checkResetToken).toHaveBeenCalledTimes(1));
  expect(checkResetToken).toHaveBeenCalledWith({ token: "tok-abc" });
});

it("a dead link shows the generic message and no form", async () => {
  checkResetToken.mockResolvedValue({
    success: false,
    error: { code: "FORBIDDEN", message: INVALID },
  });
  renderPage();
  expect(await screen.findByRole("alert")).toHaveTextContent(INVALID);
  expect(screen.queryByTestId("reset-password")).toBeNull();
  expect(screen.getByRole("link", { name: /new link/i })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
});

it("no token in the address: the generic message, no request", async () => {
  searchState[0] = new URLSearchParams("");
  renderPage();
  expect(await screen.findByRole("alert")).toHaveTextContent(INVALID);
  expect(checkResetToken).not.toHaveBeenCalled();
});

it("holds the password to the server's policy and to the confirmation", async () => {
  renderPage();
  await screen.findByTestId("reset-password");

  type("reset-password", "weak");
  type("reset-confirm", "weak");
  expect(submit()).toBeDisabled();
  expect(screen.getByText("Password must contain an uppercase letter")).toBeInTheDocument();

  type("reset-password", GOOD);
  type("reset-confirm", `${GOOD}x`);
  expect(submit()).toBeDisabled();
  expect(screen.getByText(/do not match/i)).toBeInTheDocument();

  type("reset-confirm", GOOD);
  expect(submit()).toBeEnabled();
});

it("sends { token, password } and links to the shop's sign-in on success", async () => {
  resetPassword.mockResolvedValue({
    success: true,
    data: { loginUrl: "https://cellcity.liratek.shop" },
  });
  renderPage();
  await screen.findByTestId("reset-password");
  type("reset-password", GOOD);
  type("reset-confirm", GOOD);
  fireEvent.click(submit());

  expect(await screen.findByText(/password has been changed/i)).toBeInTheDocument();
  const payload = resetPassword.mock.calls[0]?.[0];
  expect(resetPasswordSchema.parse(payload)).toEqual(payload);
  expect(payload).toEqual({ token: "tok-abc", password: GOOD });
  expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
    "href",
    "https://cellcity.liratek.shop/#/login",
  );
});

it("without a shop address from the server, links to the in-app sign-in", async () => {
  resetPassword.mockResolvedValue({ success: true, data: { loginUrl: null } });
  renderPage();
  await screen.findByTestId("reset-password");
  type("reset-password", GOOD);
  type("reset-confirm", GOOD);
  fireEvent.click(submit());
  expect(await screen.findByRole("link", { name: /sign in/i })).toHaveAttribute(
    "href",
    "/login",
  );
});

it("shows the server's refusal when the link died in the meantime", async () => {
  resetPassword.mockResolvedValue({
    success: false,
    error: { code: "FORBIDDEN", message: INVALID },
  });
  renderPage();
  await screen.findByTestId("reset-password");
  type("reset-password", GOOD);
  type("reset-confirm", GOOD);
  fireEvent.click(submit());
  expect(await screen.findByRole("alert")).toHaveTextContent(INVALID);
});

it("never calls the server on desktop", async () => {
  electron = true;
  renderPage();
  expect(await screen.findByText(/web app/i)).toBeInTheDocument();
  expect(checkResetToken).not.toHaveBeenCalled();
});

// ── LIRA-291: wording for users with no password; show/hide on both fields ──

it("LIRA-291: a user with a password sees 'Choose a new password' for <username> at <shop>", async () => {
  checkResetToken.mockResolvedValue({
    success: true,
    data: { username: "boss", shopName: "Cell City", hasPassword: true },
  });
  renderPage();
  expect(
    await screen.findByRole("heading", { name: "Choose a new password" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/For/)).toHaveTextContent("For boss at Cell City");
});

it("LIRA-291: a user with NO password sees 'Set a password' for <username> at <shop>", async () => {
  checkResetToken.mockResolvedValue({
    success: true,
    data: { username: "rami", shopName: "Corner Tech", hasPassword: false },
  });
  renderPage();
  expect(
    await screen.findByRole("heading", { name: "Set a password" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/For/)).toHaveTextContent("For rami at Corner Tech");
  expect(screen.queryByText(/choose a new password/i)).toBeNull();
});

it("LIRA-291: both fields are new-password inputs with their own name/id and an eye toggle", async () => {
  renderPage();
  await screen.findByTestId("reset-password");
  const pw = field("reset-password");
  const confirmPw = field("reset-confirm");
  expect(pw.getAttribute("autocomplete")).toBe("new-password");
  expect(confirmPw.getAttribute("autocomplete")).toBe("new-password");
  expect([pw.name, pw.id]).toEqual(["new-password", "new-password"]);
  expect([confirmPw.name, confirmPw.id]).toEqual(["confirm-password", "confirm-password"]);
  const eyes = screen.getAllByRole("button", { name: /show password/i });
  expect(eyes).toHaveLength(2);
  fireEvent.click(eyes[1]!);
  expect(confirmPw.type).toBe("text");
  expect(pw.type).toBe("password");
});

it("LIRA-291: a browser-generated password is accepted, and the hint names any symbol", async () => {
  renderPage();
  await screen.findByTestId("reset-password");
  expect(screen.queryByText(/@\$!%\*\?&/)).toBeNull();
  type("reset-password", "xY7-pq_Rt.9mZ");
  type("reset-confirm", "xY7-pq_Rt.9mZ");
  expect(submit()).toBeEnabled();
});
