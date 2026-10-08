/** @jest-environment jsdom */
/**
 * "My account" (/account), every signed-in user (admin AND staff).
 *
 * LIRA-291: the user's own sign-in methods and signed-in devices. The panels
 * are the SAME components Settings used (one copy each), so this only checks
 * the page assembles them.
 *
 * LIRA-292: a read-only Profile at the top, and "Display (this device)" —
 * the per-browser preferences that used to sit in Settings → Shop Config
 * (admin-only), so staff can now set their own. The storage keys are the
 * ones the rest of the app reads, so nothing resets. On the desktop app the
 * page shows only Profile and Display: sign-in methods and devices stay
 * web-only (desktop admins keep Settings → Signed-in Devices).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { requestOwnEmailChangeSchema } from "@liratek/core";

jest.mock("@/features/settings/pages/Settings/GoogleAccountPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-signin-methods" />,
}));
jest.mock("@/features/settings/pages/Settings/SignedInDevices", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-devices" />,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 7, username: "cashier1", role: "staff" } }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopName: () => "Corner Shop",
}));

const mockGetMyEmail = jest.fn();
const mockRequestEmailChange = jest.fn();
const mockChangeOwnPassword = jest.fn();
jest.mock("@/api/backendApi", () => ({
  requestEmailChange: (...args: unknown[]) => mockRequestEmailChange(...args),
  changeOwnPassword: (...args: unknown[]) => mockChangeOwnPassword(...args),
  isElectron: () =>
    typeof window !== "undefined" &&
    !!(window as unknown as { api?: unknown }).api,
  getMyEmail: (...args: unknown[]) => mockGetMyEmail(...args),
}));

import MyAccount from "../MyAccount";

const setDesktop = (on: boolean) => {
  if (on) (window as unknown as { api?: unknown }).api = {};
  else delete (window as unknown as { api?: unknown }).api;
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  setDesktop(false);
  mockGetMyEmail.mockResolvedValue({
    success: true,
    data: {
      email: "cashier1@example.com",
      emailVerifiedAt: "2026-10-01T10:00:00.000Z",
    },
  });
});
afterEach(() => setDesktop(false));

it("is titled 'My account' and shows Sign-in methods and Signed-in devices (web)", () => {
  render(<MyAccount />);
  expect(
    screen.getByRole("heading", { name: "My account" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("panel-signin-methods")).toBeInTheDocument();
  expect(screen.getByTestId("panel-devices")).toBeInTheDocument();
});

it("Profile: username, role, shop and the confirmed email with a Verified badge", async () => {
  render(<MyAccount />);
  const profile = screen.getByRole("region", { name: "Profile" });
  expect(profile).toHaveTextContent("cashier1");
  expect(profile).toHaveTextContent("Staff");
  expect(profile).toHaveTextContent("Corner Shop");
  await waitFor(() =>
    expect(profile).toHaveTextContent("cashier1@example.com"),
  );
  expect(screen.getByText("Verified")).toBeInTheDocument();
});

it("a staff user sees Display (this device), saved on this device only", () => {
  render(<MyAccount />);
  const display = screen.getByRole("region", { name: "Display (this device)" });
  expect(display).toHaveTextContent("Saved on this device only");
  expect(display).toHaveTextContent("Navigation Style");
  expect(display).toHaveTextContent("POS Product Display");
  expect(display).toHaveTextContent("Auto-fill Payment Amount");
  expect(display).toHaveTextContent("UI Scale");
});

it("changing UI scale and navigation style writes the SAME localStorage keys and events", () => {
  const layoutEvents: string[] = [];
  const onLayout = () => layoutEvents.push("layout-mode-changed");
  window.addEventListener("layout-mode-changed", onLayout);
  try {
    render(<MyAccount />);
    fireEvent.click(screen.getByRole("button", { name: "90%" }));
    expect(localStorage.getItem("ui_scale")).toBe("0.9");

    fireEvent.click(screen.getByRole("button", { name: /Page View/ }));
    expect(localStorage.getItem("layout_mode")).toBe("page-view");
    expect(layoutEvents).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(localStorage.getItem("home_columns")).toBe("3");

    fireEvent.click(screen.getByRole("button", { name: /Table View/ }));
    expect(localStorage.getItem("pos_show_images")).toBe("false");
  } finally {
    window.removeEventListener("layout-mode-changed", onLayout);
  }
});

it("desktop app: no sign-in methods panel, no devices, no email lookup", () => {
  setDesktop(true);
  render(<MyAccount />);
  expect(screen.getByRole("region", { name: "Profile" })).toHaveTextContent(
    "cashier1",
  );
  expect(
    screen.getByRole("region", { name: "Display (this device)" }),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("panel-signin-methods")).toBeNull();
  expect(screen.queryByTestId("panel-devices")).toBeNull();
  expect(mockGetMyEmail).not.toHaveBeenCalled();
});

// ── LIRA-293 ──────────────────────────────────────────────────────────────

it("LIRA-293 desktop: a Change password form (desktop users always have a password)", () => {
  setDesktop(true);
  render(<MyAccount />);
  expect(
    screen.getByRole("form", { name: "Change password" }),
  ).toBeInTheDocument();
});

it("LIRA-293 web: Profile → Change email sends the schema's payload and says to check the inbox", async () => {
  mockRequestEmailChange.mockResolvedValue({
    success: true,
    data: { pendingEmail: "new@example.com", oldNotified: true },
  });
  render(<MyAccount />);
  const profile = screen.getByRole("region", { name: "Profile" });
  await waitFor(() =>
    expect(profile).toHaveTextContent("cashier1@example.com"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  fireEvent.change(screen.getByLabelText("New email"), {
    target: { value: "new@example.com" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Send confirmation link" }),
  );
  await waitFor(() => expect(mockRequestEmailChange).toHaveBeenCalledTimes(1));
  const payload = mockRequestEmailChange.mock.calls[0]![0];
  expect(requestOwnEmailChangeSchema.parse(payload)).toEqual(payload);
  expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  // The shown email is still the old one until the link is opened.
  expect(profile).toHaveTextContent("cashier1@example.com");
});

it("LIRA-293 web: a refusal (address taken in this shop) is shown", async () => {
  mockRequestEmailChange.mockResolvedValue({
    success: false,
    error: {
      code: "EMAIL_TAKEN_IN_SHOP",
      message: "Another user in this shop already uses this email",
    },
  });
  render(<MyAccount />);
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  fireEvent.change(screen.getByLabelText("New email"), {
    target: { value: "taken@example.com" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Send confirmation link" }),
  );
  expect(
    await screen.findByText(
      "Another user in this shop already uses this email",
    ),
  ).toBeInTheDocument();
});

it("LIRA-293 desktop: no Change email (the desktop app has no email)", () => {
  setDesktop(true);
  render(<MyAccount />);
  expect(screen.queryByRole("button", { name: "Change email" })).toBeNull();
});
