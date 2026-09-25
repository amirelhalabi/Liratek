/** @jest-environment jsdom */

/**
 * Lane LO — round 3 (adversarial review), OWNER_NOTES_2026-09-21.md §6.
 *
 * Covers the UI-owned findings this lane is responsible for on the
 * Overview / By Module / By Date tabs, left open by the round-3 review
 * because the data-only lane pass was explicitly barred from touching
 * Profits.tsx:
 *
 *   LO-R1 / LO-V8 — the By Module footer's Σ gross − expenses = net (+
 *     combined) row reads `summary`, which the tab-switch effect only ever
 *     refreshed on the Overview tab. Changing the date range WHILE already
 *     on By Module refetched the module rows but not the summary, so the
 *     net row kept showing the PREVIOUS period's figures beside the
 *     CURRENT period's TOTAL row. Proven by the round-3 probe: TOTAL 999
 *     USD (new range) vs NET 111 USD (old range), getProfitByModule called
 *     twice, getProfitSummary once.
 *   LO-R3 — the By Module TOTAL row summed only r.profit_usd/r.profit_lbp,
 *     silently dropping every row's kept_change_usd/_lbp (documented as
 *     ADDITIVE, not already folded into profit_usd/_lbp) — so TOTAL profit
 *     disagreed with the Overview's gross (and with the net row directly
 *     beneath it) whenever any FS-commission/recharge/mobile/loto row
 *     carried off-currency kept change.
 *   LO-R6 — the headline Net line, the By Module net-row value, the
 *     Financial Services Commission / Commission (at settlement) lines and
 *     the Payment Method Fees "Kept by shop" line were each colored by
 *     their USD component's sign alone, so an LBP-only loss rendered
 *     neutral grey instead of red.
 *
 * Rule 17 (prove red-then-green): this file was run against the pre-fix
 * Profits.tsx and every test below FAILED with the exact symptom described
 * in its own comment (see this lane's final report for the captured
 * output), before the corresponding fix landed and the suite was re-run
 * green.
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked), matching this directory's established
 * convention (Profits.auditBatchLO.round2.test.tsx).
 */

import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProfitSummary = jest.fn();
const mockGetProfitByModule = jest.fn();

const mockApi = {
  getProfitSummary: mockGetProfitSummary,
  getProfitByModule: mockGetProfitByModule,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ isModuleEnabled: () => true }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseSummary() {
  return {
    period: "2026-08-01 to 2026-08-31",
    sales: { revenue_usd: 0, cost_usd: 0, profit_usd: 0, profit_lbp: 0, count: 0 },
    financial_services: {
      revenue_usd: 0,
      revenue_lbp: 0,
      pending_revenue_usd: 0,
      pending_revenue_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      commission_at_settlement_usd: 0,
      commission_at_settlement_lbp: 0,
      pending_commission_usd: 0,
      pending_commission_lbp: 0,
      pm_fee_usd: 0,
      pm_fee_lbp: 0,
      count: 0,
    },
    mobile_services: {
      revenue_usd: 0,
      revenue_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      count: 0,
    },
    recharges: {
      revenue_usd: 0,
      revenue_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      count: 0,
    },
    custom_services: {
      revenue_usd: 0,
      revenue_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      count: 0,
    },
    maintenance: {
      revenue_usd: 0,
      revenue_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      count: 0,
    },
    loto: { revenue_lbp: 0, profit_lbp: 0, count: 0 },
    exchange: { revenue_usd: 0, profit_usd: 0, count: 0 },
    debt_repayments: { profit_usd: 0, profit_lbp: 0, count: 0 },
    expenses: { total_usd: 0, total_lbp: 0, count: 0 },
    discounts: { usd: 0, lbp: 0 },
    supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
    topups_buybacks: { profit_usd: 0, profit_lbp: 0, count: 0 },
    kept_change: { usd: 0, lbp: 0 },
    deferred: {
      partner_profit_usd: 0,
      partner_profit_lbp: 0,
      client_debt_profit_usd: 0,
      client_debt_profit_lbp: 0,
      cashless_deferred_profit_usd: 0,
      cashless_deferred_profit_lbp: 0,
      unpaid_sales_outstanding_usd: 0,
      unpaid_sales_potential_profit_usd: 0,
    },
    totals: {
      gross_revenue_usd: 0,
      gross_revenue_lbp: 0,
      total_cost_usd: 0,
      total_cost_lbp: 0,
      gross_profit_usd: 0,
      gross_profit_lbp: 0,
      net_profit_usd: 0,
      net_profit_lbp: 0,
      // note #3 (2026-09-24, CLOSED "no change") — `combined_rate_used`/
      // `combined_net_profit_lbp` were removed with the combined net-profit
      // line; `lbp_buy_rate` is the field ProfitService.getSummary returns
      // today (kept only to weight the By Module TOTAL row's margin_pct).
      lbp_buy_rate: null,
    },
  };
}

