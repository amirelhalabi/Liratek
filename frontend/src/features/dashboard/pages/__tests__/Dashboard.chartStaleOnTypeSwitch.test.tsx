/** @jest-environment jsdom */

/**
 * Dashboard — CHART-STALE-ON-TYPE-SWITCH (chart-lane round-1 review,
 * OWNER_NOTES_2026-09-21.md §7.1).
 *
 * `loadData`'s keep-previous-data-on-failure rule (DC-7) exists so a
 * transient chart-fetch failure doesn't blank a chart the operator is
 * actively looking at. But that rule used to apply even when the operator
 * had just SWITCHED chartType (Sales → Profit) and the NEW type's fetch
 * failed: the OLD type's rows stayed in `chartData`, so `DashboardChart`
 * would draw the Sales usd/lbp values under a "Profit Trend" header —
 * effectively an empty/misleading line (no `profit` key) beside the
 * failure pill, instead of the honest empty state.
 *
 * Drives the REAL `Dashboard` page and the REAL `<Select>` (headlessui,
 * not mocked — mirrors `Partners.systemAssociationDropdown.test.tsx`'s
 * proven pattern for opening/selecting a headlessui Listbox in jsdom).
 * Only `DashboardChart` is stood in for (same stand-in as the DC-8 guard
 * test: a div that surfaces `chartData`'s `date`s as text, without needing
 * recharts/ResponsiveContainer to lay out real SVG under jsdom).
 */

import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "../Dashboard";

jest.setTimeout(8000);

const mockApi = {
  getDashboardStats: jest.fn().mockResolvedValue({
    totalSalesUSD: 0,
    totalSalesLBP: 0,
    cashCollectedUSD: 0,
    cashCollectedLBP: 0,
    ordersCount: 0,
    activeClients: 0,
  }),
  // Sales resolves with a distinguishing row; Profit rejects — the
  // fixture this test needs: a successful load for the type on screen,
  // then a failed load for the type the operator switches to.
  getProfitSalesChart: jest.fn((type: string) =>
    type === "Profit"
      ? Promise.reject(new Error("profit chart failed"))
      : Promise.resolve([{ date: "2026-09-10", usd: 100, lbp: 0 }]),
  ),
  getTodaysSales: jest.fn().mockResolvedValue([]),
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({}),
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
  // LIRA-086 — Dashboard now also calls useSellRate() (checkpoint variance
  // coloring), which reads api.getRates(); unmocked throws synchronously.
  getRates: jest.fn().mockResolvedValue([]),
  hasInitialBalancesSet: jest.fn().mockResolvedValue(true),
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
    flags: { sessionManagement: false, customerSessions: false },
    refreshFlags: async () => {},
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "cashier", username: "test" } }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

// Same stand-in as Dashboard.chartUsesLocalDateParse.guard.test.tsx: surfaces
// the exact `date` strings inside `chartData` as text, without needing
// recharts/ResponsiveContainer to lay out real SVG under jsdom.
jest.mock("../../components/DashboardChart", () => ({
  __esModule: true,
  default: ({ chartData }: { chartData: { date: string }[] }) => (
    <div data-testid="chart-dates">
      {chartData.map((d) => d.date).join(",")}
    </div>
  ),
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
  mockApi.getProfitSalesChart.mockImplementation((type: string) =>
    type === "Profit"
      ? Promise.reject(new Error("profit chart failed"))
      : Promise.resolve([{ date: "2026-09-10", usd: 100, lbp: 0 }]),
  );
  mockApi.getTodaysSales.mockResolvedValue([]);
  mockApi.getSystemExpectedBalancesDynamic.mockResolvedValue({});
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
  mockApi.getUnsettledSummary.mockResolvedValue([]);
  mockApi.getAllActiveCarrierLines.mockResolvedValue([]);
  mockApi.hasInitialBalancesSet.mockResolvedValue(true);
  mockApi.holdMoney.active.mockResolvedValue({ success: true, data: [] });
});

// Owner decision 2026-10-29: the trend chart shows sales only — no
// Sales/Profit switch, for any role. The stale-rows-after-a-failed-switch
// case this file guarded can no longer happen; it now guards that the
// switch (and any Profit load) stays gone (rule 24).
describe("Dashboard — sales trend has no Profit view (owner decision 2026-10-29)", () => {
  it("offers no Sales/Profit switch and only ever loads the Sales series", async () => {
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("chart-dates").textContent).toBe("Sep 10"),
    );
    expect(
      screen.queryByRole("button", { name: "Product & Telecom Sales" }),
    ).toBeNull();
    expect(screen.queryByRole("option", { name: "Profit" })).toBeNull();
    expect(mockApi.getProfitSalesChart).not.toHaveBeenCalledWith("Profit");
    expect(mockApi.getProfitSalesChart).toHaveBeenCalledWith("Sales");
  });
});
