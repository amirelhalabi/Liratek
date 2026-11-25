/** @jest-environment jsdom */
/**
 * Settings side menu — the tabs are grouped under headings in a side menu
 * instead of one long sideways-scrolling bar (owner request 2026-11-25).
 * Each group lists its tabs in order; desktop-only and web-only tabs appear
 * only in their own build, and an empty group is not shown.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";

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
jest.mock("../ProfitsPasswordPanel", () => stub("profits"));
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

let mockSearchParams = new URLSearchParams();
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [mockSearchParams],
}));

import Settings from "../index";

function groupTabs(name: string): string[] {
  const group = screen.getByRole("group", { name });
  return within(group)
    .getAllByRole("button")
    .map((b) => b.textContent ?? "");
}

describe("Settings — grouped side menu", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    delete (window as unknown as { api?: unknown }).api;
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it("web: tabs are grouped under headings, in order", () => {
    render(<Settings />);
    expect(
      screen.getByRole("navigation", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(groupTabs("Shop")).toEqual([
      "Shop Config",
      "Modules & Drawers",
      "Currencies & Rates",
      "Notifications",
      "Integrations",
    ]);
    expect(groupTabs("Catalogue")).toEqual([
      "Categories & Suppliers",
      "Mobile Services",
      "Carrier Lines",
    ]);
    expect(groupTabs("People")).toEqual(["Users", "Profits Password"]);
    expect(groupTabs("Devices")).toEqual(["Paired PCs"]);
    expect(groupTabs("Data & system")).toEqual(["Backup", "Reset Data"]);
  });

  it("desktop: desktop-only tabs sit in their groups; web-only tabs are gone", () => {
    (window as unknown as { api?: unknown }).api = {};
    render(<Settings />);
    expect(groupTabs("People")).toEqual([
      "Users",
      "Profits Password",
      "Signed-in Devices",
    ]);
    expect(groupTabs("Devices")).toEqual(["This PC"]);
    expect(groupTabs("Data & system")).toEqual([
      "Diagnostics",
      "Licence",
      "Reset Data",
    ]);
  });

  it("clicking a tab in the menu shows its panel and marks it current", () => {
    render(<Settings />);
    const tab = screen.getByRole("button", { name: "Carrier Lines" });
    fireEvent.click(tab);
    expect(screen.getByTestId("panel-carrier-lines")).toBeInTheDocument();
    expect(tab).toHaveAttribute("aria-current", "page");
  });
});
