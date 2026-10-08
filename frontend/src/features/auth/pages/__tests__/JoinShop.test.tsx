/** @jest-environment jsdom */
/**
 * /#/join?invite=<token> — accept an invite into a shop (LIRA-281).
 *
 *   1. The link is checked ONCE, even under StrictMode's double effect.
 *   2. The invited email is shown LOCKED with the shop name and role; the
 *      page sends only { token, username, password } (rule 24: parsed
 *      through the core schema, so a stray `email` key would fail).
 *   3. A refusal (username taken) keeps the form and shows the reason.
 *   4. A dead or missing link shows the generic message and no form.
 *   5. LIRA-288 "Join with Google": shown only while Google sign-in is on;
 *      the username comes first, then the page asks the server for a join
 *      ticket ({ token, username } — rule 24, the schema's own keys) and
 *      POSTs it to the www start as a form (never a URL). Coming back with
 *      `google=<reason>` shows why joining did not happen; the form stays.
 */

import { StrictMode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  acceptUserInvitationSchema,
  joinWithGoogleStartSchema,
  USER_ACCOUNT_CODES,
} from "@liratek/core";

const checkUserInvitation = jest.fn();
const acceptUserInvitation = jest.fn();
const googleAuthStatus = jest.fn();
const startJoinWithGoogle = jest.fn();
jest.mock("@/api/backendApi", () => ({
  checkUserInvitation: (...a: unknown[]) => checkUserInvitation(...a),
  acceptUserInvitation: (...a: unknown[]) => acceptUserInvitation(...a),
  googleAuthStatus: (...a: unknown[]) => googleAuthStatus(...a),
  startJoinWithGoogle: (...a: unknown[]) => startJoinWithGoogle(...a),
  isElectron: () => false,
}));

const submitPostForm = jest.fn();
jest.mock("@/features/auth/utils/browserNavigation", () => ({
  submitPostForm: (...a: unknown[]) => submitPostForm(...a),
}));

// Rule 25: one params object for the whole file.
let searchParams = new URLSearchParams("invite=abc");
const setSearch = jest.fn();
const navigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams, setSearch],
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import JoinShop from "../JoinShop";

const INVITE = {
  email: "newbie@shop.test",
  role: "staff",
  shopName: "Cell City",
  expiresAt: "2026-10-10T09:00:00.000Z",
};
const PASSWORD = "Password1!";

beforeEach(() => {
  searchParams = new URLSearchParams("invite=abc");
  checkUserInvitation.mockReset();
  acceptUserInvitation.mockReset();
  googleAuthStatus.mockReset();
  startJoinWithGoogle.mockReset();
  submitPostForm.mockReset();
  navigate.mockReset();
  checkUserInvitation.mockResolvedValue({ success: true, data: INVITE });
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: { enabled: false, startUrl: null, shop: null },
  });
});

function googleOn() {
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: {
      enabled: true,
      startUrl: "https://www.liratek.shop/api/auth/google/start",
      shop: "cellcity",
    },
  });
}

