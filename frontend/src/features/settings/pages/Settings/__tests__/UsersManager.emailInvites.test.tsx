/** @jest-environment jsdom */
/**
 * Settings -> Users, web app: user emails (LIRA-279), invite by email
 * (LIRA-281) and "Send password reset" (LIRA-276 button; the endpoint is
 * feature C's and is mocked here).
 *
 * What must hold:
 *   - each user shows their email with a Verified / Not verified badge;
 *   - setting an email, sending a verification link, inviting, revoking,
 *     resending and sending a reset call the adapter with the right ids and
 *     schema-shaped payloads (rule 24: payloads parsed through the core
 *     schemas), and refusals show the server's message;
 *   - the invite form is disabled with a banner when email is not set up;
 *   - on DESKTOP none of it renders and nothing web-only is called.
 *
 * Mocks are stable references (rule 25).
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import {
  createUserInvitationSchema,
  setUserEmailSchema,
  USER_ACCOUNT_CODES,
  EMAIL_TAKEN_IN_SHOP,
} from "@liratek/core";
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
const setUserEmail = jest.fn();
const sendUserEmailVerification = jest.fn();
const listUserInvitations = jest.fn();
const createUserInvitation = jest.fn();
const revokeUserInvitation = jest.fn();
const resendUserInvitation = jest.fn();
const sendPasswordReset = jest.fn();
jest.mock("@/api/backendApi", () => ({
  isElectron: () => desktop,
  listUserEmails: (...a: unknown[]) => listUserEmails(...a),
  setUserEmail: (...a: unknown[]) => setUserEmail(...a),
  sendUserEmailVerification: (...a: unknown[]) => sendUserEmailVerification(...a),
  listUserInvitations: (...a: unknown[]) => listUserInvitations(...a),
  createUserInvitation: (...a: unknown[]) => createUserInvitation(...a),
  revokeUserInvitation: (...a: unknown[]) => revokeUserInvitation(...a),
  resendUserInvitation: (...a: unknown[]) => resendUserInvitation(...a),
  sendPasswordReset: (...a: unknown[]) => sendPasswordReset(...a),
}));

const USERS = [
  { id: 11, username: "verified_vera", role: "staff", is_active: 1 },
  { id: 12, username: "pending_pete", role: "staff", is_active: 1 },
  { id: 13, username: "no_mail_nora", role: "staff", is_active: 1 },
];
const EMAILS = [
  { id: 1, email: "owner@shop.test", emailVerifiedAt: "2026-10-01T00:00:00.000Z" },
  { id: 11, email: "vera@shop.test", emailVerifiedAt: "2026-10-02T00:00:00.000Z" },
  { id: 12, email: "pete@shop.test", emailVerifiedAt: null },
  { id: 13, email: null, emailVerifiedAt: null },
];
const PENDING = {
  id: 501,
  email: "newbie@shop.test",
  role: "staff",
  status: "pending",
  createdAt: "2026-10-07T09:00:00.000Z",
  expiresAt: "2026-10-10T09:00:00.000Z",
  usedAt: null,
  usedByUserId: null,
  revokedAt: null,
  emailDelivery: { status: "accepted", attempts: 1, lastError: null, sentAt: "2026-10-07T09:00:05.000Z" },
};

let stopCapture: () => void = () => {};
function captureNotifications(): { message: string; type: string }[] {
  const events: { message: string; type: string }[] = [];
  stopCapture = appEvents.on("notification:show", (message, type) =>
    events.push({ message, type }),
  );
  return events;
}

function rowFor(username: string): HTMLElement {
  const cell = screen.getByText(username);
  return cell.closest("tr") as HTMLElement;
}

beforeEach(() => {
  desktop = false;
  for (const fn of [
    getNonAdminUsers,
    listUserEmails,
    setUserEmail,
    sendUserEmailVerification,
    listUserInvitations,
    createUserInvitation,
    revokeUserInvitation,
    resendUserInvitation,
    sendPasswordReset,
  ]) {
    fn.mockReset();
  }
  getNonAdminUsers.mockResolvedValue(USERS);
  listUserEmails.mockResolvedValue(EMAILS);
  listUserInvitations.mockResolvedValue({ emailConfigured: true, invitations: [PENDING] });
});

afterEach(() => stopCapture());

describe("UsersManager — emails (web)", () => {
  it("shows each user's email with a Verified / Not verified badge", async () => {
    render(<UsersManager />);
    expect(await screen.findByText("vera@shop.test")).toBeInTheDocument();
    expect(within(rowFor("verified_vera")).getByText("Verified")).toBeInTheDocument();
    expect(within(rowFor("pending_pete")).getByText("Not verified")).toBeInTheDocument();
    expect(within(rowFor("no_mail_nora")).getByText("No email")).toBeInTheDocument();
  });

  it("sets an email with a schema-shaped payload, then reloads emails and says a link was sent", async () => {
    setUserEmail.mockResolvedValue({
      success: true,
      data: { email: "nora@shop.test", emailVerifiedAt: null, verificationSent: true },
    });
    const notifications = captureNotifications();
    render(<UsersManager />);
    await screen.findByText("vera@shop.test");

    fireEvent.click(within(rowFor("no_mail_nora")).getByText("Add email"));
    fireEvent.change(screen.getByTestId("user-email-input-13"), {
      target: { value: "nora@shop.test" },
    });
    fireEvent.click(screen.getByTestId("user-email-save-13"));

    await waitFor(() => expect(setUserEmail).toHaveBeenCalledTimes(1));
    const [userId, payload] = setUserEmail.mock.calls[0] as [number, unknown];
    expect(userId).toBe(13);
    expect(setUserEmailSchema.parse(payload)).toEqual({ email: "nora@shop.test" });
    await waitFor(() => expect(listUserEmails).toHaveBeenCalledTimes(2));
    expect(
      notifications.some((n) => n.type === "success" && /verification/i.test(n.message)),
    ).toBe(true);
  });

  it("shows the server's reason when the address is taken in this shop", async () => {
    setUserEmail.mockResolvedValue({
      success: false,
      error: { code: EMAIL_TAKEN_IN_SHOP, message: "Another user in this shop already uses this email" },
    });
    const notifications = captureNotifications();
    render(<UsersManager />);
    await screen.findByText("vera@shop.test");

    fireEvent.click(within(rowFor("pending_pete")).getByText("Change email"));
    fireEvent.change(screen.getByTestId("user-email-input-12"), {
      target: { value: "vera@shop.test" },
    });
    fireEvent.click(screen.getByTestId("user-email-save-12"));

    await waitFor(() =>
      expect(
        notifications.some(
          (n) => n.type === "error" && n.message === "Another user in this shop already uses this email",
        ),
      ).toBe(true),
    );
  });

  it("sends a verification link only for an unverified address", async () => {
    sendUserEmailVerification.mockResolvedValue({ success: true, data: { sent: true } });
    render(<UsersManager />);
    await screen.findByText("vera@shop.test");

    expect(within(rowFor("verified_vera")).queryByText("Send verification")).toBeNull();
    fireEvent.click(within(rowFor("pending_pete")).getByText("Send verification"));
    await waitFor(() => expect(sendUserEmailVerification).toHaveBeenCalledWith(12));
  });

  it("Send password reset calls feature C's endpoint for a verified address; disabled without one", async () => {
    sendPasswordReset.mockResolvedValue({ success: true, data: { sent: true } });
    const notifications = captureNotifications();
    render(<UsersManager />);
    await screen.findByText("vera@shop.test");

    expect(within(rowFor("pending_pete")).getByText("Send password reset")).toBeDisabled();
    expect(within(rowFor("no_mail_nora")).getByText("Send password reset")).toBeDisabled();
    fireEvent.click(within(rowFor("verified_vera")).getByText("Send password reset"));
    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledWith(11));
    await waitFor(() => expect(notifications.some((n) => n.type === "success")).toBe(true));
  });

  it("a refused reset shows the server's reason", async () => {
    sendPasswordReset.mockResolvedValue({
      success: false,
      error: { code: USER_ACCOUNT_CODES.RATE_LIMITED, message: "Too many reset emails" },
    });
    const notifications = captureNotifications();
    render(<UsersManager />);
    await screen.findByText("vera@shop.test");
    fireEvent.click(within(rowFor("verified_vera")).getByText("Send password reset"));
    await waitFor(() =>
      expect(
        notifications.some((n) => n.type === "error" && n.message === "Too many reset emails"),
      ).toBe(true),
    );
  });
});

/** The add-user card starts in "Create username/password" mode. */
async function switchToInvite() {
  fireEvent.click(within(screen.getByTestId("add-user-mode")).getByRole("button"));
  fireEvent.click(await screen.findByRole("option", { name: "Send invitation" }));
  await screen.findByTestId("invite-email");
}

