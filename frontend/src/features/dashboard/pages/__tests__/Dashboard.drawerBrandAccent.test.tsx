/** @jest-environment jsdom */

/**
 * Drawer Balances cards take their accent from the provider brand (owner
 * request 2026-10-16): every branded drawer shows its logo, and its left edge
 * and title colour come from PROVIDER_BRANDS — the expected classes are read
 * from there, never hand-typed (rule 24). General keeps its own accent.
 *
 * Harness copied from Dashboard.drawerCurrencyVisibility.test.tsx. Written
 * FIRST and run against the hand-picked per-drawer colour map.
 */

import { render, screen } from "@testing-library/react";
import Dashboard from "../Dashboard";
import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";

jest.setTimeout(5000);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetLastCheckpointPerDrawer = jest.fn();

const mockApi = {
  getDashboardStats: jest.fn().mockResolvedValue({
    totalSalesUSD: 0,
    totalSalesLBP: 0,
    cashCollectedUSD: 0,
    cashCollectedLBP: 0,
    ordersCount: 0,
    activeClients: 0,
  }),
  getProfitSalesChart: jest.fn().mockResolvedValue([]),
  getTodaysSales: jest.fn().mockResolvedValue([]),
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({
    General: { USD: 1, LBP: 0 },
    OMT_System: { USD: 1, LBP: 0 },
    OMT_App: { USD: 1, LBP: 0 },
    Whish_App: { USD: 1, LBP: 0 },
    Whish_System: { USD: 1, LBP: 0 },
    Binance: { USDT: 1 },
    MTC: { USD: 1 },
    Alfa: { USD: 1 },
    iPick: { USD: 1 },
    Katsh: { USD: 1 },
  }),
  getDebtSummary: jest.fn().mockResolvedValue({
    totalDebt: 0,
    totalDebtUsd: 0,
    totalDebtLbp: 0,
    topDebtors: [],
  }),
  getInventoryStockStats: jest
    .fn()
    .mockResolvedValue({ stock_budget_usd: 0, stock_count: 0 }),
  getNetProfitLast30Days: jest.fn().mockResolvedValue({
    netProfitUSD: 0,
    netProfitLBP: 0,
    fromDate: "2026-08-26",
    toDate: "2026-09-24",
  }),
  getDebtors: jest.fn().mockResolvedValue([]),
  getUnsettledSummary: jest.fn().mockResolvedValue([]),
  getAllActiveCarrierLines: jest.fn().mockResolvedValue([]),
  hasInitialBalancesSet: jest.fn().mockResolvedValue(true),
  hasStartingCheckpoint: jest.fn().mockResolvedValue(true),
  getLastCheckpointPerDrawer: mockGetLastCheckpointPerDrawer,
  getRates: jest
    .fn()
    .mockResolvedValue([
      { to_code: "LBP", market_rate: 89500, buy_rate: 89000, sell_rate: 89500 },
    ]),
  holdMoney: {
    active: jest.fn().mockResolvedValue({ success: true, data: [] }),
  },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => jest.fn(),
}));

jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ isModuleEnabled: () => true }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
    getSymbol: (c: string) => (c === "USD" ? "$" : "LBP"),
  }),
}));

jest.mock("@/contexts/FeatureFlagContext", () => ({
  useFeatureFlags: () => ({
    flags: { sessionManagement: false, customerSessions: false },
    refreshFlags: async () => {},
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin", username: "test" } }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

jest.mock("../../components/DashboardChart", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../../components/DrawerTopUpModal", () => ({
  DrawerTopUpModal: () => null,
}));
jest.mock("../../components/DrawerCashoutModal", () => ({
  DrawerCashoutModal: () => null,
}));
jest.mock("../../../closing/components/InitialDrawerAmountsModal", () => ({
  InitialDrawerAmountsModal: () => null,
}));

beforeEach(() => {
  mockGetLastCheckpointPerDrawer.mockResolvedValue({});
});

/** Every token of a literal class string. */
const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

describe("Dashboard drawer cards: brand accent", () => {
  it.each<[string, string, ProviderBrandKey]>([
    ["OMT_App", "OMT App", "OMT"],
    ["OMT_System", "OMT Cash Drawer", "OMT"],
    ["Whish_App", "Whish App", "WHISH"],
    ["Whish_System", "Whish Cash Drawer", "WHISH"],
    ["Katsh", "Katsh", "KATSH"],
    ["iPick", "iPick", "IPICK"],
    ["MTC", "MTC", "MTC"],
    ["Alfa", "Alfa", "ALFA"],
    ["Binance", "Binance", "BINANCE"],
  ])(
    "%s card shows the %s logo with the brand edge and title colour",
    async (drawer, _label, brand) => {
      render(<Dashboard />);
      const card = await screen.findByTestId(`drawer-card-${drawer}`);
      const b = PROVIDER_BRANDS[brand];

      expect(
        card.querySelector(
          `[data-testid="provider-logo-${brand.toLowerCase()}"]`,
        ),
      ).not.toBeNull();
      for (const t of tokens(b.accentEdge)) expect(card).toHaveClass(t);
      for (const t of tokens(b.accentHover)) expect(card).toHaveClass(t);
      const title = card.querySelector("h3");
      for (const t of tokens(b.accentText)) expect(title).toHaveClass(t);
    },
  );

  it("General keeps its own accent and no logo", async () => {
    render(<Dashboard />);
    const card = await screen.findByTestId("drawer-card-General");
    expect(card.querySelector('[data-testid^="provider-logo-"]')).toBeNull();
    expect(card).toHaveClass("border-l-blue-500");
    expect(card.querySelector("h3")).toHaveClass("text-blue-400");
  });
});
