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
 */

import { StrictMode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { acceptUserInvitationSchema, USER_ACCOUNT_CODES } from "@liratek/core";

const checkUserInvitation = jest.fn();
const acceptUserInvitation = jest.fn();
jest.mock("@/api/backendApi", () => ({
  checkUserInvitation: (...a: unknown[]) => checkUserInvitation(...a),
  acceptUserInvitation: (...a: unknown[]) => acceptUserInvitation(...a),
  isElectron: () => false,
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
  navigate.mockReset();
  checkUserInvitation.mockResolvedValue({ success: true, data: INVITE });
});

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

  it("no invite in the address: generic message, nothing is checked", async () => {
    searchParams = new URLSearchParams("");
    render(<JoinShop />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This invite link is not valid");
    expect(checkUserInvitation).not.toHaveBeenCalled();
  });
});
