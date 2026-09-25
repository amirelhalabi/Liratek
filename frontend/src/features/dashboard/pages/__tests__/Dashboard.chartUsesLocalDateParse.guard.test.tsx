/** @jest-environment jsdom */

/**
 * Dashboard — DC-8 integration guard (OWNER_NOTES_2026-09-21.md §7.1,
 * round-1 review finding DC8-GUARD).
 *
 * `Dashboard.chartDateAndAxisHelpers.test.tsx` proves `parseLocalDateOnly`
 * is correct IN ISOLATION — but per rule 17 that alone proves nothing about
 * `loadData` itself: reverting `loadData` to the pre-fix
 * `new Date(d.date).toLocaleDateString(...)` would still pass every
 * assertion in that file, since it never renders the page or calls
 * `loadData` at all. This test drives the REAL `Dashboard` page (same
 * harness as `Dashboard.widgetLoadErrors.test.tsx`) and proves `loadData`
 * actually ROUTES each chart row's date string through `parseLocalDateOnly`
 * — not a bare `new Date(str)` parse.
 *
 * Deliberately NOT timezone-dependent: `process.env.TZ` inside a single
 * Jest worker process is unreliable to flip per-file (V8/ICU may have
 * already cached the local timezone from an earlier test file sharing the
 * same worker), so instead of asserting a rendered label that only differs
 * from the buggy code in a west-of-UTC runtime (silently passing on a
 * UTC-default CI runner either way), this spies on the real
 * `parseLocalDateOnly` export and asserts `loadData` called it with the
 * exact `"2026-09-10"` string from the mocked chart response. That
 * assertion is deterministic in EVERY timezone and FAILS outright — the
 * spy is simply never called — if `loadData` goes back to
 * `new Date(d.date)`, which is exactly what rule 17 requires of a guard.
 * The rendered-label assertion below is kept as a secondary, non-load-
 * bearing sanity check (both the fixed and — in a UTC runtime — the buggy
 * code would render "Sep 10" for this fixture; the spy assertion above it
 * is what actually proves the fix).
 */

jest.mock("../../utils/chartFormat", () => {
  const actual = jest.requireActual("../../utils/chartFormat");
  return {
    ...actual,
    parseLocalDateOnly: jest.fn(actual.parseLocalDateOnly),
  };
});

import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "../Dashboard";
import { parseLocalDateOnly } from "../../utils/chartFormat";

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
  getProfitSalesChart: jest
    .fn()
    .mockResolvedValue([{ date: "2026-09-10", usd: 100, lbp: 0 }]),
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

// The one thing this test needs from the real chart component: the exact
// `date` strings inside the `chartData` array `loadData` computed — a
// stand-in that surfaces them as text, without needing recharts /
// ResponsiveContainer to lay out real SVG under jsdom (they don't).
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
  mockApi.getProfitSalesChart.mockResolvedValue([
    { date: "2026-09-10", usd: 100, lbp: 0 },
  ]);
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

describe("Dashboard — loadData parses chart dates as LOCAL, not UTC (DC-8 guard)", () => {
  it("routes each chart row's date string through parseLocalDateOnly (not a raw `new Date(str)` parse)", async () => {
    render(<Dashboard />);

    await screen.findByTestId("chart-dates");

    // Load-bearing assertion (rule 17): fails outright — the spy is simply
    // never called — if `loadData` regresses to `new Date(d.date)`.
    //
    // DC8-GUARD-timing (round-1 review finding): `findByTestId` above only
    // resolves on the chart's FIRST mount, which happens with the initial
    // EMPTY `chartData` — `loadData` itself is scheduled via `setTimeout`
    // in a `useEffect` and hasn't necessarily run yet, so asserting the spy
    // immediately after `findByTestId` races `loadData`. Wrap in `waitFor`
    // so the assertion retries until `loadData` has actually called
    // `parseLocalDateOnly`, instead of depending on module-mount ordering
    // that happened to make this pass as test 1 in a file (a fresh lazy
    // `DashboardChart` module import) but not as test 2 (cached module,
    // mounts synchronously before the timeout fires).
    await waitFor(() =>
      expect(parseLocalDateOnly).toHaveBeenCalledWith("2026-09-10"),
    );
  });

  it('renders "Sep 10" for a chart row dated 2026-09-10 (secondary sanity check)', async () => {
    render(<Dashboard />);

    // Same DC8-GUARD-timing fix as above: wait for the label itself to
    // reflect the loaded (not initial-empty) chartData rather than
    // asserting right after the testid's first appearance.
    await waitFor(async () => {
      const el = await screen.findByTestId("chart-dates");
      expect(el.textContent).toBe("Sep 10");
    });
  });
});
