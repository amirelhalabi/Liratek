/** @jest-environment jsdom */
/**
 * Signup page, invite-link mode (LIRA-267 US1).
 *
 * `/signup?invite=<token>` is the emailed single-use link. What must hold:
 *
 *   1. The link is checked ONCE, even under StrictMode's double effect run —
 *      the check route has its own per-IP limiter, so a page that checks
 *      twice per load halves the budget.
 *   2. The invited email is shown LOCKED and the shared invite-code field is
 *      absent: the server takes the email from the invite, never the body.
 *   3. Submitting sends `inviteToken` and NO `inviteCode` key. An empty
 *      `inviteCode: ""` next to the token would count as "both" and the
 *      schema would refuse the sign-up with a 400.
 *   4. A dead link shows the generic message and no form at all.
 *
 * Payload field names come from the core schema (rule 24): the captured body
 * is parsed through `signupSchema`, so a renamed field fails here.
 */

import { StrictMode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { signupSchema } from "@liratek/core";

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

jest.mock("@/features/auth/components/TurnstileWidget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile-widget" />,
}));

// Rule 25: ONE params object for the whole file — a fresh URLSearchParams per
// render is exactly the unstable identity that turns an effect into a loop.
const searchParams = new URLSearchParams("invite=abc");
const searchState: [URLSearchParams, jest.Mock] = [searchParams, jest.fn()];
const navigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useSearchParams: () => searchState,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Signup from "../Signup";

const INVITE = {
  email: "owner@shop.com",
  shopNameHint: "Cell City",
  expiresAt: "2026-10-10T09:00:00.000Z",
};

function renderPage() {
  return render(
    <StrictMode>
      <Signup />
    </StrictMode>,
  );
}

const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;
function set(id: string, value: string) {
  fireEvent.change(field(id), { target: { value } });
}

beforeEach(() => {
  signup.mockReset();
  checkSignupInvite.mockReset();
  publicAuthInfo.mockReset();
  requestSignupLink.mockReset();
  checkSignupInvite.mockResolvedValue({ success: true, data: INVITE });
  publicAuthInfo.mockResolvedValue({
    success: true,
    data: { enabled: true, selfServeEnabled: true, turnstileSiteKey: "k" },
  });
  signup.mockResolvedValue({
    success: true,
    data: { tenant: { id: 9, name: "Cell City", slug: "cell-city" } },
  });
});

describe("Signup — invite link", () => {
  it("checks the link exactly once, even under StrictMode", async () => {
    renderPage();
    await screen.findByTestId("signup-email");
    expect(checkSignupInvite).toHaveBeenCalledTimes(1);
    expect(checkSignupInvite).toHaveBeenCalledWith("abc");
  });

  it("shows the invited email locked, prefills the shop name, and has no invite-code field", async () => {
    renderPage();
    const email = (await screen.findByTestId("signup-email")) as HTMLInputElement;
    expect(email.value).toBe(INVITE.email);
    expect(email.readOnly).toBe(true);
    expect(field("signup-shop-name").value).toBe(INVITE.shopNameHint);
    expect(screen.queryByTestId("signup-invite-code")).toBeNull();
    // The request-a-link form is not shown on top of an invite.
    expect(screen.queryByTestId("turnstile-widget")).toBeNull();
  });

  it("submits inviteToken and no inviteCode", async () => {
    renderPage();
    await screen.findByTestId("signup-email");
    set("signup-username", "amir");
    set("signup-password", "Str0ng-Password!");
    fireEvent.click(screen.getByTestId("signup-submit"));

    await waitFor(() => expect(signup).toHaveBeenCalledTimes(1));
    const payload = signup.mock.calls[0]![0] as Record<string, unknown>;
    expect("inviteCode" in payload).toBe(false);
    const parsed = signupSchema.parse(payload);
    expect(parsed.inviteToken).toBe("abc");
    expect(parsed.name).toBe(INVITE.shopNameHint);
    expect(parsed.slug).toBe("cell-city");
    expect(await screen.findByText(/is ready/i)).toBeInTheDocument();
  });

  it("shows the generic message and no form for a dead link", async () => {
    checkSignupInvite.mockResolvedValue({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "This invite link is not valid. Ask for a new invite.",
      },
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This invite link is not valid",
    );
    expect(screen.queryByTestId("signup-submit")).toBeNull();
    expect(screen.queryByTestId("signup-email")).toBeNull();
  });

  it("shows the reason when the check itself throws (e.g. 429)", async () => {
    checkSignupInvite.mockRejectedValue({
      status: 429,
      message: "Too many requests, please try again later",
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests",
    );
    expect(screen.queryByTestId("signup-submit")).toBeNull();
  });
});
