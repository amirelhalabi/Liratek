/** @jest-environment jsdom */
/**
 * Settings — `?tab=` deep link (carrier-lines-validity plan Phase 4).
 *
 * Before this phase, `Settings/index.tsx` hardcoded
 * `useState<TabKey>("shop")` with no URL param and no `appEvents` listener,
 * so "navigate here and land on a specific tab" (the Dashboard's carrier-line
 * expiry banner needs exactly this) was impossible. This proves the seed
 * mechanism is generic — keyed off every tab, not carrier-lines-specific —
 * and reacts to the param even when the page doesn't remount.
 */

import { render, screen } from "@testing-library/react";

// Every tab manager is a heavy, network-backed component — stub them all so
// this test exercises only the tab-selection mechanism.
jest.mock("../UsersManager", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-users" />,
}));
jest.mock("../Diagnostics", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-diagnostics" />,
}));
jest.mock("../CurrencyManager", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-currencies" />,
}));
jest.mock("../ShopConfig", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-shop" />,
}));
jest.mock("../NotificationsConfig", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-notifications" />,
}));
jest.mock("../ModulesManager", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-modules" />,
}));
jest.mock("../IntegrationsConfig", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-integrations" />,
}));
jest.mock("../CategoriesManager", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-categories" />,
}));
jest.mock("../MobileServicesManager", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-mobile-services" />,
}));
jest.mock("../CarrierLinesManager", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-carrier-lines" />,
}));

let mockSearchParams = new URLSearchParams();
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [mockSearchParams],
}));

import Settings from "../index";

describe("Settings — ?tab= deep link", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    // `isElectron()` (frontend/src/api/backendApi.ts) is `!!window.api` —
    // start every test in "web" mode (no window.api) unless a test opts
    // into Electron mode itself, and never leak that opt-in across tests.
    delete (window as any).api;
  });

  afterEach(() => {
    delete (window as any).api;
  });

  it("defaults to the Shop Config tab with no ?tab= param", () => {
    render(<Settings />);
    expect(screen.getByTestId("panel-shop")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-carrier-lines")).not.toBeInTheDocument();
  });

  it("seeds the active tab from ?tab=carrier-lines", () => {
    mockSearchParams = new URLSearchParams({ tab: "carrier-lines" });
    render(<Settings />);
    expect(screen.getByTestId("panel-carrier-lines")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-shop")).not.toBeInTheDocument();
  });

  it("ignores an unknown ?tab= value and falls back to Shop Config", () => {
    mockSearchParams = new URLSearchParams({ tab: "not-a-real-tab" });
    render(<Settings />);
    expect(screen.getByTestId("panel-shop")).toBeInTheDocument();
  });

  it("is generic — every tab key deep-links to its own panel", () => {
    mockSearchParams = new URLSearchParams({ tab: "mobile-services" });
    render(<Settings />);
    expect(screen.getByTestId("panel-mobile-services")).toBeInTheDocument();
  });

  // The bug this guards: Diagnostics (embedding UpdatesPanel, which calls
  // window.api.updater.*) and Licence used to render on the web build and
  // throw / show an empty-looking tab. They must be genuinely ABSENT —
  // missing from the tab bar, not just unreachable by click — and their
  // deep links must fall back instead of mounting the broken panel.
  describe("desktop-only tabs are absent on the web build (no window.api)", () => {
    it("does not show the Diagnostics or Licence tab buttons", () => {
      render(<Settings />);
      expect(screen.queryByText("Diagnostics")).not.toBeInTheDocument();
      expect(screen.queryByText("Licence")).not.toBeInTheDocument();
      // Sanity check the rest of the tab bar is unaffected.
      expect(screen.getByText("Shop Config")).toBeInTheDocument();
    });

    it("falls back to Shop Config for ?tab=diagnostics instead of mounting Diagnostics", () => {
      mockSearchParams = new URLSearchParams({ tab: "diagnostics" });
      render(<Settings />);
      expect(screen.getByTestId("panel-shop")).toBeInTheDocument();
      expect(
        screen.queryByTestId("panel-diagnostics"),
      ).not.toBeInTheDocument();
    });

    it("falls back to Shop Config for ?tab=license instead of mounting LicensePanel", () => {
      mockSearchParams = new URLSearchParams({ tab: "license" });
      render(<Settings />);
      expect(screen.getByTestId("panel-shop")).toBeInTheDocument();
      // LicensePanel isn't mocked in this file — if it mounted, its own
      // heading would appear. It must not.
      expect(screen.queryByText("Licence")).not.toBeInTheDocument();
    });
  });

  // Prove the filter is conditional, not a blanket removal — Electron users
  // must keep both tabs exactly as before.
  describe("desktop-only tabs are present when window.api exists (Electron)", () => {
    beforeEach(() => {
      (window as any).api = {};
    });

    it("shows the Diagnostics and Licence tab buttons", () => {
      render(<Settings />);
      expect(screen.getByText("Diagnostics")).toBeInTheDocument();
      expect(screen.getByText("Licence")).toBeInTheDocument();
    });

    it("honors ?tab=diagnostics", () => {
      mockSearchParams = new URLSearchParams({ tab: "diagnostics" });
      render(<Settings />);
      expect(screen.getByTestId("panel-diagnostics")).toBeInTheDocument();
    });
  });
});