function fillAndSubmit(username: string) {
  fireEvent.change(screen.getByTestId("join-username"), { target: { value: username } });
  fireEvent.change(screen.getByTestId("join-password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByTestId("join-submit"));
}

describe("JoinShop", () => {
  it("checks the link once under StrictMode and shows shop, role and the locked email", async () => {
    render(
      <StrictMode>
        <JoinShop />
      </StrictMode>,
    );
    expect(await screen.findByText(/Cell City/)).toBeInTheDocument();
    expect(checkUserInvitation).toHaveBeenCalledTimes(1);
    expect(checkUserInvitation).toHaveBeenCalledWith({ token: "abc" });
    const email = screen.getByTestId("join-email") as HTMLInputElement;
    expect(email.value).toBe("newbie@shop.test");
    expect(email.readOnly).toBe(true);
    expect(screen.getByText(/staff/i)).toBeInTheDocument();
  });

  it("sends only { token, username, password } and then offers the shop's sign-in", async () => {
    acceptUserInvitation.mockResolvedValue({
      success: true,
      data: { loginUrl: "https://cellcity.liratek.shop" },
    });
    render(<JoinShop />);
    await screen.findByText(/Cell City/);
    fillAndSubmit("newbie");

    await waitFor(() => expect(acceptUserInvitation).toHaveBeenCalledTimes(1));
    const body = acceptUserInvitation.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      Object.keys(acceptUserInvitationSchema.shape).sort(),
    );
    expect(acceptUserInvitationSchema.parse(body)).toEqual({
      token: "abc",
      username: "newbie",
      password: PASSWORD,
    });
    const link = await screen.findByTestId("join-login-url");
    expect(link.getAttribute("href")).toBe("https://cellcity.liratek.shop");
  });

  it("without a shop address (loginUrl null) it sends the person to sign in here", async () => {
    acceptUserInvitation.mockResolvedValue({ success: true, data: { loginUrl: null } });
    render(<JoinShop />);
    await screen.findByText(/Cell City/);
    fillAndSubmit("newbie");
    fireEvent.click(await screen.findByText("Go to sign in"));
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("a taken username keeps the form and shows the reason", async () => {
    acceptUserInvitation.mockResolvedValue({
      success: false,
      error: { code: USER_ACCOUNT_CODES.USERNAME_TAKEN, message: "This username is already taken in this shop" },
    });
    render(<JoinShop />);
    await screen.findByText(/Cell City/);
    fillAndSubmit("cashier1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This username is already taken in this shop",
    );
    expect(screen.getByTestId("join-submit")).toBeInTheDocument();
  });

  it("a dead link shows the generic message and no form", async () => {
    checkUserInvitation.mockResolvedValue({
      success: false,
      error: { code: "FORBIDDEN", message: "This invite link is not valid. Ask the shop for a new invite." },
    });
    render(<JoinShop />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This invite link is not valid");
    expect(screen.queryByTestId("join-submit")).toBeNull();
  });

  // A shop whose subscription lapsed: the server's own wording reaches the
  // person, on the check and on the accept (the link is not dead).
  const SHOP_INACTIVE =
    "This shop is not active right now. Ask the shop owner to renew, then use the link again.";

  it("a lapsed shop: the check shows the renew message and no form", async () => {
    checkUserInvitation.mockResolvedValue({
      success: false,
      error: { code: USER_ACCOUNT_CODES.SHOP_NOT_ACTIVE, message: SHOP_INACTIVE },
    });
    render(<JoinShop />);
    expect(await screen.findByRole("alert")).toHaveTextContent(SHOP_INACTIVE);
    expect(screen.queryByTestId("join-submit")).toBeNull();
  });

  it("a shop that lapsed after the check: the accept shows the renew message", async () => {
    acceptUserInvitation.mockResolvedValue({
      success: false,
      error: { code: USER_ACCOUNT_CODES.SHOP_NOT_ACTIVE, message: SHOP_INACTIVE },
    });
    render(<JoinShop />);
    await screen.findByText(/Cell City/);
    fillAndSubmit("newbie");
    expect(await screen.findByRole("alert")).toHaveTextContent(SHOP_INACTIVE);
  });

  it("no invite in the address: generic message, nothing is checked", async () => {
    searchParams = new URLSearchParams("");
    render(<JoinShop />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This invite link is not valid");
    expect(checkUserInvitation).not.toHaveBeenCalled();
  });

  describe("LIRA-288 — Join with Google", () => {
    it("is not offered while Google sign-in is off", async () => {
      render(<JoinShop />);
      await screen.findByText(/Cell City/);
      await waitFor(() => expect(googleAuthStatus).toHaveBeenCalled());
      expect(screen.queryByTestId("join-google")).toBeNull();
      // Nor mentioned: the page never points at an option that is not there.
      expect(screen.queryByText(/google/i)).toBeNull();
    });

    it("needs a username first, then POSTs the join ticket to the www start — no password", async () => {
      googleOn();
      startJoinWithGoogle.mockResolvedValue({
        success: true,
        data: { url: "https://www.liratek.shop/api/auth/google/start", ticket: "join-ticket" },
      });
      render(<JoinShop />);
      const button = (await screen.findByTestId("join-google")) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.change(screen.getByTestId("join-username"), { target: { value: " newbie " } });
      expect(button.disabled).toBe(false);
      fireEvent.click(button);

      await waitFor(() => expect(submitPostForm).toHaveBeenCalledTimes(1));
      const body = startJoinWithGoogle.mock.calls[0]![0] as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(Object.keys(joinWithGoogleStartSchema.shape).sort());
      expect(joinWithGoogleStartSchema.parse(body)).toEqual({ token: "abc", username: "newbie" });
      expect(submitPostForm).toHaveBeenCalledWith(
        "https://www.liratek.shop/api/auth/google/start",
        { intent: "join", ticket: "join-ticket" },
      );
      expect(acceptUserInvitation).not.toHaveBeenCalled();
    });

    it("a refusal before Google (username taken) shows the reason and stays on the page", async () => {
      googleOn();
      startJoinWithGoogle.mockResolvedValue({
        success: false,
        error: { code: USER_ACCOUNT_CODES.USERNAME_TAKEN, message: "This username is already taken in this shop" },
      });
      render(<JoinShop />);
      fireEvent.change(await screen.findByTestId("join-username"), { target: { value: "cashier1" } });
      fireEvent.click(await screen.findByTestId("join-google"));
      expect(await screen.findByRole("alert")).toHaveTextContent("already taken");
      expect(submitPostForm).not.toHaveBeenCalled();
    });

    it.each([
      ["email_mismatch", /different email/i],
      ["already_linked", /already connected to another user in this shop/i],
      ["username_taken", /username/i],
      ["cancelled", /cancelled/i],
    ])("back from Google with google=%s: says why, and the form is still there", async (code, text) => {
      googleOn();
      searchParams = new URLSearchParams(`invite=abc&google=${code}`);
      render(<JoinShop />);
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.getByTestId("join-submit")).toBeInTheDocument();
    });
  });
});
