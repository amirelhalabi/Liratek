/** @jest-environment jsdom */

/**
 * LIRA-159 D2 — Dashboard "Pending Settlement" banner, fed by
 * `api.getUnsettledSummary()` (`FinancialServiceRepository.getUnsettledSummaryByProvider`).
 *
 * The core method's `UnsettledSummary` row is gaining `awaiting_settlement_count`
 * and narrowing `pending_commission_usd`/`_lbp` to LEGACY-model-only
 * (`commission_model = 0`) — 0 for a provider whose unsettled rows are all
 * post-cutover (`commission_model = 1`). Owner decision D15: a model-1 row's
 * commission is UNKNOWABLE until the operator enters it at settlement, so
 * the banner must show a COUNT ("N awaiting settlement"), never a fabricated
 * `$0.00`/`$0.0000` standing in for an unknown amount — both per-provider
 * and in the "Total pending" aggregate line (same narrowed field, same
 * defect, same fix).
 *
 * This drives the REAL `Dashboard` page. Dashboard pulls in a much larger
 * surface than the banner itself (drawer cards, checkpoints, carrier-line
 * alerts, the lazy Sales Trend chart, three modals) — none of it under test
 * here, so it's neutralised: `getSystemExpectedBalancesDynamic` resolves to
 * `{}` (drawer sections are all guarded on non-empty balances, so they don't
 * render), `isModuleEnabled` is false (hides module-gated cards/tabs),
 * `sessionManagement` is off (skips the checkpoint banner + its own IPC
 * call), and the chart/modals are stubbed out — matching the precedent
 * (Profits.pendingSettlementCount.test.tsx) of stubbing only what's
 * irrelevant to the assertion while driving the real page for everything
 * that is.
 */

import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "../Dashboard";

// LIRA-171: was jest.setTimeout(15000) with a comment attributing the cost
// to "ts-jest compiling and recharts initializing" the lazy-loaded
// DashboardChart's dynamic import — real, but removable: none of this
// file's assertions touch the trend chart (see the DashboardChart mock
// below), so it's now stubbed like the sibling
// Profits.awaitingSettlementCount.test.tsx already stubs its own chart.
// That dropped the file's heaviest test (the first — dynamic import +
// Suspense resolution happen once, subsequent tests reuse the resolved
// module) from ~700-900ms to ~140-370ms across repeated isolated runs, so
// this stays at jest's plain 5000ms default rather than carrying a bespoke
// override — the point of this ticket was removing the cost, not hiding a
// wider timeout over it.
jest.setTimeout(5000);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetUnsettledSummary = jest.fn();

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
  getMonthlyPL: jest.fn().mockResolvedValue({
    netProfitUSD: 0,
    netProfitLBP: 0,
  }),
  getDebtors: jest.fn().mockResolvedValue([]),
  getUnsettledSummary: mockGetUnsettledSummary,
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

// LIRA-171: DashboardChart IS stubbed, unlike the original LIRA-159 version
// of this file. Dashboard.tsx lazy-loads it (`lazy(() => import(...))`)
// behind a Suspense boundary for the default "trend" insight tab, so every
// render in this file pulled in recharts's full module graph through a real
// dynamic `import()`. That import — not a waitFor/retry loop, not a slow
// mock — was the entire 12s: profiled isolated runs showed the file's FIRST
// test alone spending ~700-900ms in it (vs ~60-100ms for the 2nd/3rd tests,
// which hit ts-jest's warm in-run module cache), consistent with the
// removed comment that used to sit here documenting the one-time recharts
// compile+init cost. That per-run few-hundred-ms cost is what turned into a
// 15s timeout under full-suite CPU contention. None of this file's
// assertions touch the trend chart — only the unrelated "Pending
// Settlement" banner — so stubbing it out removes real, provably-irrelevant
// weight rather than papering over a slow assertion; mirrors the sibling
// Profits.awaitingSettlementCount.test.tsx, which stubs its own chart
// (CommissionsChart) for the identical reason and was never slow.
jest.mock("../../components/DashboardChart", () => ({
  __esModule: true,
  default: () => null,
}));

