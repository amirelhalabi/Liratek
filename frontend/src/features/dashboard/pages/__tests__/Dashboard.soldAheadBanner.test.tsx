/** @jest-environment jsdom */

/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * Dashboard — #28 (LIRA-218) M6 fix (2026-09-24 adversarial review).
 *
 * Pre-fix, a sold-ahead carrier-line balance was just one more
 * `PageAlertItem` inside the collapsible "N need attention" `PageAlerts`
 * pill — indistinguishable in tone from an amber "starting checkpoint not
 * recorded" nudge, and invisible until the operator clicks the pill open.
 * The owner asked for "a red dashboard countdown [that] stays until the
 * line is recharged" — a standing banner, not a pill entry. This drives the
 * REAL `Dashboard` page (same harness as `Dashboard.widgetLoadErrors
 * .test.tsx`) and proves the banner renders outside the pill, in red, with
 * a concrete day-count deadline, and disappears once `days_owed` is back to
 * 0 — the pre-fix render never produces `dashboard-sold-ahead-banner-*` at
 * all (that testid did not exist), so these fail against the pre-fix code.
 */

import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "../Dashboard";

jest.setTimeout(8000);

const DISTINGUISHING_SALES_USD = 4321;

const mockApi = {
  getDashboardStats: jest.fn(),
  getProfitSalesChart: jest.fn().mockResolvedValue([]),
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

// The recharge module must be ON for computeCarrierLineAlerts to run at all.
jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ isModuleEnabled: (m: string) => m === "recharge" }),
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

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    carrier: "mtc",
    phone_number: "03111111",
    label: "Shop Line 1",
    credits: 10,
    validity_expires_at: null,
    days_owed: 0,
    notes: null,
    is_active: 1,
    is_primary: 1,
    created_at: "2026-08-01 00:00:00",
    updated_at: "2026-08-01 00:00:00",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getDashboardStats.mockResolvedValue({
    totalSalesUSD: DISTINGUISHING_SALES_USD,
    totalSalesLBP: 0,
    cashCollectedUSD: 0,
    cashCollectedLBP: 0,
    ordersCount: 0,
    activeClients: 0,
  });
  mockApi.getProfitSalesChart.mockResolvedValue([]);
  mockApi.getTodaysSales.mockResolvedValue([]);
  mockApi.getSystemExpectedBalancesDynamic.mockResolvedValue({});
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

describe("Dashboard — #28 sold-ahead standing red banner (M6 fix)", () => {
  it("renders a standing red banner OUTSIDE the PageAlerts pill for a line carrying days_owed", async () => {
    mockApi.getAllActiveCarrierLines.mockResolvedValue([
      makeLine({ carrier: "mtc", days_owed: 210, validity_expires_at: null }),
    ]);

    render(<Dashboard />);
    await screen.findByText(`${DISTINGUISHING_SALES_USD} USD`);

    const banner = await screen.findByTestId(
      "dashboard-sold-ahead-banner-mtc",
    );
    expect(banner.textContent).toContain("210");
    expect(banner.textContent).toMatch(/sold ahead/i);
  });

  it("does NOT list the sold-ahead item inside the PageAlerts pill — it is a dedicated banner now, not a pill row", async () => {
    mockApi.getAllActiveCarrierLines.mockResolvedValue([
      makeLine({ carrier: "mtc", days_owed: 210, validity_expires_at: null }),
    ]);

    render(<Dashboard />);
    await screen.findByTestId("dashboard-sold-ahead-banner-mtc");

    expect(
      screen.queryByTestId("page-alerts-row-carrier-lines-sold-ahead"),
    ).not.toBeInTheDocument();
  });

  it("shows no sold-ahead banner when no line carries a days_owed balance (control)", async () => {
    mockApi.getAllActiveCarrierLines.mockResolvedValue([
      makeLine({ carrier: "mtc", days_owed: 0, validity_expires_at: null }),
    ]);

    render(<Dashboard />);
    await screen.findByText(`${DISTINGUISHING_SALES_USD} USD`);

    await waitFor(() => {
      expect(
        screen.queryByTestId("dashboard-sold-ahead-banner-mtc"),
      ).not.toBeInTheDocument();
    });
  });
});
