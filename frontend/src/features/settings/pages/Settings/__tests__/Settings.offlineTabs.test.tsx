/** @jest-environment jsdom */
/**
 * LIRA-306 — Settings' offline tabs (constitution E1):
 *   - "This PC" (desktop only): <PairThisPcCard/> — an admin pairs this PC
 *     for offline work (was built but not mounted anywhere);
 *   - "Paired PCs" (web only): <PairedPcsPanel/>.
 * The runtime is read with `isElectron()` (`!!window.api`), never a raw
 * `window.api` gate in the component.
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

jest.mock("../GoogleAccountPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-signin-methods" />,
}));
jest.mock("../SignedInDevices", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-devices" />,
}));

let mockSearchParams = new URLSearchParams();
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [mockSearchParams],
}));

jest.mock("../PairedPcsPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-paired-pcs" />,
}));
jest.mock("@/features/offline/components/PairThisPcCard", () => ({
  __esModule: true,
  PairThisPcCard: () => <div data-testid="panel-this-pc" />,
  default: () => <div data-testid="panel-this-pc" />,
}));

import Settings from "../index";

describe("Settings — offline tabs", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    delete (window as any).api;
  });
  afterEach(() => {
    delete (window as any).api;
  });

  it("desktop: a 'This PC' tab mounts the pairing card; no 'Paired PCs' tab", () => {
    (window as any).api = {};
    mockSearchParams = new URLSearchParams({ tab: "this-pc" });
    render(<Settings />);
    expect(screen.getByText("This PC")).toBeInTheDocument();
    expect(screen.getByTestId("panel-this-pc")).toBeInTheDocument();
    expect(screen.queryByText("Paired PCs")).not.toBeInTheDocument();
  });

  it("web: no 'This PC' tab (?tab=this-pc falls back to Shop Config); 'Paired PCs' mounts its panel", () => {
    mockSearchParams = new URLSearchParams({ tab: "this-pc" });
    const { unmount } = render(<Settings />);
    expect(screen.queryByText("This PC")).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-this-pc")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-shop")).toBeInTheDocument();
    unmount();
    mockSearchParams = new URLSearchParams({ tab: "paired-pcs" });
    render(<Settings />);
    expect(screen.getByTestId("panel-paired-pcs")).toBeInTheDocument();
  });
});
