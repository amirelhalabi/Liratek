/** @jest-environment jsdom */
/**
 * Settings -> Users, web app: Google sign-in per member (LIRA-288).
 *
 *   - each user shows whether Google is connected, with the Google email,
 *     or "—" when not;
 *   - the admin can disconnect it, only after confirming; the list reloads
 *     and a toast says so; a refusal shows the server's reason;
 *   - cancelling the confirm changes nothing;
 *   - on DESKTOP the column does not exist and nothing web-only is called.
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

const USERS = [
  { id: 11, username: "google_gina", role: "staff", is_active: 1 },
  { id: 12, username: "plain_pete", role: "staff", is_active: 1 },
];
const EMAILS = [
  { id: 11, email: "gina@shop.test", emailVerifiedAt: "2026-10-02T00:00:00.000Z", google: { email: "gina@gmail.com" } },
  { id: 12, email: null, emailVerifiedAt: null, google: null },
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
  getNonAdminUsers.mockResolvedValue(USERS);
  listUserEmails.mockResolvedValue(EMAILS);
  listUserInvitations.mockResolvedValue({ emailConfigured: true, invitations: [] });
});

afterEach(() => stopCapture());

describe("UsersManager — Google (web)", () => {
  it("shows the connected Google email, or — when not connected", async () => {
    render(<UsersManager />);
    expect(await screen.findByText("gina@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Google" })).toBeInTheDocument();
    expect(within(rowFor("plain_pete")).getByTestId("user-google-12")).toHaveTextContent("—");
    expect(within(rowFor("plain_pete")).queryByText("Disconnect Google")).toBeNull();
  });

  it("disconnects only after confirming, then reloads and says so", async () => {
    adminRemoveUserGoogle.mockResolvedValue({
      success: true,
      data: { user: { id: 11, email: "gina@shop.test", emailVerifiedAt: "2026-10-02T00:00:00.000Z", google: null } },
    });
    const notifications = captureNotifications();
    render(<UsersManager />);
    await screen.findByText("gina@gmail.com");

    fireEvent.click(within(rowFor("google_gina")).getByText("Disconnect Google"));
    expect(adminRemoveUserGoogle).not.toHaveBeenCalled();
    expect(screen.getByTestId("confirm-modal")).toHaveTextContent("google_gina");
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    await waitFor(() => expect(adminRemoveUserGoogle).toHaveBeenCalledWith(11));
    await waitFor(() => expect(listUserEmails).toHaveBeenCalledTimes(2));
    expect(
      notifications.some((n) => n.type === "success" && /google/i.test(n.message)),
    ).toBe(true);
  });

  it("cancelling the confirm changes nothing", async () => {
    render(<UsersManager />);
    await screen.findByText("gina@gmail.com");
    fireEvent.click(within(rowFor("google_gina")).getByText("Disconnect Google"));
    fireEvent.click(screen.getByTestId("confirm-modal-cancel-btn"));
    expect(screen.queryByTestId("confirm-modal")).toBeNull();
    expect(adminRemoveUserGoogle).not.toHaveBeenCalled();
  });

  it("a refusal shows the server's reason", async () => {
    adminRemoveUserGoogle.mockResolvedValue({
      success: false,
      error: { code: "NOT_FOUND", message: "User not found" },
    });
    const notifications = captureNotifications();
    render(<UsersManager />);
    await screen.findByText("gina@gmail.com");
    fireEvent.click(within(rowFor("google_gina")).getByText("Disconnect Google"));
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));
    await waitFor(() =>
      expect(notifications.some((n) => n.type === "error" && n.message === "User not found")).toBe(true),
    );
  });

  it("desktop: no Google column, nothing web-only is called", async () => {
    desktop = true;
    render(<UsersManager />);
    expect(await screen.findByText("google_gina")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Google" })).toBeNull();
    expect(listUserEmails).not.toHaveBeenCalled();
    expect(adminRemoveUserGoogle).not.toHaveBeenCalled();
  });
});
