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
});