// Modals — never opened in this test (isOpen defaults false / not
// triggered), stubbed to avoid pulling in their own IPC-heavy internals.
// Paths are relative to this file (pages/__tests__/), not to Dashboard.tsx
// (pages/) — one extra "../" versus Dashboard.tsx's own imports.
jest.mock("../../components/DrawerTopUpModal", () => ({
  DrawerTopUpModal: () => null,
}));
jest.mock("../../components/DrawerCashoutModal", () => ({
  DrawerCashoutModal: () => null,
}));
jest.mock("../../../closing/components/InitialDrawerAmountsModal", () => ({
  InitialDrawerAmountsModal: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderDashboard() {
  const utils = render(<Dashboard />);
  await waitFor(() =>
    expect(mockGetUnsettledSummary).toHaveBeenCalledTimes(1),
  );
  await screen.findByText(/Pending Settlement —/);
  return utils;
}

beforeEach(() => {
  // clearAllMocks() only clears call history (mock.calls/results), not
  // queued implementations, so the mockResolvedValue()s below aren't
  // strictly required after it — kept explicit so this file has no implicit
  // dependency on mock state surviving from module init across test runs.
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
  mockApi.getMonthlyPL.mockResolvedValue({ netProfitUSD: 0, netProfitLBP: 0 });
  mockApi.getDebtors.mockResolvedValue([]);
  mockApi.getAllActiveCarrierLines.mockResolvedValue([]);
  mockApi.hasInitialBalancesSet.mockResolvedValue(true);
  mockApi.holdMoney.active.mockResolvedValue({ success: true, data: [] });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dashboard — Pending Settlement banner (LIRA-159 D2)", () => {
  it("shows a COUNT, never a fabricated dollar, for a provider whose pending commission is entirely model-1", async () => {
    mockGetUnsettledSummary.mockResolvedValueOnce([
      {
        provider: "OMT",
        count: 3,
        bill_count: 0,
        pending_commission_usd: 0,
        pending_commission_lbp: 0,
        total_owed_usd: 100,
        total_owed_lbp: 0,
        awaiting_settlement_count: 3,
      },
    ]);

    await renderDashboard();

    const provider = screen.getByText(/OMT:/).closest("span");
    expect(provider?.textContent).toContain("3 awaiting settlement");
    expect(provider?.textContent).not.toMatch(/\$0\.00/);

    // Same narrowed field feeds the "Total pending" aggregate line — must
    // not fall back to a fabricated $0.0000 there either.
    expect(screen.getByText(/Total pending:/).textContent).not.toMatch(
      /\$0\.00/,
    );
    expect(screen.getByText(/Total pending:/).textContent).toContain(
      "3 awaiting settlement",
    );
  });

  it("still renders the legacy dollar figure for a model-0-only provider", async () => {
    mockGetUnsettledSummary.mockResolvedValueOnce([
      {
        provider: "WHISH",
        count: 1,
        bill_count: 0,
        pending_commission_usd: 2.5,
        pending_commission_lbp: 0,
        total_owed_usd: 50,
        total_owed_lbp: 0,
        awaiting_settlement_count: 0,
      },
    ]);

    await renderDashboard();

    const provider = screen.getByText(/WHISH:/).closest("span");
    expect(provider?.textContent).toContain("$2.5000");
    expect(provider?.textContent).not.toContain("awaiting settlement");
  });

  it("renders both the legacy dollar and the awaiting-settlement count for a mixed provider", async () => {
    mockGetUnsettledSummary.mockResolvedValueOnce([
      {
        provider: "BINANCE",
        count: 5,
        bill_count: 0,
        pending_commission_usd: 4,
        pending_commission_lbp: 0,
        total_owed_usd: 80,
        total_owed_lbp: 0,
        awaiting_settlement_count: 2,
      },
    ]);

    await renderDashboard();

    const provider = screen.getByText(/BINANCE:/).closest("span");
    expect(provider?.textContent).toContain("$4.0000");
    expect(provider?.textContent).toContain("2 awaiting settlement");
  });
});