describe("UsersManager — invite by email (web)", () => {
  it("starts in create mode and offers the invite mode in the same card", async () => {
    render(<UsersManager />);
    await screen.findByText("newbie@shop.test");
    expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-email")).toBeNull();
    await switchToInvite();
    expect(screen.queryByPlaceholderText("Username")).toBeNull();
  });

  it("invites { email, role } with a schema-shaped payload and reloads the list", async () => {
    createUserInvitation.mockResolvedValue({ success: true, data: { invitation: PENDING } });
    const notifications = captureNotifications();
    render(<UsersManager />);
    await screen.findByText("newbie@shop.test");
    await switchToInvite();

    fireEvent.change(screen.getByTestId("invite-email"), {
      target: { value: "hire@shop.test" },
    });
    fireEvent.click(screen.getByTestId("invite-submit"));

    await waitFor(() => expect(createUserInvitation).toHaveBeenCalledTimes(1));
    expect(createUserInvitationSchema.parse(createUserInvitation.mock.calls[0]![0])).toEqual({
      email: "hire@shop.test",
      role: "staff",
    });
    await waitFor(() => expect(listUserInvitations).toHaveBeenCalledTimes(2));
    expect(notifications.some((n) => n.type === "success")).toBe(true);
  });

  it("lists pending invites with Resend and Revoke", async () => {
    revokeUserInvitation.mockResolvedValue({ success: true, data: { invitation: { ...PENDING, status: "revoked" } } });
    resendUserInvitation.mockResolvedValue({ success: true, data: { invitation: { ...PENDING, id: 502 } } });
    render(<UsersManager />);
    const row = (await screen.findByText("newbie@shop.test")).closest("tr") as HTMLElement;

    fireEvent.click(within(row).getByText("Resend"));
    await waitFor(() => expect(resendUserInvitation).toHaveBeenCalledWith(501));
    fireEvent.click(within(row).getByText("Revoke"));
    await waitFor(() => expect(revokeUserInvitation).toHaveBeenCalledWith(501));
  });

  it("when email is not set up: a banner, and the invite button is disabled", async () => {
    listUserInvitations.mockResolvedValue({ emailConfigured: false, invitations: [] });
    render(<UsersManager />);
    expect(await screen.findByText(/Email is not set up/i)).toBeInTheDocument();
    await switchToInvite();
    expect(screen.getByTestId("invite-submit")).toBeDisabled();
  });
});

describe("UsersManager — desktop", () => {
  it("shows none of the email or invite controls and calls nothing web-only", async () => {
    desktop = true;
    render(<UsersManager />);
    expect(await screen.findByText("verified_vera")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-email")).toBeNull();
    expect(screen.queryByTestId("add-user-mode")).toBeNull();
    expect(screen.queryByText("Send password reset")).toBeNull();
    expect(screen.queryByText("Verified")).toBeNull();
    expect(listUserEmails).not.toHaveBeenCalled();
    expect(listUserInvitations).not.toHaveBeenCalled();
  });
});
