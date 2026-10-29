/** @jest-environment jsdom */
/**
 * LIRA-331 — user-management payloads must not depend on the display
 * language. Drives the real UsersManager (web mode) through create user,
 * change role, deactivate, set email and invite, once in English and once in
 * Arabic, and asserts the captured api calls are deep-equal.
 *
 * Selectors are anchored on stored data (usernames), test ids, option order
 * and structure, so the same steps work in both languages.
 *
 * Written before UsersManager was converted: it passed against the
 * unconverted component (not failing-first — a guard against future drift,
 * e.g. a translated role label leaking into `role`).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import UsersManager from "../UsersManager";

const getUsers = jest.fn();
const createUser = jest.fn();
const setUserActive = jest.fn();
const setUserRole = jest.fn();
// Module-level: one stable identity (rule 25).
const mockApi = {
  getUsers,
  createUser,
  setUserActive,
  setUserRole,
  setUserPassword: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const listUserEmails = jest.fn();
const setUserEmail = jest.fn();
const listUserInvitations = jest.fn();
const createUserInvitation = jest.fn();
jest.mock("@/api/backendApi", () => ({
  isElectron: () => false,
  listUserEmails: (...a: unknown[]) => listUserEmails(...a),
  setUserEmail: (...a: unknown[]) => setUserEmail(...a),
  sendUserEmailVerification: jest.fn(),
  listUserInvitations: (...a: unknown[]) => listUserInvitations(...a),
  createUserInvitation: (...a: unknown[]) => createUserInvitation(...a),
  revokeUserInvitation: jest.fn(),
  resendUserInvitation: jest.fn(),
  sendPasswordReset: jest.fn(),
  adminRemoveUserGoogle: jest.fn(),
}));

const USERS = [{ id: 11, username: "vera", role: "staff", is_active: 1 }];

/** Picks option `index` of the custom Select whose trigger is `trigger`. */
async function pick(trigger: HTMLElement, index: number) {
  fireEvent.click(trigger);
  const options = await screen.findAllByRole("option");
  fireEvent.click(options[index]!);
}

function userCells(): HTMLElement[] {
  const row = screen.getByText("vera").closest("tr")!;
  return Array.from(row.querySelectorAll("td")) as HTMLElement[];
}

async function runFlow(): Promise<unknown[][]> {
  jest.clearAllMocks();
  getUsers.mockResolvedValue(USERS);
  listUserEmails.mockResolvedValue([
    { id: 11, email: null, emailVerifiedAt: null, hasPassword: true },
  ]);
  listUserInvitations.mockResolvedValue({
    emailConfigured: true,
    invitations: [],
  });
  createUser.mockResolvedValue({ success: true });
  setUserActive.mockResolvedValue({ success: true });
  setUserRole.mockResolvedValue({ success: true });
  setUserEmail.mockResolvedValue({
    success: true,
    data: { email: "vera@shop.test", verificationSent: true },
  });
  createUserInvitation.mockResolvedValue({
    success: true,
    data: { invitation: { email: "new@shop.test" } },
  });

  const { unmount } = render(<UsersManager />);
  await screen.findByText("vera");
  const addRow = screen.getByTestId("add-user-mode").parentElement!;

  // 1. Create user: username, password, role = admin (option 2), create.
  const [username, password] = Array.from(
    addRow.querySelectorAll("input"),
  ) as HTMLInputElement[];
  fireEvent.change(username!, { target: { value: "sam" } });
  fireEvent.change(password!, { target: { value: "Str0ng!Passw0rd" } });
  // The role Select is the row's own (direct-child) custom Select.
  const roleTrigger = () =>
    addRow
      .querySelector(":scope > [data-headlessui-state]")!
      .querySelector("button") as HTMLElement;
  await pick(roleTrigger(), 1);
  const buttons = addRow.querySelectorAll(":scope > button");
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1));
  await screen.findByText("vera");

  // 2. Make admin, 3. deactivate: actions cell → [active, role, password, reset].
  const actions = () => userCells()[userCells().length - 1]!;
  fireEvent.click(within(actions()).getAllByRole("button")[1]!);
  await waitFor(() => expect(setUserRole).toHaveBeenCalledTimes(1));
  await screen.findByText("vera");
  fireEvent.click(within(actions()).getAllByRole("button")[0]!);
  await waitFor(() => expect(setUserActive).toHaveBeenCalledTimes(1));
  await screen.findByText("vera");

  // 4. Set the email: the email cell's first button opens the editor.
  fireEvent.click(within(userCells()[1]!).getAllByRole("button")[0]!);
  fireEvent.change(screen.getByTestId("user-email-input-11"), {
    target: { value: " vera@shop.test " },
  });
  fireEvent.click(screen.getByTestId("user-email-save-11"));
  await waitFor(() => expect(setUserEmail).toHaveBeenCalledTimes(1));

  // 5. Invite: switch the add mode to its second option, staff role.
  await pick(within(screen.getByTestId("add-user-mode")).getByRole("button"), 1);
  fireEvent.change(await screen.findByTestId("invite-email"), {
    target: { value: " new@shop.test " },
  });
  fireEvent.click(screen.getByTestId("invite-submit"));
  await waitFor(() => expect(createUserInvitation).toHaveBeenCalledTimes(1));

  const calls = [
    ...createUser.mock.calls.map((c) => ["createUser", ...c]),
    ...setUserRole.mock.calls.map((c) => ["setUserRole", ...c]),
    ...setUserActive.mock.calls.map((c) => ["setUserActive", ...c]),
    ...setUserEmail.mock.calls.map((c) => ["setUserEmail", ...c]),
    ...createUserInvitation.mock.calls.map((c) => ["invite", ...c]),
  ];
  unmount();
  return calls;
}

async function inLanguage(lang: "en" | "ar") {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runFlow();
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("UsersManager — payloads are identical in English and Arabic", () => {
  it("create, role, active, email and invite", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar");
    expect(ar).toEqual(en);
    expect(en).toEqual([
      [
        "createUser",
        { username: "sam", password: "Str0ng!Passw0rd", role: "admin" },
      ],
      ["setUserRole", 11, "admin"],
      ["setUserActive", 11, false],
      ["setUserEmail", 11, { email: "vera@shop.test" }],
      ["invite", { email: "new@shop.test", role: "staff" }],
    ]);
  });
});
