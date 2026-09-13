/** @jest-environment jsdom */
/**
 * UsersManager — regression guard for the "user creation is not succeeding,
 * no messages" web bug report. Two silent-failure paths existed:
 *
 * (a) No success feedback existed on EITHER transport for any action — the
 *     only positive signal was the list silently refreshing. When the REST
 *     route lied about success, the operator saw literally nothing.
 * (b) `createUser`/`toggleActive`/`changeRole`/`setPassword`/`load` had NO
 *     `try/catch` and were passed raw to `onClick`/`useEffect`. `requestJson`
 *     (the web transport) throws a plain `{status, message, details}` OBJECT
 *     on any non-2xx — NOT an `Error` (see `apiError.ts`'s `messageFrom` doc
 *     comment; this exact pattern already shipped once and made every failed
 *     web login read "An unexpected error occurred" instead of the server's
 *     real reason). A `requireRole` 401/403 has no `success` field at all, so
 *     it rejected and React silently swallowed the unhandled rejection.
 *
 * Each "fails pre-fix" test below is proven failing-first (rule 17): reverting
 * the corresponding try/catch (or removing the success notification) makes
 * the test fail.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import UsersManager from "../UsersManager";

const getNonAdminUsers = jest.fn();
const createUser = jest.fn();
const setUserActive = jest.fn();
const setUserRole = jest.fn();
const setUserPassword = jest.fn();
// A STABLE object reference — a fresh literal per useApi() call would
// re-trigger any effect/callback with `api` in its dependency list (rule 25;
// see SignedInDevices.test.tsx / ResetDataModal.test.tsx for the same note).
const mockApi = {
  getNonAdminUsers,
  createUser,
  setUserActive,
  setUserRole,
  setUserPassword,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

/** The exact shape `requestJson` throws on any non-2xx — see apiError.ts. */
function apiThrow(message: string) {
  return { status: 500, message, details: {} };
}

const VALID_PASSWORD = "Password1!";

const EXISTING_USER = {
  id: 1,
  username: "cashier1",
  role: "staff" as const,
  is_active: 1,
};

// Unsubscribe handle for whichever capture is active in the current test —
// torn down in afterEach so listeners never leak across tests.
let stopCapture: () => void = () => {};

/** Captures every "notification:show" emission for the life of one test. */
function captureNotifications(): { message: string; type: string }[] {
  const events: { message: string; type: string }[] = [];
  stopCapture = appEvents.on("notification:show", (message, type) =>
    events.push({ message, type }),
  );
  return events;
}

async function fillCreateForm() {
  fireEvent.change(screen.getByPlaceholderText("Username"), {
    target: { value: "newstaffer" },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: VALID_PASSWORD },
  });
}

describe("UsersManager — silent-failure regression guards", () => {
  beforeEach(() => {
    getNonAdminUsers.mockReset();
    createUser.mockReset();
    setUserActive.mockReset();
    setUserRole.mockReset();
    setUserPassword.mockReset();
    getNonAdminUsers.mockResolvedValue([EXISTING_USER]);
  });

  afterEach(() => {
    stopCapture();
  });

  it("shows an error notification when createUser REJECTS (thrown plain object), instead of failing silently — fails pre-fix (no catch)", async () => {
    createUser.mockRejectedValue(apiThrow("Username already taken"));
    const notifications = captureNotifications();

    render(<UsersManager />);
    await fillCreateForm();
    fireEvent.click(await screen.findByText("Create"));

    await waitFor(() =>
      expect(
        notifications.some((n) => n.message === "Username already taken"),
      ).toBe(true),
    );
    expect(notifications.some((n) => n.type === "error")).toBe(true);
  });

  it("shows a success notification after a successful create — fails pre-fix (no success path existed on either transport)", async () => {
    createUser.mockResolvedValue({ success: true, id: 42 });
    const notifications = captureNotifications();

    render(<UsersManager />);
    await fillCreateForm();
    fireEvent.click(await screen.findByText("Create"));

    await waitFor(() =>
      expect(notifications.some((n) => n.type === "success")).toBe(true),
    );
    // The list must actually reflect the create, not just show a toast.
    expect(getNonAdminUsers).toHaveBeenCalledTimes(2); // initial load + refresh
  });

  it("shows the server's reason when createUser resolves {success:false,error}", async () => {
    createUser.mockResolvedValue({
      success: false,
      error: "Role must be admin or staff",
    });
    const notifications = captureNotifications();

    render(<UsersManager />);
    await fillCreateForm();
    fireEvent.click(await screen.findByText("Create"));

    await waitFor(() =>
      expect(
        notifications.some(
          (n) =>
            n.message === "Role must be admin or staff" && n.type === "error",
        ),
      ).toBe(true),
    );
  });

  it("surfaces an error notification when the list load fails, instead of silently rendering an empty table — fails pre-fix (no catch around load())", async () => {
    getNonAdminUsers.mockReset();
    getNonAdminUsers.mockRejectedValue(apiThrow("User store unreachable"));
    const notifications = captureNotifications();

    render(<UsersManager />);

    await waitFor(() =>
      expect(
        notifications.some((n) => n.message === "User store unreachable"),
      ).toBe(true),
    );
    expect(screen.getByText("No users")).toBeInTheDocument();
  });

  it("shows an error notification when toggling active status fails, instead of failing silently — fails pre-fix (no result/catch handling at all)", async () => {
    setUserActive.mockRejectedValue(apiThrow("Cannot deactivate last admin"));
    const notifications = captureNotifications();

    render(<UsersManager />);

    fireEvent.click(await screen.findByText("Deactivate"));

    await waitFor(() =>
      expect(
        notifications.some((n) => n.message === "Cannot deactivate last admin"),
      ).toBe(true),
    );
  });
});
