/** @jest-environment jsdom */
/**
 * Signup page — the only unauthenticated WRITE path in the web app.
 *
 * What is worth asserting here is not the layout but the four things that
 * would each let a real user through the wrong door:
 *
 *   1. The submit button cannot fire without an invite code. The server is the
 *      real gate (`backend/src/api/__tests__/signup.api.test.ts`), but a form
 *      that lets you press the button and then reports a 403 reads as a broken
 *      deployment.
 *   2. The slug derives from the shop name AND stops deriving the moment it is
 *      edited by hand. Getting this wrong silently overwrites a deliberate
 *      choice of a permanent, unchangeable address.
 *   3. A server failure ("slug already taken") reaches the screen. It is the
 *      only way the user learns which field to change.
 *   4. Success shows the new slug and does NOT log anyone in — the tenant is
 *      sent to its own subdomain, matching the no-token contract the route
 *      test asserts from the other side.
 *
 * `fireEvent` rather than user-event: the repo does not depend on
 * @testing-library/user-event, and nothing here needs per-keystroke fidelity.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const signup = jest.fn();

jest.mock("@/api/backendApi", () => ({
  signup: (...args: unknown[]) => signup(...args),
  isElectron: () => false,
}));

const navigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Signup from "../Signup";

const VALID = {
  name: "Corner Tech",
  slug: "cornertech",
  username: "amir",
  password: "Str0ng-Password!",
  inviteCode: "let-me-in",
};

const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const submit = () => screen.getByTestId("signup-submit") as HTMLButtonElement;

function set(id: string, value: string) {
  fireEvent.change(field(id), { target: { value } });
}

/** Fills every required field with a valid value. */
function fillValid() {
  set("signup-shop-name", VALID.name);
  set("signup-slug", VALID.slug);
  set("signup-username", VALID.username);
  set("signup-password", VALID.password);
  set("signup-invite-code", VALID.inviteCode);
}

describe("Signup page", () => {
  beforeEach(() => {
    signup.mockReset();
    navigate.mockReset();
    signup.mockResolvedValue({
      success: true,
      data: { tenant: { id: 7, name: VALID.name, slug: VALID.slug } },
    });
  });

  describe("submit gating", () => {
    it("starts disabled", () => {
      render(<Signup />);
      expect(submit()).toBeDisabled();
    });

    it("stays disabled with everything filled EXCEPT the invite code", () => {
      render(<Signup />);

      set("signup-shop-name", VALID.name);
      set("signup-username", VALID.username);
      set("signup-password", VALID.password);

      expect(submit()).toBeDisabled();

      set("signup-invite-code", VALID.inviteCode);
      expect(submit()).toBeEnabled();
    });

    it("stays disabled while the slug is invalid", () => {
      render(<Signup />);

      fillValid();
      expect(submit()).toBeEnabled();

      // A leading dash is rejected by the server's charset rule; catching it
      // here saves a round trip that would consume a rate-limit slot.
      set("signup-slug", "-nope");
      expect(submit()).toBeDisabled();
    });

    it("stays disabled for a too-short password", () => {
      render(<Signup />);

      set("signup-shop-name", VALID.name);
      set("signup-username", VALID.username);
      set("signup-invite-code", VALID.inviteCode);
      set("signup-password", "abc");

      expect(submit()).toBeDisabled();
    });
  });

  describe("slug derivation", () => {
    it("derives the slug from the shop name", () => {
      render(<Signup />);

      set("signup-shop-name", "Corner Tech & Co");
      expect(field("signup-slug").value).toBe("corner-tech-co");
    });

    it("stops deriving once the slug is edited by hand", () => {
      render(<Signup />);

      set("signup-shop-name", "Corner");
      expect(field("signup-slug").value).toBe("corner");

      set("signup-slug", "ct-beirut");

      // Editing the name AFTERWARDS must not clobber the deliberate choice:
      // the slug is the tenant's permanent address and cannot be changed
      // later.
      set("signup-shop-name", "Corner Tech");
      expect(field("signup-slug").value).toBe("ct-beirut");
    });

    it("sends the slug the field actually shows", async () => {
      render(<Signup />);

      set("signup-shop-name", "Corner Tech");
      set("signup-username", VALID.username);
      set("signup-password", VALID.password);
      set("signup-invite-code", VALID.inviteCode);
      fireEvent.click(submit());

      await waitFor(() => expect(signup).toHaveBeenCalledTimes(1));
      expect(signup.mock.calls[0]![0]).toMatchObject({
        name: "Corner Tech",
        slug: "corner-tech",
        adminUsername: VALID.username,
        inviteCode: VALID.inviteCode,
      });
    });
  });

  describe("failure", () => {
    it("shows the server's reason for a rejected signup", async () => {
      signup.mockResolvedValue({
        success: false,
        error: { message: "Tenant slug 'cornertech' is already taken" },
      });

      render(<Signup />);
      fillValid();
      fireEvent.click(submit());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "already taken",
      );
      // Still on the form, with the button usable again for a second attempt.
      expect(submit()).toBeEnabled();
    });

    it("surfaces a 403 — requestJson THROWS a plain object, not an Error", async () => {
      // The exact shape httpClient.ts builds for any non-2xx: `message` is
      // lifted off `data.error`, so for this route it is the nested
      // { code, message } object and NOT a string. An `instanceof Error`
      // check misses this value entirely, which made a wrong invite code
      // report itself as "could not reach the server".
      signup.mockRejectedValue({
        status: 403,
        message: { code: "FORBIDDEN", message: "Invalid invite code" },
        details: {},
      });

      render(<Signup />);
      fillValid();
      fireEvent.click(submit());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Invalid invite code",
      );
    });

    it("surfaces a 403 whose message is already a string", async () => {
      signup.mockRejectedValue({
        status: 403,
        message: "Signup is disabled on this deployment",
      });

      render(<Signup />);
      fillValid();
      fireEvent.click(submit());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Signup is disabled",
      );
    });

    it("shows a message when the request throws outright", async () => {
      // The realistic web failure: the tunnel to the backend is down.
      signup.mockRejectedValue(new Error("Failed to fetch"));

      render(<Signup />);
      fillValid();
      fireEvent.click(submit());

      expect(await screen.findByRole("alert")).toBeInTheDocument();
    });
  });

  describe("success", () => {
    it("confirms with the new slug and does not navigate into the app", async () => {
      render(<Signup />);
      fillValid();
      fireEvent.click(submit());

      expect(await screen.findByText(/is ready/i)).toBeInTheDocument();
      expect(screen.getByText(VALID.slug)).toBeInTheDocument();

      // No token is issued by the route, so nothing may auto-enter the app.
      expect(navigate).not.toHaveBeenCalled();
    });

    it("never renders the password back to the page", async () => {
      const { container } = render(<Signup />);
      fillValid();
      fireEvent.click(submit());

      await screen.findByText(/is ready/i);
      expect(container.innerHTML).not.toContain(VALID.password);
    });
  });
});
