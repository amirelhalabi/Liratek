/** @jest-environment jsdom */
/**
 * Settings -> Users, web app: sign-in methods (LIRA-291).
 *
 *   - a "Sign-in" column shows Password, Google or Password + Google, in the
 *     core wording (`signinMethodLabel`);
 *   - the Disconnect Google confirm warns when the member has no password:
 *     "we'll email them a link", or — no confirmed email / email off —
 *     "won't be able to sign in until a password is set";
 *   - after confirming, a message reports whether the link was emailed.
 *
 * Mocks are stable references (rule 25).
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import UsersManager from "../UsersManager";

const getNonAdminUsers = jest.fn();
const mockApi = {
  getNonAdminUsers,
  createUser: jest.fn(),
  setUserActive: jest.fn(),
  setUserRole: jest.fn(),
  setUserPassword: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

let desktop = false;
const listUserEmails = jest.fn();
const listUserInvitations = jest.fn();
const adminRemoveUserGoogle = jest.fn();
jest.mock("@/api/backendApi", () => ({
  isElectron: () => desktop,
  listUserEmails: (...a: unknown[]) => listUserEmails(...a),
  listUserInvitations: (...a: unknown[]) => listUserInvitations(...a),
  adminRemoveUserGoogle: (...a: unknown[]) => adminRemoveUserGoogle(...a),
  setUserEmail: jest.fn(),
  sendUserEmailVerification: jest.fn(),
  createUserInvitation: jest.fn(),
  revokeUserInvitation: jest.fn(),
  resendUserInvitation: jest.fn(),
  sendPasswordReset: jest.fn(),
}));

const USERS_291 = [
  { id: 11, username: "google_gina", role: "staff", is_active: 1 },
  { id: 12, username: "plain_pete", role: "staff", is_active: 1 },
  { id: 13, username: "both_bo", role: "staff", is_active: 1 },
  { id: 14, username: "noemail_nia", role: "staff", is_active: 1 },
];
const V = "2026-10-02T00:00:00.000Z";
const EMAILS = [
  { id: 11, email: "gina@gmail.com", emailVerifiedAt: V, google: { email: "gina@gmail.com" }, hasPassword: false },
  { id: 12, email: null, emailVerifiedAt: null, google: null, hasPassword: true },
  { id: 13, email: "bo@gmail.com", emailVerifiedAt: V, google: { email: "bo@gmail.com" }, hasPassword: true },
  { id: 14, email: null, emailVerifiedAt: null, google: { email: "nia@gmail.com" }, hasPassword: false },
];

let stopCapture: () => void = () => {};
function captureNotifications(): { message: string; type: string }[] {
  const events: { message: string; type: string }[] = [];
  stopCapture = appEvents.on("notification:show", (message, type) =>
    events.push({ message, type }),
  );
  return events;
}

function rowFor(username: string): HTMLElement {
  return screen.getByText(username).closest("tr") as HTMLElement;
}

beforeEach(() => {
  desktop = false;
  for (const fn of [getNonAdminUsers, listUserEmails, listUserInvitations, adminRemoveUserGoogle]) {
    fn.mockReset();
  }
  getNonAdminUsers.mockResolvedValue(USERS_291);
  listUserEmails.mockResolvedValue(EMAILS);
  listUserInvitations.mockResolvedValue({ emailConfigured: true, invitations: [] });
});

afterEach(() => stopCapture());


import { signinMethodLabel } from "@liratek/core";

describe("UsersManager — sign-in methods (LIRA-291)", () => {
  it("shows each user's sign-in methods in the core wording", async () => {
    render(<UsersManager />);
    expect(await screen.findByRole("columnheader", { name: "Sign-in" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("user-signin-11")).toHaveTextContent(
        signinMethodLabel({ hasPassword: false, google: true }),
      ),
    );
    expect(screen.getByTestId("user-signin-12")).toHaveTextContent(
      signinMethodLabel({ hasPassword: true, google: false }),
    );
    expect(screen.getByTestId("user-signin-13")).toHaveTextContent(
      signinMethodLabel({ hasPassword: true, google: true }),
    );
  });

  it("no password + confirmed email: the confirm says a link will be emailed; after it, the result is reported", async () => {
    adminRemoveUserGoogle.mockResolvedValue({
      success: true,
      data: {
        user: { ...EMAILS[0], google: null },
        passwordLink: "sent",
      },
    });
    const notifications = captureNotifications();
    render(<UsersManager />);
    await screen.findByText("google_gina");
    await waitFor(() => expect(listUserEmails).toHaveBeenCalled());
    fireEvent.click(await within(rowFor("google_gina")).findByText("Disconnect Google"));
    expect(screen.getByTestId("confirm-modal")).toHaveTextContent(
      "google_gina has no password. We'll email them a link to set one.",
    );
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));
    await waitFor(() =>
      expect(
        notifications.some(
          (n) => n.type === "success" && /link to set a password was emailed/i.test(n.message),
        ),
      ).toBe(true),
    );
  });

  it("no password + no confirmed email: the confirm says they can't sign in until a password is set; a not-sent result is reported", async () => {
    adminRemoveUserGoogle.mockResolvedValue({
      success: true,
      data: {
        user: { ...EMAILS[3], google: null },
        passwordLink: "not_sent",
        passwordLinkCode: "USER_HAS_NO_EMAIL",
      },
    });
    const notifications = captureNotifications();
    render(<UsersManager />);
    await screen.findByText("noemail_nia");
    await waitFor(() => expect(listUserEmails).toHaveBeenCalled());
    fireEvent.click(await within(rowFor("noemail_nia")).findByText("Disconnect Google"));
    expect(screen.getByTestId("confirm-modal")).toHaveTextContent(
      "noemail_nia won't be able to sign in until a password is set. You can set one here with Set Password.",
    );
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));
    await waitFor(() =>
      expect(
        notifications.some((n) => n.type === "error" && /set password/i.test(n.message)),
      ).toBe(true),
    );
  });

  it("no password, email OFF on the server: the 'won't be able to sign in' warning even with a confirmed email", async () => {
    listUserInvitations.mockResolvedValue({ emailConfigured: false, invitations: [] });
    render(<UsersManager />);
    await screen.findByText("google_gina");
    await waitFor(() => expect(listUserInvitations).toHaveBeenCalled());
    fireEvent.click(await within(rowFor("google_gina")).findByText("Disconnect Google"));
    expect(screen.getByTestId("confirm-modal")).toHaveTextContent(
      "google_gina won't be able to sign in until a password is set.",
    );
  });

  it("a user WITH a password: no extra warning", async () => {
    render(<UsersManager />);
    await screen.findByText("both_bo");
    fireEvent.click(await within(rowFor("both_bo")).findByText("Disconnect Google"));
    const text = screen.getByTestId("confirm-modal").textContent ?? "";
    expect(text).not.toMatch(/no password/);
    expect(text).not.toMatch(/until a password is set/);
  });
});
