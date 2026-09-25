/** @jest-environment jsdom */

/**
 * Dashboard — DC-7 (OWNER_NOTES_2026-09-21.md §7.1).
 *
 * Pre-fix, `loadData` awaited all 8 widget calls through a single
 * `Promise.all`, wrapped in ONE try/catch that silently swallowed any
 * rejection. `Promise.all` REJECTS THE WHOLE BATCH the instant any ONE of
 * its 8 promises rejects, so a single failing request (a timeout, a 500, a
 * dropped connection) meant every OTHER widget's `setState` call — for
 * requests that had already SUCCEEDED — never ran either. Every tile froze
 * at 0 (first load) or its last value (a poll), with no visible sign
 * anything had gone wrong.
 *
 * This drives the REAL `Dashboard` page (not a reimplementation of
 * `loadData`), following the precedent in
 * `Dashboard.awaitingSettlementCount.test.tsx`: stub what's irrelevant to
 * the assertion (chart/modals/router/contexts), drive the real page for
 * everything that is. `useApi()` is mocked with a STABLE module-scope
 * object (rule 25) — a fresh object literal per call would give
 * `loadData`'s `apiRef` a churning identity every render.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Dashboard from "../Dashboard";

jest.setTimeout(8000);

// ---------------------------------------------------------------------------
// Mocks — same shape/values as Dashboard.awaitingSettlementCount.test.tsx,
// except getDebtSummary rejects in the "one widget fails" test below.
// ---------------------------------------------------------------------------

const DISTINGUISHING_SALES_USD = 4321;

const mockApi = {
  getDashboardStats: jest.fn(),
  getProfitSalesChart: jest.fn().mockResolvedValue([]),
  getTodaysSales: jest.fn().mockResolvedValue([]),
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({}),
  getDebtSummary: jest.fn(),
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

describe("Dashboard — one widget failing does not blank the rest (DC-7)", () => {
  it("still renders a DIFFERENT widget's data when getDebtSummary rejects", async () => {
    mockApi.getDebtSummary.mockRejectedValue(new Error("network down"));

    render(<Dashboard />);

    // The stats widget's OWN request succeeded — its value must render
    // despite the debt-summary widget failing. Pre-fix (Promise.all), this
    // assertion fails: the whole batch rejects and the outer catch
    // swallows it before this setState ever runs.
    await screen.findByText(`${DISTINGUISHING_SALES_USD} USD`);
  });

  it("surfaces the failed widget by name via the PageAlerts pill", async () => {
    mockApi.getDebtSummary.mockRejectedValue(new Error("network down"));

    render(<Dashboard />);
    await screen.findByText(`${DISTINGUISHING_SALES_USD} USD`);

    await waitFor(() =>
      expect(screen.getByTestId("page-alerts-trigger")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("page-alerts-trigger"));
    const row = await screen.findByTestId("page-alerts-row-widget-load-errors");
    expect(row.textContent).toContain("1 dashboard widget failed to load");
    expect(row.textContent).toContain("Debt summary");
  });

  it("shows no widget-load-error alert when every widget succeeds (control)", async () => {
    mockApi.getDebtSummary.mockResolvedValue({
      totalDebt: 0,
      totalDebtUsd: 0,
      totalDebtLbp: 0,
      topDebtors: [],
    });

    render(<Dashboard />);
    await screen.findByText(`${DISTINGUISHING_SALES_USD} USD`);

    // No PageAlerts trigger at all — every other alert condition in this
    // fixture is false (initialBalancesSet=true, checkpoints off, no
    // carrier lines), so an appearing trigger could only be the
    // widget-load-errors item.
    expect(screen.queryByTestId("page-alerts-trigger")).not.toBeInTheDocument();
  });
});
