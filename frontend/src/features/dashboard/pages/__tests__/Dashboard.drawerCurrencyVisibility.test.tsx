/** @jest-environment jsdom */

/**
 * Drawer currency visibility on the Dashboard (owner decision 2026-10-10,
 * shared with the phone app via core's `visibleDrawerCurrencies`).
 *
 * USD and LBP are always shown when a drawer holds them, even at zero; any
 * other currency only when it is not zero; a drawer whose currencies would
 * all be hidden (Binance at 0 USDT) still shows its own currencies.
 *
 * Harness copied from Dashboard.checkpointVarianceColor.test.tsx (real
 * Dashboard, read boundary mocked). Written FIRST and run against the old
 * "non-zero only, or all when all are zero" rule before the change.
 */

import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "../Dashboard";

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
    General: { USD: 0, LBP: 0, AUD: 0, EUR: 12 },
    OMT_System: { USD: 5, LBP: 0 },
    Binance: { USDT: 0 },
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
  getRates: jest.fn().mockResolvedValue([
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

describe("Dashboard drawer currencies", () => {
  it("Cash on Hand always shows USD and LBP, hides other zero currencies, keeps non-zero ones", async () => {
    render(<Dashboard />);
    const general = await screen.findByTestId("cash-on-hand-General");
    await waitFor(() => expect(general.textContent).toContain("12 EUR"));
    expect(general.textContent).toContain("0 USD");
    expect(general.textContent).toContain("0 LBP");
    expect(general.textContent).not.toContain("AUD");
  });

  it("Cash on Hand keeps a zero LBP next to a non-zero USD", async () => {
    render(<Dashboard />);
    const primary = await screen.findByTestId("cash-on-hand-OMT_System");
    await waitFor(() => expect(primary.textContent).toContain("5 USD"));
    expect(primary.textContent).toContain("0 LBP");
  });

  it("a drawer holding only a zero non-main currency still shows it", async () => {
    render(<Dashboard />);
    expect(await screen.findByText("0 USDT")).toBeTruthy();
  });
});