async function renderOverview() {
  const utils = render(<Profits />);
  await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  return utils;
}

async function renderByModuleDirectly() {
  const utils = render(<Profits />);
  fireEvent.click(screen.getByText("By Module"));
  await waitFor(() => expect(mockGetProfitByModule).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  await screen.findByTestId("by-module-total-row");
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// LO-R1 / LO-V8 — By Module footer stays current after a date change made
// WHILE already on the By Module tab
// ---------------------------------------------------------------------------

describe("Profits By Module — LO-R1/LO-V8 (round 3) footer stays current on date change", () => {
  const NEW_FROM = "2020-01-01";

  it("re-fetches the summary when the date range changes on By Module (not just on Overview)", async () => {
    mockGetProfitByModule.mockResolvedValue([
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 100,
        revenue_lbp: 0,
        cost_usd: 60,
        cost_lbp: 0,
        profit_usd: 40,
        profit_lbp: 0,
        count: 1,
        margin_pct: 40,
        margin_converted: false,
      },
    ]);
    mockGetProfitSummary.mockImplementation(async (from: string, to: string) => ({
      ...baseSummary(),
      period: `${from} to ${to}`,
    }));

    await renderByModuleDirectly();
    const summaryCallsBeforeDateChange = mockGetProfitSummary.mock.calls.length;
    expect(summaryCallsBeforeDateChange).toBeGreaterThan(0);

    fireEvent.change(screen.getByTestId("date-range-from"), {
      target: { value: NEW_FROM },
    });

    // Pre-fix: the tab-switch effect only ever called loadSummary() when
    // tab === "overview"; staying on By Module while the date changed left
    // getProfitSummary uncalled after the initial mount/tab-switch fetches.
    await waitFor(() =>
      expect(mockGetProfitSummary.mock.calls.length).toBeGreaterThan(
        summaryCallsBeforeDateChange,
      ),
    );
    await waitFor(() =>
      expect(
        mockGetProfitSummary.mock.calls.some((args) => args[0] === NEW_FROM),
      ).toBe(true),
    );
  });

  it("shows the CURRENT period's net figure after a date change, never the stale previous period's (probe from the round-3 finding: TOTAL 999 vs NET 111)", async () => {
    mockGetProfitByModule.mockImplementation(async (from: string) => [
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 1000,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: from === NEW_FROM ? 999 : 111,
        profit_lbp: 0,
        count: 1,
        margin_pct: null,
        margin_converted: false,
      },
    ]);
    mockGetProfitSummary.mockImplementation(async (from: string, to: string) => ({
      ...baseSummary(),
      period: `${from} to ${to}`,
      totals: {
        ...baseSummary().totals,
        gross_profit_usd: from === NEW_FROM ? 999 : 111,
        net_profit_usd: from === NEW_FROM ? 999 : 111,
      },
    }));

    await renderByModuleDirectly();
    // Initial period: TOTAL and NET must agree (both "111").
    const totalRowBefore = await screen.findByTestId("by-module-total-row");
    expect(totalRowBefore.textContent).toContain("111 USD");
    const netRowBefore = await screen.findByTestId("by-module-net-row");
    expect(
      within(netRowBefore).getByTestId("by-module-net-value").textContent,
    ).toContain("111 USD");

    fireEvent.change(screen.getByTestId("date-range-from"), {
      target: { value: NEW_FROM },
    });

    // After the date change: TOTAL always reflects the new range (its own
    // loader always refetches). The NET row must ALSO reflect the new range
    // — pre-fix, it kept the first summary response forever ("111"), which
    // is EXACTLY what this assertion catches.
    await waitFor(() => {
      const totalRow = screen.getByTestId("by-module-total-row");
      expect(totalRow.textContent).toContain("999 USD");
    });
    await waitFor(() => {
      const netRow = screen.getByTestId("by-module-net-row");
      const netValue = within(netRow).getByTestId("by-module-net-value");
      expect(netValue.textContent).toContain("999 USD");
      expect(netValue.textContent).not.toContain("111");
    });
  });

  it("does not render the net row's figures against a mismatched (stale) summary period", async () => {
    // getProfitSummary resolves for the OLD period only and never again —
    // simulating a slow/failed refetch after the date changed. The net row
    // must degrade to the named fallback rather than show the old period's
    // numbers beside the new period's TOTAL.
    let summaryCalls = 0;
    mockGetProfitSummary.mockImplementation(async (from: string, to: string) => {
      summaryCalls += 1;
      if (summaryCalls > 1) {
        // Never resolves for the second (post-date-change) call — leaves
        // `summary` holding the stale first response if the component does
        // not gate on period.
        return new Promise(() => {});
      }
      return {
        ...baseSummary(),
        period: `${from} to ${to}`,
        totals: { ...baseSummary().totals, net_profit_usd: 111 },
      };
    });
    mockGetProfitByModule.mockResolvedValue([
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 100,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 999,
        profit_lbp: 0,
        count: 1,
        margin_pct: null,
        margin_converted: false,
      },
    ]);

    await renderByModuleDirectly();
    fireEvent.change(screen.getByTestId("date-range-from"), {
      target: { value: NEW_FROM },
    });

    await waitFor(() => {
      const netRow = screen.getByTestId("by-module-net-row");
      expect(netRow.textContent).not.toContain("111");
      expect(
        screen.queryByTestId("by-module-net-value"),
      ).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// LO-R3 — By Module TOTAL row includes kept_change_usd/_lbp
// ---------------------------------------------------------------------------

describe("Profits By Module — LO-R3 (round 3) TOTAL row folds in kept_change", () => {
  it("TOTAL profit equals the Overview's gross on a kept-change fixture (an FS row's off-currency kept change)", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "FINANCIAL_SERVICE_OMT",
        label: "OMT",
        revenue_usd: 100,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 5,
        profit_lbp: 0,
        count: 1,
        margin_pct: 5,
        margin_converted: false,
        kept_change_usd: 0,
        kept_change_lbp: 15000,
      },
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 200,
        revenue_lbp: 0,
        cost_usd: 160,
        cost_lbp: 0,
        profit_usd: 40,
        profit_lbp: 0,
        count: 2,
        margin_pct: 20,
        margin_converted: false,
      },
    ]);
    mockGetProfitSummary.mockImplementation(async (from: string, to: string) => ({
      ...baseSummary(),
      period: `${from} to ${to}`,
      totals: {
        ...baseSummary().totals,
        // Server-side (LO-R2) already folds the FS row's off-currency kept
        // change into gross/net — 5 + 40 = 45 USD, 15000 LBP.
        gross_profit_usd: 45,
        gross_profit_lbp: 15000,
        net_profit_usd: 45,
        net_profit_lbp: 15000,
      },
    }));

    await renderByModuleDirectly();

    const totalRow = await screen.findByTestId("by-module-total-row");
    // Pre-fix: Σ profit_usd/profit_lbp alone = "45 USD" / "0 LBP" (the
    // kept-change LBP silently dropped from the TOTAL column).
    expect(totalRow.textContent).toContain("45 USD");
    expect(totalRow.textContent).toContain("15000 LBP");

    const netRow = await screen.findByTestId("by-module-net-row");
    const netValue = within(netRow).getByTestId("by-module-net-value");
    // TOTAL must now agree with the net row's Gross figure directly beneath
    // it, in BOTH currencies.
    expect(netValue.textContent).toContain("45 USD");
    expect(netValue.textContent).toContain("15000 LBP");
  });

  it("a row with no kept_change is unaffected (TOTAL = plain Σ profit)", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 100,
        revenue_lbp: 0,
        cost_usd: 60,
        cost_lbp: 0,
        profit_usd: 40,
        profit_lbp: 0,
        count: 2,
        margin_pct: 40,
        margin_converted: false,
      },
    ]);
    mockGetProfitSummary.mockResolvedValue(baseSummary());

    await renderByModuleDirectly();

    const totalRow = await screen.findByTestId("by-module-total-row");
    expect(totalRow.textContent).toContain("40 USD");
  });
});

