/** @jest-environment jsdom */
/**
 * Sign-up after "Continue with Google" (`/#/signup?google=<ticket>`,
 * LIRA-280). Google proved the email, so it is shown LOCKED and never sent;
 * the person still chooses the shop address, an admin username AND a
 * password (owner decision 2026-10-07). The body's field names are the
 * schema's own (rule 24): it is parsed through `googleSignupSchema`.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { googleSignupSchema } from "@liratek/core";

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

it("shows the server's refusal (e.g. the email already has a shop)", async () => {
  googleSignup.mockRejectedValue({
    status: 400,
    message: "This email already has a shop.",
  });
  render(<GoogleSignupForm ticket={TICKET} />);
  set("google-signup-shop-name", "Corner Tech");
  set("google-signup-username", "amir");
  set("google-signup-password", "Str0ng-Password!");
  fireEvent.click(screen.getByTestId("google-signup-submit"));
  expect(await screen.findByText(/already has a shop/)).toBeInTheDocument();
});
