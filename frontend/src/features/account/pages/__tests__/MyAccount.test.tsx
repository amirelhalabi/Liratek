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

import { act, fireEvent, render, screen } from "@testing-library/react";

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

const mockChangeOwnPassword = jest.fn();
const mockGetMyEmail = jest.fn();
jest.mock("@/api/backendApi", () => ({
  changeOwnPassword: (...args: unknown[]) => mockChangeOwnPassword(...args),
  getMyEmail: (...args: unknown[]) => mockGetMyEmail(...args),
  isElectron: () =>
    typeof window !== "undefined" &&
    !!(window as unknown as { api?: unknown }).api,
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
  mockGetMyEmail.mockResolvedValue({ success: true, data: null });
});
afterEach(() => setDesktop(false));

it("is titled 'My account' and shows account sign-in controls and signed-in devices (web)", () => {
  render(<MyAccount />);
  const pageTitle = screen.getByRole("heading", { name: "My account" });
  expect(pageTitle).toHaveClass("sr-only");
  expect(pageTitle.parentElement).toHaveClass("p-6", "flex", "gap-6");
  expect(pageTitle.nextElementSibling).not.toHaveClass("max-w-4xl");
  expect(screen.getByTestId("panel-signin-methods")).toBeInTheDocument();
  expect(screen.getByTestId("panel-devices")).toBeInTheDocument();
});

it("Profile: shows username and role together without field labels", () => {
  render(<MyAccount />);
  const profile = screen.getByRole("region", { name: "Profile" });
  expect(profile).toHaveTextContent("cashier1 - Staff");
  expect(profile).not.toHaveTextContent("Username");
  expect(profile).not.toHaveTextContent("Role");
  expect(profile).not.toHaveTextContent("Corner Shop");
  expect(screen.queryByRole("button", { name: "Change email" })).toBeNull();
});

it("Profile: shows the account email under the username and role when one exists", async () => {
  mockGetMyEmail.mockResolvedValue({
    success: true,
    data: {
      email: "cashier@example.com",
      emailVerifiedAt: "2026-10-01T10:00:00.000Z",
    },
  });

  render(<MyAccount />);

  const profile = screen.getByRole("region", { name: "Profile" });
  expect(await screen.findByText("cashier@example.com")).toBeInTheDocument();
  expect(profile).toHaveTextContent("cashier1 - Staff");
  expect(profile).toHaveTextContent("cashier@example.com");
});

it("Profile: does not show an email line when the account has no email", async () => {
  render(<MyAccount />);

  const profile = screen.getByRole("region", { name: "Profile" });
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockGetMyEmail).toHaveBeenCalledTimes(1);
  expect(profile.querySelectorAll("p")).toHaveLength(1);
  expect(profile).not.toHaveTextContent("Email");
});

it("a staff user sees Display (this device), saved on this device only", () => {
  render(<MyAccount />);
  const display = screen.getByRole("region", { name: "Display (this device)" });
  expect(display).toHaveTextContent("Saved on this device only");
  expect(display).toHaveTextContent("Navigation Style");
  expect(display).toHaveTextContent("POS Product Display");
  expect(display).toHaveTextContent("Auto-fill Payment Amount");
  // LIRA-295: no UI Scale on the web — the browser's own zoom does it.
  expect(display).not.toHaveTextContent("UI Scale");
  expect(display).toHaveTextContent("use your browser's zoom");
  expect(screen.queryByRole("button", { name: "90%" })).toBeNull();
});

it("desktop app: Display keeps the UI Scale setting", () => {
  setDesktop(true);
  render(<MyAccount />);
  const display = screen.getByRole("region", { name: "Display (this device)" });
  expect(display).toHaveTextContent("UI Scale");
  expect(display).not.toHaveTextContent("use your browser's zoom");
});

it("changing UI scale and navigation style writes the SAME localStorage keys and events", () => {
  // UI Scale exists only in the desktop app (LIRA-295).
  setDesktop(true);
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

it("desktop app: no sign-in methods panel or devices", () => {
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
});

it("LIRA-293 desktop: a Change password form (desktop users always have a password)", () => {
  setDesktop(true);
  render(<MyAccount />);
  expect(
    screen.getByRole("form", { name: "Change password" }),
  ).toBeInTheDocument();
});