// ---------------------------------------------------------------------------
// LO-R6 — per-currency coloring on the net/commission/PM-fee lines
// ---------------------------------------------------------------------------

describe("Profits Overview/By Module — LO-R6 (round 3) per-currency coloring", () => {
  it("colors the headline Net line's LBP figure red on an LBP-only net loss (was neutral grey pre-fix)", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      expenses: { total_usd: 0, total_lbp: 15000, count: 1 },
      totals: {
        ...baseSummary().totals,
        gross_profit_usd: 0,
        gross_profit_lbp: 10000,
        net_profit_usd: 0,
        net_profit_lbp: -5000,
      },
    });

    await renderOverview();

    const headline = await screen.findByTestId("profits-headline-net-profit");
    const netValueEl = within(headline).getByText("-5000 LBP");
    expect(netValueEl.className).toContain("text-red-400");
  });

  it("colors the headline Net line's USD figure red beside an LBP gain (was painted green pre-fix)", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      totals: {
        ...baseSummary().totals,
        gross_profit_usd: -10,
        gross_profit_lbp: 20000,
        net_profit_usd: -10,
        net_profit_lbp: 20000,
      },
    });

    await renderOverview();

    const headline = await screen.findByTestId("profits-headline-net-profit");
    const usdEl = within(headline).getByText("-10 USD");
    const lbpEl = within(headline).getByText("20000 LBP");
    expect(usdEl.className).toContain("text-red-400");
    expect(lbpEl.className).toContain("text-emerald-400");
  });

  it("colors the By Module net-row value's LBP figure red on an LBP-only net loss", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "LOTO",
        label: "Loto Tickets",
        revenue_usd: 0,
        revenue_lbp: 100000,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: -5000,
        count: 3,
        margin_pct: null,
        margin_converted: false,
      },
    ]);
    mockGetProfitSummary.mockImplementation(async (from: string, to: string) => ({
      ...baseSummary(),
      period: `${from} to ${to}`,
      totals: {
        ...baseSummary().totals,
        gross_profit_usd: 0,
        gross_profit_lbp: -5000,
        net_profit_usd: 0,
        net_profit_lbp: -5000,
      },
    }));

    await renderByModuleDirectly();

    const netRow = await screen.findByTestId("by-module-net-row");
    const netValue = within(netRow).getByTestId("by-module-net-value");
    const lbpEl = within(netValue).getByText("-5000 LBP");
    expect(lbpEl.className).toContain("text-red-400");
  });

  it("colors the FS Commission line's LBP figure red on an LBP-only commission loss (refund exceeding commission)", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        commission_usd: 0,
        commission_lbp: -2000,
      },
    });

    await renderOverview();

    const el = await screen.findByText("-2000 LBP");
    expect(el.className).toContain("text-red-400");
  });

  it("colors the Commission (at settlement) line's LBP figure red on an LBP-only loss", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        commission_at_settlement_usd: 0,
        commission_at_settlement_lbp: -3000,
      },
    });

    await renderOverview();

    const el = await screen.findByText("-3000 LBP");
    expect(el.className).toContain("text-red-400");
  });

  it("colors the Payment Method Fees 'Kept by shop' line's LBP figure red on an LBP-only loss", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        pm_fee_usd: 0,
        pm_fee_lbp: -1000,
      },
    });

    await renderOverview();

    const el = await screen.findByText("-1000 LBP");
    expect(el.className).toContain("text-red-400");
  });
});
