/** @jest-environment jsdom */

/**
 * Dashboard — DC-11 (OWNER_NOTES_2026-09-21.md §7.2, CHART-M1 verifier finding).
 *
 * The "Net Profit — Last 30 Days" tile must read `getNetProfitLast30Days()`,
 * NOT the old calendar-month `getMonthlyPL(localMonth())`. Both functions
 * returned the same field names (`netProfitUSD`/`netProfitLBP`), so a revert
 * back to `getMonthlyPL` type-checked silently and was otherwise invisible —
 * only a value-level assertion caught it (rule 17).
 *
 * Proven against the pre-fix code (rule 17): temporarily reverted
 * Dashboard.tsx's loadData call from
 * `apiRef.current.getNetProfitLast30Days()` to
 * `apiRef.current.getMonthlyPL("2026-09")`, reran this file, and both
 * tests went RED — `waitFor` timed out because the tile never showed the
 * 24681 USD / 975300000 LBP fixture values (getMonthlyPL's 111/222 don't
 * match the "Net Profit — Last 30 Days" formatting path either, since the
 * mock resolves before the card re-renders with them), and
 * `getNetProfitLast30Days` was called 0 times instead of 1. Reverted back
 * immediately after observing the failure; both tests are green again.
 *
 * DAY-2 (rule 24): `FinancialRepository.getMonthlyPL` — and every
 * `getMonthlyPL` binding across the stack (IPC channel, REST route,
 * `backendApi.ts`, `ElectronApiAdapter`, the `ApiAdapter` type) — was
 * deleted as dead code once DC-11 moved the tile off it and grep confirmed
 * no live caller (OWNER_NOTES_2026-09-21.md:1051). A call to
 * `api.getMonthlyPL(...)` from Dashboard.tsx would now fail to TYPECHECK,
 * since `ApiAdapter` no longer declares the method — a stronger guard than
 * the old runtime assertion below could ever be. `mockApi` here is a plain
 * object literal (not typed against `ApiAdapter`), so the "poison" mock is
 * kept as a belt-and-suspenders runtime guard rather than deleted outright:
 * it still catches anyone re-introducing an untyped/`as any` call.
 */

import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "../Dashboard";

jest.setTimeout(8000);

// Distinctive values that do NOT collide with any other fixture's default
// (0), so a wrong source is unambiguous either way.
const NET_PROFIT_30D_USD = 24681;
const NET_PROFIT_30D_LBP = 975300000;
// A DIFFERENT value from a DIFFERENT function — if the tile ever read this
// instead, the assertion on the distinctive 30-day figures fails.
const MONTHLY_PL_USD = 111;
const MONTHLY_PL_LBP = 222;

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
  // The OLD source the tile must NOT read any more (DC-11). The real
  // `getMonthlyPL` was deleted from the codebase entirely (DAY-2) — this
  // mock property exists ONLY so `expect(mockApi.getMonthlyPL)
  // .not.toHaveBeenCalled()` below has something to assert against; nothing
  // production-side can reach it any more (ApiAdapter has no such method).
  getMonthlyPL: jest.fn().mockResolvedValue({
    netProfitUSD: MONTHLY_PL_USD,
    netProfitLBP: MONTHLY_PL_LBP,
  }),
  // The NEW source the tile must read.
  getNetProfitLast30Days: jest.fn().mockResolvedValue({
    netProfitUSD: NET_PROFIT_30D_USD,
    netProfitLBP: NET_PROFIT_30D_LBP,
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
    totalSalesUSD: 0,
    totalSalesLBP: 0,
    cashCollectedUSD: 0,
    cashCollectedLBP: 0,
    ordersCount: 0,
    activeClients: 0,
  });
  mockApi.getProfitSalesChart.mockResolvedValue([]);
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
  mockApi.getMonthlyPL.mockResolvedValue({
    netProfitUSD: MONTHLY_PL_USD,
    netProfitLBP: MONTHLY_PL_LBP,
  });
  mockApi.getNetProfitLast30Days.mockResolvedValue({
    netProfitUSD: NET_PROFIT_30D_USD,
    netProfitLBP: NET_PROFIT_30D_LBP,
    fromDate: "2026-08-26",
    toDate: "2026-09-24",
  });
  mockApi.getDebtors.mockResolvedValue([]);
  mockApi.getUnsettledSummary.mockResolvedValue([]);
  mockApi.getAllActiveCarrierLines.mockResolvedValue([]);
  mockApi.hasInitialBalancesSet.mockResolvedValue(true);
  mockApi.holdMoney.active.mockResolvedValue({ success: true, data: [] });
});

describe("Dashboard — Net Profit tile reads getNetProfitLast30Days, not getMonthlyPL (DC-11, CHART-M1)", () => {
  it("shows the getNetProfitLast30Days values under the 'Net Profit — Last 30 Days' label", async () => {
    render(<Dashboard />);

    const label = await screen.findByText("Net Profit — Last 30 Days");
    const card = label.closest("div.relative.bg-slate-800");
    expect(card).not.toBeNull();

    // Wait for the async setStats from loadData to land — the label above
    // is static and renders before the fetched value does.
    await waitFor(() =>
      expect(card!.textContent).toContain(`${NET_PROFIT_30D_USD} USD`),
    );
    expect(card!.textContent).toContain(`${NET_PROFIT_30D_LBP} LBP`);
    // The old monthly-PL fixture values must NOT appear anywhere in the tile.
    expect(card!.textContent).not.toContain(`${MONTHLY_PL_USD} USD`);
    expect(card!.textContent).not.toContain(`${MONTHLY_PL_LBP} LBP`);
  });

  it("never calls getMonthlyPL — the tile's only source is getNetProfitLast30Days", async () => {
    render(<Dashboard />);

    await screen.findByText("Net Profit — Last 30 Days");
    expect(mockApi.getNetProfitLast30Days).toHaveBeenCalledTimes(1);
    expect(mockApi.getMonthlyPL).not.toHaveBeenCalled();
  });
});
