/** @jest-environment jsdom */
/**
 * /#/verify-email?token=<token> — confirm an account email (LIRA-279).
 *
 * The token is single-use, so the page must call verify ONCE even under
 * StrictMode's double effect: a second call would be refused and flip a
 * success into "not valid".
 */

import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { verifyUserEmailSchema } from "@liratek/core";

const verifyUserEmail = jest.fn();
jest.mock("@/api/backendApi", () => ({
  verifyUserEmail: (...a: unknown[]) => verifyUserEmail(...a),
  isElectron: () => false,
}));

let searchParams = new URLSearchParams("token=t0k");
const setSearch = jest.fn();
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [searchParams, setSearch],
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import VerifyEmail from "../VerifyEmail";

beforeEach(() => {
  searchParams = new URLSearchParams("token=t0k");
  verifyUserEmail.mockReset();
});

describe("VerifyEmail", () => {
  it("verifies once under StrictMode and says the email is confirmed", async () => {
    verifyUserEmail.mockResolvedValue({ success: true, data: { verified: true } });
    render(
      <StrictMode>
        <VerifyEmail />
      </StrictMode>,
    );
    expect(await screen.findByText("Email confirmed")).toBeInTheDocument();
    expect(verifyUserEmail).toHaveBeenCalledTimes(1);
    expect(verifyUserEmailSchema.parse(verifyUserEmail.mock.calls[0]![0])).toEqual({
      token: "t0k",
    });
  });

  it("a refused link shows the server's generic message", async () => {
    verifyUserEmail.mockResolvedValue({
      success: false,
      error: { code: "FORBIDDEN", message: "This link is not valid. Ask for a new verification email." },
    });
    render(<VerifyEmail />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link is not valid. Ask for a new verification email.",
    );
  });

  it("a thrown transport error (e.g. 429) shows its message, not a crash", async () => {
    verifyUserEmail.mockRejectedValue({ status: 429, message: "Too many requests, please try again later" });
    render(<VerifyEmail />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
  });

  it("no token: generic message, nothing is called", async () => {
    searchParams = new URLSearchParams("");
    render(<VerifyEmail />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This link is not valid");
    expect(verifyUserEmail).not.toHaveBeenCalled();
  });
});
