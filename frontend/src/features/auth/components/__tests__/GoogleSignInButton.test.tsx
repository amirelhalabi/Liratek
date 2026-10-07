/** @jest-environment jsdom */
/**
 * "Continue with Google" on the login page (LIRA-280). Hidden unless the
 * backend reports Google sign-in enabled (dormant by default), never on
 * desktop, and a plain link to the www start URL — Google's flow is a
 * navigation, not a fetch.
 */

import { render, screen, waitFor } from "@testing-library/react";

const googleAuthStatus = jest.fn();
let electron = false;

jest.mock("@/api/backendApi", () => ({
  googleAuthStatus: (...args: unknown[]) => googleAuthStatus(...args),
  isElectron: () => electron,
}));

import GoogleSignInButton from "../GoogleSignInButton";

beforeEach(() => {
  googleAuthStatus.mockReset();
  electron = false;
});

it("links to the www start with intent=login and this host's shop", async () => {
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: {
      enabled: true,
      startUrl: "https://www.liratek.shop/api/auth/google/start",
      shop: "two",
    },
  });
  render(<GoogleSignInButton />);
  const link = await screen.findByRole("link", { name: /continue with google/i });
  expect(link).toHaveAttribute(
    "href",
    "https://www.liratek.shop/api/auth/google/start?intent=login&shop=two",
  );
  // Sign-up with Google is offered too, without a shop.
  expect(
    screen.getByRole("link", { name: /create a shop with google/i }),
  ).toHaveAttribute(
    "href",
    "https://www.liratek.shop/api/auth/google/start?intent=signup",
  );
});

// Owner decision 2026-10-07: creating a shop with Google is open whenever
// Google is configured — there is no separate sign-up switch in the status.
it("the sign-up variant (Signup page) links straight to intent=signup", async () => {
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: {
      enabled: true,
      startUrl: "https://www.liratek.shop/api/auth/google/start",
      shop: null,
    },
  });
  render(<GoogleSignInButton intent="signup" />);
  const link = await screen.findByRole("link", { name: /continue with google/i });
  expect(link).toHaveAttribute(
    "href",
    "https://www.liratek.shop/api/auth/google/start?intent=signup",
  );
  expect(screen.queryByRole("link", { name: /create a shop with google/i })).toBeNull();
});

it("shows the fallback, not the button, while Google is dormant", async () => {
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: { enabled: false, startUrl: null, shop: null },
  });
  render(<GoogleSignInButton intent="signup" fallback={<p>closed</p>} />);
  expect(await screen.findByText("closed")).toBeInTheDocument();
  expect(screen.queryByRole("link")).toBeNull();
});

it("stays hidden while Google sign-in is dormant", async () => {
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: { enabled: false, startUrl: null, shop: null },
  });
  const { container } = render(<GoogleSignInButton />);
  await waitFor(() => expect(googleAuthStatus).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it("stays hidden when the backend cannot answer", async () => {
  googleAuthStatus.mockRejectedValue(new Error("offline"));
  const { container } = render(<GoogleSignInButton />);
  await waitFor(() => expect(googleAuthStatus).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it("never asks on desktop", () => {
  electron = true;
  const { container } = render(<GoogleSignInButton />);
  expect(googleAuthStatus).not.toHaveBeenCalled();
  expect(container).toBeEmptyDOMElement();
});
