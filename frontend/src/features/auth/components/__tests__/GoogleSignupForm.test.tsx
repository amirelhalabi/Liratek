/** @jest-environment jsdom */
/**
 * Sign-up after "Continue with Google" (`/#/signup?google=<ticket>`,
 * LIRA-280). Google proved the email, so it is shown LOCKED and never sent;
 * the person still chooses the shop address, an admin username AND a
 * password (owner decision 2026-10-07). The body's field names are the
 * schema's own (rule 24): it is parsed through `googleSignupSchema`.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  EMAIL_ALREADY_HAS_SHOP,
  EMAIL_ALREADY_HAS_SHOP_MESSAGE,
  googleSignupSchema,
} from "@liratek/core";

const googleSignup = jest.fn();

jest.mock("@/api/backendApi", () => ({
  googleSignup: (...args: unknown[]) => googleSignup(...args),
  isElectron: () => false,
}));
const themeValue = { theme: "dark" };
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => themeValue }));
jest.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import GoogleSignupForm from "../GoogleSignupForm";

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
const TICKET = `${b64url({ alg: "HS256" })}.${b64url({
  sub: "g",
  email: "owner@gmail.com",
  verifiedAt: "2026-10-07T10:00:00.000Z",
})}.sig`;

const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const set = (id: string, value: string) =>
  fireEvent.change(field(id), { target: { value } });

beforeEach(() => googleSignup.mockReset());

it("shows the Google email locked", () => {
  render(<GoogleSignupForm ticket={TICKET} />);
  expect(field("google-signup-email").value).toBe("owner@gmail.com");
  expect(field("google-signup-email").readOnly).toBe(true);
});

it("cannot be submitted without a password", () => {
  render(<GoogleSignupForm ticket={TICKET} />);
  set("google-signup-shop-name", "Corner Tech");
  set("google-signup-username", "amir");
  expect(screen.getByTestId("google-signup-submit")).toBeDisabled();
  set("google-signup-password", "Str0ng-Password!");
  expect(screen.getByTestId("google-signup-submit")).not.toBeDisabled();
});

it("sends the ticket with the shop fields, never an email", async () => {
  googleSignup.mockResolvedValue({
    success: true,
    data: {
      tenant: { id: 9, name: "Corner Tech", slug: "corner-tech" },
      loginUrl: "https://corner-tech.liratek.shop",
    },
  });
  render(<GoogleSignupForm ticket={TICKET} />);
  set("google-signup-shop-name", "Corner Tech");
  set("google-signup-username", "amir");
  set("google-signup-password", "Str0ng-Password!");
  fireEvent.click(screen.getByTestId("google-signup-submit"));
  await waitFor(() => expect(googleSignup).toHaveBeenCalledTimes(1));
  const body = googleSignup.mock.calls[0][0] as Record<string, unknown>;
  expect(googleSignupSchema.safeParse(body).success).toBe(true);
  expect(body).toEqual({
    name: "Corner Tech",
    slug: "corner-tech",
    adminUsername: "amir",
    adminPassword: "Str0ng-Password!",
    googleTicket: TICKET,
  });
  expect(await screen.findByText(/Corner Tech is ready/)).toBeInTheDocument();
});

it("shows the server's refusal", async () => {
  googleSignup.mockRejectedValue({
    status: 400,
    message: "That shop address is taken.",
  });
  render(<GoogleSignupForm ticket={TICKET} />);
  set("google-signup-shop-name", "Corner Tech");
  set("google-signup-username", "amir");
  set("google-signup-password", "Str0ng-Password!");
  fireEvent.click(screen.getByTestId("google-signup-submit"));
  expect(await screen.findByText(/address is taken/)).toBeInTheDocument();
});

// LIRA-290: the refusal is now 200 + code (it used to be a thrown 400, which
// lost the code). The page shows the message with a Sign in link.
it("an email that already has a shop: the message with a Sign in instead link", async () => {
  googleSignup.mockResolvedValue({
    success: false,
    code: EMAIL_ALREADY_HAS_SHOP,
    error: EMAIL_ALREADY_HAS_SHOP_MESSAGE,
  });
  render(<GoogleSignupForm ticket={TICKET} />);
  set("google-signup-shop-name", "Corner Tech");
  set("google-signup-username", "amir");
  set("google-signup-password", "Str0ng-Password!");
  fireEvent.click(screen.getByTestId("google-signup-submit"));
  const notice = await screen.findByTestId("signup-email-has-shop");
  expect(notice).toHaveTextContent("This email already has a LiraTek shop.");
  expect(
    screen.getByRole("link", { name: /sign in instead/i }),
  ).toHaveAttribute("href", "/login");
});

it("LIRA-291: the admin password has a show/hide eye and is a new-password field", () => {
  render(<GoogleSignupForm ticket={TICKET} />);
  // LIRA-291 (FR-012): a password-setting field has a show/hide eye, is a
  // new-password field with a distinct name/id, so a browser can generate
  // and save the password.
  const pw = screen.getByTestId("google-signup-password") as HTMLInputElement;
  expect(pw.getAttribute("autocomplete")).toBe("new-password");
  expect(pw.name).toBe("google-signup-password");
  expect(pw.id).toBe("google-signup-password");
  const eye = screen.getByRole("button", { name: /show password/i });
  fireEvent.click(eye);
  expect(pw.type).toBe("text");
});
