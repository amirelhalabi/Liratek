/** @jest-environment jsdom */
/**
 * Settings — one section header for every tab (owner request 2026-11-25).
 * The shell renders the active tab's title and a one-sentence intro ONCE,
 * above the panel; a panel never repeats them. Profits Password is rendered
 * for real (not stubbed) so a title or intro left inside the panel shows up
 * here as a duplicate.
 */

import { render, screen, waitFor } from "@testing-library/react";

const stub = (id: string) => ({
  __esModule: true,
  default: () => <div data-testid={`panel-${id}`} />,
});
jest.mock("../UsersManager", () => stub("users"));
jest.mock("../Diagnostics", () => stub("diagnostics"));
jest.mock("../LicensePanel", () => stub("license"));
jest.mock("../CurrencyManager", () => stub("currencies"));
jest.mock("../ShopConfig", () => stub("shop"));
jest.mock("../NotificationsConfig", () => stub("notifications"));
jest.mock("../ModulesManager", () => stub("modules"));
jest.mock("../IntegrationsConfig", () => stub("integrations"));
jest.mock("../CategoriesManager", () => stub("categories"));
jest.mock("../MobileServicesManager", () => stub("mobile-services"));
jest.mock("../CarrierLinesManager", () => stub("carrier-lines"));
jest.mock("../ResetDataPanel", () => stub("reset"));
jest.mock("../GoogleAccountPanel", () => stub("signin-methods"));
jest.mock("../SignedInDevices", () => stub("devices"));
jest.mock("../PairedPcsPanel", () => stub("paired-pcs"));
jest.mock("../ShopBackupPanel", () => stub("backup"));
jest.mock("../ShopRestorePanel", () => stub("restore"));
jest.mock("@/features/offline/components/PairThisPcCard", () => ({
  __esModule: true,
  PairThisPcCard: () => <div data-testid="panel-this-pc" />,
}));

// Module-level: one stable identity (rule 25).
const mockApi = {
  getProfitsPasswordStatus: jest.fn().mockResolvedValue({ isSet: false }),
  setProfitsPassword: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

let mockSearchParams = new URLSearchParams();
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [mockSearchParams],
}));

import Settings from "../index";

const PROFITS_INTRO =
  "This password is required from EVERYONE — including admins — on every visit to the Profits page. A correct password unlocks Profits for 15 minutes; navigating away locks it again immediately.";

describe("Settings — one section header per tab", () => {
  beforeEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it("Profits Password shows its title and intro exactly once, from the shell", async () => {
    mockSearchParams = new URLSearchParams({ tab: "profits" });
    render(<Settings />);
    await waitFor(() =>
      expect(mockApi.getProfitsPasswordStatus).toHaveBeenCalled(),
    );

    expect(
      screen.getAllByRole("heading", { name: "Profits Password" }),
    ).toHaveLength(1);
    expect(screen.getAllByText(PROFITS_INTRO)).toHaveLength(1);
  });

  it("desktop Signed-in Devices: the shell shows the sessions intro", () => {
    (window as unknown as { api?: unknown }).api = {};
    mockSearchParams = new URLSearchParams({ tab: "devices" });
    render(<Settings />);
    expect(
      screen.getByRole("heading", { name: "Signed-in Devices" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Review your active sessions. Sign out of devices you no longer use. To sign out this device, use its Sign out button.",
      ),
    ).toHaveLength(1);
  });

  it("every other tab gets a heading and an intro too", () => {
    mockSearchParams = new URLSearchParams({ tab: "categories" });
    render(<Settings />);
    const heading = screen.getByRole("heading", {
      name: "Categories & Suppliers",
    });
    expect(heading.nextElementSibling?.textContent?.trim()).toBeTruthy();
  });
});
