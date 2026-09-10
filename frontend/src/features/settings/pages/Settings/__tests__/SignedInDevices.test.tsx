/** @jest-environment jsdom */
/**
 * SignedInDevices — regression guard for the bug FIX 4 closes.
 *
 * All three catch blocks in the component used to do
 * `e instanceof Error ? e.message : "<fallback>"`. `requestJson` (the web
 * transport) throws a plain `{ status, message, details }` OBJECT on any
 * non-2xx response, not an `Error` (see `frontend/src/api/apiError.ts`'s doc
 * comment — this exact pattern already shipped once and made every failed
 * web login read "An unexpected error occurred" instead of the server's real
 * reason). `instanceof Error` is false for that object, so every genuine
 * failure rendered the generic fallback instead of the real message.
 *
 * Each test below rejects with that exact shape and asserts the SERVER'S
 * message reaches the screen — not the fallback. Proven failing-first: with
 * the three catch blocks reverted to `e instanceof Error ? e.message : …`,
 * all three tests fail (the fallback text renders / the real message is
 * absent); with `messageFrom` restored, all three pass.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import type { SafeSession } from "@liratek/core";
import SignedInDevices from "../SignedInDevices";

const listUserSessions = jest.fn();
const revokeSession = jest.fn();
const revokeOtherSessions = jest.fn();
// A STABLE object reference — a fresh literal per useApi() call would
// re-trigger the `load` useCallback's [api] dependency (see
// ResetDataModal.test.tsx / CarrierLinesManager.test.tsx for the same note).
const mockApi = { listUserSessions, revokeSession, revokeOtherSessions };

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ logout: jest.fn() }),
}));

/** The exact shape `requestJson` throws on any non-2xx — see apiError.ts. */
function apiThrow(message: string) {
  return { status: 500, message, details: {} };
}

const CURRENT: SafeSession = {
  id: 1,
  device_type: "electron",
  device_info: null,
  ip_address: "127.0.0.1",
  created_at: "2026-09-01T10:00:00.000Z",
  last_activity_at: "2026-09-01T10:00:00.000Z",
  is_current: true,
};

const OTHER: SafeSession = {
  id: 2,
  device_type: "web",
  device_info: "Chrome on Windows",
  ip_address: "8.8.8.8",
  created_at: "2026-09-01T09:00:00.000Z",
  last_activity_at: "2026-09-01T09:30:00.000Z",
  is_current: false,
};

// Unsubscribe handle for whichever capture is active in the current test —
// torn down in afterEach so listeners never leak across tests.
let stopCapture: () => void = () => {};

/** Captures every "notification:show" emission for the life of one test. */
function captureNotifications(): string[] {
  const messages: string[] = [];
  stopCapture = appEvents.on("notification:show", (msg) =>
    messages.push(msg),
  );
  return messages;
}

describe("SignedInDevices — real error messages reach the screen", () => {
  beforeEach(() => {
    listUserSessions.mockReset();
    revokeSession.mockReset();
    revokeOtherSessions.mockReset();
  });

  afterEach(() => {
    stopCapture();
  });

  it("shows the server's reason when loading the list fails, not the generic fallback", async () => {
    listUserSessions.mockRejectedValue(
      apiThrow("Session store unreachable"),
    );

    render(<SignedInDevices />);

    expect(
      await screen.findByText("Session store unreachable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load signed-in devices"),
    ).not.toBeInTheDocument();
  });

  it("shows the server's reason when revoking one session fails, not the generic fallback", async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    listUserSessions.mockResolvedValue([CURRENT, OTHER]);
    revokeSession.mockRejectedValue(apiThrow("Session already ended"));
    const notifications = captureNotifications();

    render(<SignedInDevices />);

    fireEvent.click(await screen.findByText("Revoke"));

    await waitFor(() =>
      expect(notifications).toContain("Session already ended"),
    );
    expect(notifications).not.toContain("Failed to end session");
  });

  it("shows the server's reason when 'sign out everywhere else' fails, not the generic fallback", async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    listUserSessions.mockResolvedValue([CURRENT, OTHER]);
    revokeOtherSessions.mockRejectedValue(
      apiThrow("Too many sessions ended recently"),
    );
    const notifications = captureNotifications();

    render(<SignedInDevices />);

    fireEvent.click(
      await screen.findByText("Sign out everywhere else"),
    );

    await waitFor(() =>
      expect(notifications).toContain("Too many sessions ended recently"),
    );
    expect(notifications).not.toContain("Failed to sign out other devices");
  });
});
