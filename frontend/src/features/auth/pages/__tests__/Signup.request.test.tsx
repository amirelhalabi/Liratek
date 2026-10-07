/** @jest-environment jsdom */
/**
 * Signup page without an invite link (LIRA-267 US4 + Stage B).
 *
 *   - Self-serve on: an email field, an optional shop name (LIRA-278), a
 *     hidden honeypot and — only when the server has Turnstile keys — the
 *     Turnstile check; submitting asks for a link and says "Check your
 *     inbox". The shop form never shows here — the link the email carries
 *     is what opens it. `formElapsedMs` is measured on the browser's own
 *     clock from the moment the request form renders (rule 27).
 *   - Self-serve off: "Sign-up is not available right now" — whatever the
 *     retired shared-code `enabled` flag says (Stage B: there is no
 *     invite-code form any more, so an older backend's `enabled: true` must
 *     not bring one back).
 *   - No invite-code field ever appears without a link.
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

  it("shows the email, an optional shop name, a hidden honeypot and the Turnstile check", async () => {
    render(<Signup />);
    expect(await screen.findByTestId("signup-request-email")).toBeInTheDocument();
    const shopName = screen.getByTestId("signup-request-shop-name") as HTMLInputElement;
    expect(shopName.maxLength).toBe(100);
    const honeypot = screen.getByTestId("signup-request-website") as HTMLInputElement;
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.getAttribute("autocomplete")).toBe("off");
    expect(honeypot.closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByTestId("turnstile-widget")).toBeInTheDocument();
    expect(widgetMounts).toEqual(["site-key"]);
    // The full shop form (the link's job) is not here.
    expect(screen.queryByTestId("signup-shop-name")).toBeNull();
    expect(screen.queryByTestId("signup-invite-code")).toBeNull();
    // Stage B: there is no legacy form to reach.
    expect(screen.queryByText(/have an invite code/i)).toBeNull();
    expect(checkSignupInvite).not.toHaveBeenCalled();
  });

  it("asks for a link with the email, shop name, empty honeypot, elapsed time and Turnstile token, then says Check your inbox", async () => {
    const now = jest.spyOn(performance, "now");
    now.mockReturnValue(0);
    let resolveStatus: (v: unknown) => void = () => undefined;
    publicAuthInfo.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    render(<Signup />);
    // The clock starts when the REQUEST FORM renders, not while loading.
    now.mockReturnValue(1_000);
    resolveStatus({
      success: true,
      data: { selfServeEnabled: true, turnstileSiteKey: "site-key" },
    });
    fireEvent.change(await screen.findByTestId("signup-request-email"), {
      target: { value: "  Owner@Shop.com " },
    });
    fireEvent.change(screen.getByTestId("signup-request-shop-name"), {
      target: { value: "  Cell City " },
    });
    now.mockReturnValue(6_500.7);
    fireEvent.click(screen.getByTestId("signup-request-submit"));

    await waitFor(() => expect(requestSignupLink).toHaveBeenCalledTimes(1));
    now.mockRestore();
    const payload = requestSignupLink.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(requestSignupLinkSchema.parse(payload)).toEqual({
      email: "owner@shop.com",
      turnstileToken: "tok",
      shopNameHint: "Cell City",
      website: "",
      formElapsedMs: 5_501,
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

describe("Signup — request a link, self-serve on WITHOUT Turnstile (LIRA-278)", () => {
  beforeEach(() => status({ selfServeEnabled: true, turnstileSiteKey: null }));

  it("shows the request form with no Turnstile check", async () => {
    render(<Signup />);
    expect(await screen.findByTestId("signup-request-email")).toBeInTheDocument();
    expect(screen.getByTestId("signup-request-shop-name")).toBeInTheDocument();
    expect(screen.queryByTestId("turnstile-widget")).toBeNull();
    expect(screen.queryByText(/sign-up is not available/i)).toBeNull();
  });

  it("submits with just an email: no turnstileToken key at all, shop name omitted when blank", async () => {
    render(<Signup />);
    const submit = await screen.findByTestId("signup-request-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("signup-request-email"), {
      target: { value: "owner@shop.com" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(requestSignupLink).toHaveBeenCalledTimes(1));
    const payload = requestSignupLink.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("turnstileToken");
    const parsed = requestSignupLinkSchema.parse(payload);
    expect(parsed.shopNameHint).toBeUndefined();
    expect(parsed.website).toBe("");
    expect(typeof parsed.formElapsedMs).toBe("number");
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  });

  it("a filled honeypot is sent as typed (the server decides, silently)", async () => {
    render(<Signup />);
    fireEvent.change(await screen.findByTestId("signup-request-email"), {
      target: { value: "bot@spam.com" },
    });
    fireEvent.change(screen.getByTestId("signup-request-website"), {
      target: { value: "http://spam.example" },
    });
    fireEvent.click(screen.getByTestId("signup-request-submit"));
    await waitFor(() => expect(requestSignupLink).toHaveBeenCalledTimes(1));
    expect(
      requestSignupLinkSchema.parse(requestSignupLink.mock.calls[0]![0]).website,
    ).toBe("http://spam.example");
  });
});

describe("Signup — which form without a link", () => {
  // Rule 24: these were the Stage A "shared code on" tests, rewritten into
  // guards that the code form is gone.
  it("self-serve off, legacy `enabled` true: not available, never a code form", async () => {
    status({ enabled: true });
    render(<Signup />);
    expect(
      await screen.findByText(/sign-up is not available right now/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("signup-invite-code")).toBeNull();
    expect(screen.queryByTestId("signup-shop-name")).toBeNull();
    expect(screen.queryByTestId("signup-request-email")).toBeNull();
  });

  it("self-serve on, legacy `enabled` true: the request form with no way to a code form", async () => {
    status({
      enabled: true,
      selfServeEnabled: true,
      turnstileSiteKey: "site-key",
    });
    render(<Signup />);
    await screen.findByTestId("signup-request-email");
    expect(screen.queryByTestId("signup-invite-code")).toBeNull();
    expect(screen.queryByText(/have an invite code/i)).toBeNull();
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
