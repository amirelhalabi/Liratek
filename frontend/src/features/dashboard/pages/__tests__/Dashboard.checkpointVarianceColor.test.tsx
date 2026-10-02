/** @jest-environment jsdom */

/**
 * LIRA-086 — Dashboard checkpoint freshness/variance coloring.
 *
 * `getLastCheckpointPerDrawer` already returns, per drawer, the last
 * checkpoint's per-currency `{physical, expected}` pair (the same numbers
 * the Checkpoint Timeline's own variance column reads). This colors a small
 * dot next to the existing checkpoint-time badge green/orange/red by how
 * far `physical` drifted from `expected`, converting LBP to its
 * USD-equivalent at the shop's sell rate (owner decision 2026-10-02:
 * green <= $1, orange <= $10, red > $10).
 *
 * Mirrors Dashboard.awaitingSettlementCount.test.tsx's harness (real
 * `Dashboard`, mocking only the read boundary) but with
 * `sessionManagement: true` (checkpoints must be enabled to render this at
 * all) and a non-empty `getSystemExpectedBalancesDynamic` result for the
 * "General" drawer (unowned by any module — always visible regardless of
 * `isModuleEnabled`, see `drawerModules.ts`'s `isDrawerVisible`).
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
  getSystemExpectedBalancesDynamic: jest
    .fn()
    .mockResolvedValue({ General: { USD: 500, LBP: 0 } }),
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
  useModules: () => ({ isModuleEnabled: () => false }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
    getSymbol: (c: string) => (c === "USD" ? "$" : "LBP"),
  }),
}));

jest.mock("@/contexts/FeatureFlagContext", () => ({
  useFeatureFlags: () => ({
    flags: { sessionManagement: true, customerSessions: false },
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
  jest.clearAllMocks();
  mockApi.getDashboardStats.mockResolvedValue({
    totalSalesUSD: 0,
    totalSalesLBP: 0,
    cashCollectedUSD: 0,
    cashCollectedLBP: 0,
    ordersCount: 0,
    activeClients: 0,
  });
  mockApi.getProfitSalesChart.mockResolvedValue([]);
  mockApi.getTodaysSales.mockResolvedValue([]);
  mockApi.getSystemExpectedBalancesDynamic.mockResolvedValue({
    General: { USD: 500, LBP: 0 },
  });
  mockApi.getDebtSummary.mockResolvedValue({
    totalDebt: 0,
    totalDebtUsd: 0,
    totalDebtLbp: 0,
    topDebtors: [],
  });
  mockApi.getInventoryStockStats.mockResolvedValue({
    stock_budget_usd: 0,
    stock_count: 0,
  });
  mockApi.getNetProfitLast30Days.mockResolvedValue({
    netProfitUSD: 0,
    netProfitLBP: 0,
    fromDate: "2026-08-26",
    toDate: "2026-09-24",
  });
  mockApi.getDebtors.mockResolvedValue([]);
  mockApi.getAllActiveCarrierLines.mockResolvedValue([]);
  mockApi.hasInitialBalancesSet.mockResolvedValue(true);
  mockApi.hasStartingCheckpoint.mockResolvedValue(true);
  mockApi.getRates.mockResolvedValue([
    { to_code: "LBP", market_rate: 89500, buy_rate: 89000, sell_rate: 89500 },
  ]);
  mockApi.holdMoney.active.mockResolvedValue({ success: true, data: [] });
});

async function renderDashboard() {
  const utils = render(<Dashboard />);
  await waitFor(() =>
    expect(mockGetLastCheckpointPerDrawer).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(screen.getAllByText("General").length).toBeGreaterThan(0),
  );
  return utils;
}

describe("Dashboard — checkpoint variance coloring (LIRA-086)", () => {
  it("colors the dot green when the last checkpoint matched expected within $1", async () => {
    mockGetLastCheckpointPerDrawer.mockResolvedValueOnce({
      General: {
        drawer_name: "General",
        checked_at: new Date().toISOString(),
        amounts: { USD: { physical: 500, expected: 500.5 } },
      },
    });

    await renderDashboard();

    const dot = await screen.findByTestId("checkpoint-variance-General");
    expect(dot.className).toContain("bg-green-400");
  });

  it("colors the dot orange when off by more than $1 up to $10", async () => {
    mockGetLastCheckpointPerDrawer.mockResolvedValueOnce({
      General: {
        drawer_name: "General",
        checked_at: new Date().toISOString(),
        amounts: { USD: { physical: 500, expected: 490 } },
      },
    });

    await renderDashboard();

    const dot = await screen.findByTestId("checkpoint-variance-General");
    expect(dot.className).toContain("bg-orange-400");
  });

  it("colors the dot red when off by more than $10", async () => {
    mockGetLastCheckpointPerDrawer.mockResolvedValueOnce({
      General: {
        drawer_name: "General",
        checked_at: new Date().toISOString(),
        amounts: { USD: { physical: 500, expected: 475 } },
      },
    });

    await renderDashboard();

    const dot = await screen.findByTestId("checkpoint-variance-General");
    expect(dot.className).toContain("bg-red-400");
  });

  it("converts an LBP variance to its USD-equivalent at the shop's sell rate before bucketing", async () => {
    // 89,500 LBP off at a sell rate of 89,500 LBP/USD is exactly $1 —
    // still green (<=, not <).
    mockGetLastCheckpointPerDrawer.mockResolvedValueOnce({
      General: {
        drawer_name: "General",
        checked_at: new Date().toISOString(),
        amounts: { LBP: { physical: 1_000_000, expected: 1_000_000 - 89_500 } },
      },
    });

    await renderDashboard();

    const dot = await screen.findByTestId("checkpoint-variance-General");
    expect(dot.className).toContain("bg-green-400");
  });

  it("renders no variance dot when the drawer has never been checkpointed", async () => {
    mockGetLastCheckpointPerDrawer.mockResolvedValueOnce({});

    await renderDashboard();

    expect(
      screen.queryByTestId("checkpoint-variance-General"),
    ).not.toBeInTheDocument();
  });
});
