/** @jest-environment jsdom */
/**
 * Signup page without an invite link (LIRA-267 US4 + Stage A).
 *
 *   - Self-serve on: ONLY an email field and the Turnstile check; submitting
 *     asks for a link and says "Check your inbox". The shop form never shows
 *     here — the link the email carries is what opens it.
 *   - Self-serve off, shared code on (Stage A): the existing invite-code form.
 *   - Both on: the request form, with a "Have an invite code?" way to the
 *     legacy form.
 *   - Neither: "Sign-up is not available right now".
 *   - A refused Turnstile token is spent: the widget must remount so the next
 *     submit carries a fresh token.
 *
 * The request payload is checked against `requestSignupLinkSchema` (rule 24).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { requestSignupLinkSchema } from "@liratek/core";

const signup = jest.fn();
const checkSignupInvite = jest.fn();
const publicAuthInfo = jest.fn();
const requestSignupLink = jest.fn();

jest.mock("@/api/backendApi", () => ({
  signup: (...args: unknown[]) => signup(...args),
  checkSignupInvite: (...args: unknown[]) => checkSignupInvite(...args),
  publicAuthInfo: (...args: unknown[]) => publicAuthInfo(...args),
  requestSignupLink: (...args: unknown[]) => requestSignupLink(...args),
  isElectron: () => false,
}));

/** Every mount of the (mocked) widget, with the site key it was given. */
const widgetMounts: string[] = [];
let tokenCounter = 0;
function FakeTurnstile({
  siteKey,
  onSuccess,
}: {
  siteKey: string;
  onSuccess: (token: string) => void;
}) {
  useEffect(() => {
    widgetMounts.push(siteKey);
    tokenCounter += 1;
    onSuccess(tokenCounter === 1 ? "tok" : `tok-${tokenCounter}`);
    // Mount-only on purpose, like the real widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div data-testid="turnstile-widget" />;
}
jest.mock("@/features/auth/components/TurnstileWidget", () => ({
  TurnstileWidget: (props: {
    siteKey: string;
    onSuccess: (token: string) => void;
  }) => <FakeTurnstile {...props} />,
}));

// Rule 25: one stable params object — no `invite` here.
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
      enabled: false,
      selfServeEnabled: false,
      turnstileSiteKey: null,
      platformHost: true,
      baseDomain: null,
      shopName: null,
      ...over,
    },
  });
}

beforeEach(() => {
  signup.mockReset();
  checkSignupInvite.mockReset();
  publicAuthInfo.mockReset();
  requestSignupLink.mockReset();
  widgetMounts.length = 0;
  tokenCounter = 0;
  requestSignupLink.mockResolvedValue({
    success: true,
    data: { message: "If this address can be used, we've emailed a link." },
  });
});

describe("Signup — request a link (self-serve on)", () => {
  beforeEach(() =>
    status({ selfServeEnabled: true, turnstileSiteKey: "site-key" }),
  );

  it("shows only the email field and the Turnstile check", async () => {
    render(<Signup />);
    expect(await screen.findByTestId("signup-request-email")).toBeInTheDocument();
    expect(screen.getByTestId("turnstile-widget")).toBeInTheDocument();
    expect(widgetMounts).toEqual(["site-key"]);
    expect(screen.queryByTestId("signup-shop-name")).toBeNull();
    expect(screen.queryByTestId("signup-invite-code")).toBeNull();
    // Shared code is off: no way to the legacy form.
    expect(screen.queryByText(/have an invite code/i)).toBeNull();
    expect(checkSignupInvite).not.toHaveBeenCalled();
  });

  it("asks for a link with the email and the Turnstile token, then says Check your inbox", async () => {
    render(<Signup />);
    fireEvent.change(await screen.findByTestId("signup-request-email"), {
      target: { value: "  Owner@Shop.com " },
    });
    fireEvent.click(screen.getByTestId("signup-request-submit"));

    await waitFor(() => expect(requestSignupLink).toHaveBeenCalledTimes(1));
    const payload = requestSignupLink.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(requestSignupLinkSchema.parse(payload)).toEqual({
      email: "owner@shop.com",
      turnstileToken: "tok",
    });
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(
      screen.getByText("If this address can be used, we've emailed a link."),
    ).toBeInTheDocument();
  });

  it("shows a refusal and remounts the check so the next token is fresh", async () => {
    requestSignupLink.mockResolvedValueOnce({
      success: false,
      error: "Please complete the check and try again.",
    });
    render(<Signup />);
    fireEvent.change(await screen.findByTestId("signup-request-email"), {
      target: { value: "owner@shop.com" },
    });
    fireEvent.click(screen.getByTestId("signup-request-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please complete the check",
    );
    await waitFor(() => expect(widgetMounts).toHaveLength(2));

    fireEvent.click(screen.getByTestId("signup-request-submit"));
    await waitFor(() => expect(requestSignupLink).toHaveBeenCalledTimes(2));
    expect(
      (requestSignupLink.mock.calls[1]![0] as { turnstileToken: string })
        .turnstileToken,
    ).toBe("tok-2");
  });

  it("shows the 429 message when the limiter throws", async () => {
    requestSignupLink.mockRejectedValueOnce({
      status: 429,
      message: "Too many requests, please try again later",
    });
    render(<Signup />);
    fireEvent.change(await screen.findByTestId("signup-request-email"), {
      target: { value: "owner@shop.com" },
    });
    fireEvent.click(screen.getByTestId("signup-request-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests",
    );
  });
});

describe("Signup — which form without a link", () => {
  it("self-serve off, shared code on: the invite-code form (Stage A)", async () => {
    status({ enabled: true });
    render(<Signup />);
    expect(await screen.findByTestId("signup-invite-code")).toBeInTheDocument();
    expect(screen.queryByTestId("signup-request-email")).toBeNull();
    expect(screen.queryByTestId("turnstile-widget")).toBeNull();
  });

  it("both on: the request form, with a way to the invite-code form", async () => {
    status({
      enabled: true,
      selfServeEnabled: true,
      turnstileSiteKey: "site-key",
    });
    render(<Signup />);
    await screen.findByTestId("signup-request-email");
    expect(screen.queryByTestId("signup-invite-code")).toBeNull();

    fireEvent.click(screen.getByText(/have an invite code/i));
    expect(await screen.findByTestId("signup-invite-code")).toBeInTheDocument();
    expect(screen.queryByTestId("signup-request-email")).toBeNull();
  });

  it("neither on: Sign-up is not available right now", async () => {
    status({});
    render(<Signup />);
    expect(
      await screen.findByText(/sign-up is not available right now/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("signup-request-email")).toBeNull();
    expect(screen.queryByTestId("signup-invite-code")).toBeNull();
  });

  it("status unreachable: not available, never a broken form", async () => {
    publicAuthInfo.mockRejectedValue(new Error("Failed to fetch"));
    render(<Signup />);
    expect(
      await screen.findByText(/sign-up is not available right now/i),
    ).toBeInTheDocument();
  });
});
