/** @jest-environment jsdom */

/**
 * Lane LO — round 2 (adversarial review), OWNER_NOTES_2026-09-21.md §6.
 *
 * Covers the UI-owned findings from the round-2 review that this lane is
 * responsible for on the Overview / By Module / By Date tabs:
 *
 *   LO-V1  — Kept Change card renders sales.profit_lbp and the new
 *            kept_change.usd/_lbp roll-up (previously computed server-side,
 *            never rendered anywhere); By Module's expandable detail surfaces
 *            a row's own off-currency kept change.
 *   LO-V4  — By Module footer gains a Σ gross − expenses = net (+ combined)
 *            line, sourced from getProfitSummary.
 *   LO-V8  — that line is correct even when the By Module tab is opened
 *            WITHOUT visiting Overview first. NOTE: the review's stated
 *            premise ("summary is fetched only on the Overview tab") did
 *            NOT hold against the actual code — `tab` defaults to
 *            "overview" (Profits.tsx's own `useState`), so the tab-switch
 *            effect already calls loadSummary() unconditionally on mount,
 *            before any click. Verified empirically (rule 28): adding a
 *            second loadSummary() call to the by-module branch made
 *            getProfitSummary fire TWICE for one page visit instead of
 *            once, proving the data was already present after the first.
 *            That extra call was reverted; the footer's own defensive
 *            fallback (a named "—"/error state, never a crash or a stale
 *            cross-tab figure) is the actual fix kept.
 *   LO-V9  — Mobile/Custom/Recharges/Maintenance profit lines, the headline
 *            equation and the Expenses Deducted card each color/hide by
 *            THEIR OWN currency's sign/zero-ness, not by whichever currency
 *            happened to be nonzero.
 *   LO-V11 — the By Module expandable row no longer renders a keyless
 *            Fragment (no React "unique key" console warning).
 *
 * Rule 17 (prove red-then-green): for LO-V9 (Mobile Services coloring),
 * LO-V1 (Kept Change card gate), LO-V4/LO-V8 (footer net row) and LO-V11
 * (Fragment key), the fix was reverted in place with Edit, the
 * corresponding test(s) here were run and observed to FAIL with the exact
 * pre-fix symptom (a single combined-string element instead of two colored
 * ones; the card/row simply absent; a real React "unique key" console
 * warning), then the fix was restored and the suite re-run green. Not
 * individually re-proven for every other assertion in this file (bundled
 * verification via the full-suite run instead) — see this lane's final
 * report for the exact revert points.
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked), matching this directory's established
 * convention.
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
  // LO-V8 regression guard: click straight into By Module WITHOUT ever
  // viewing the Overview tab's own render.
  //
  // Round 3 (LO-R1/LO-V8) update: getProfitSummary now fires TWICE for a
  // single page visit that switches to By Module — once from the
  // mount-time effect (`tab` defaults to "overview") and once more from
  // the by-module branch itself, which round 3 added specifically so the
  // footer's net row also refreshes when the DATE RANGE changes while
  // already on By Module (it used to fire only once, which is what this
  // comment described pre-round-3 — see
  // Profits.auditBatchLO.round3.test.tsx for the regression that closes).
  const utils = render(<Profits />);
  fireEvent.click(screen.getByText("By Module"));
  await waitFor(() => expect(mockGetProfitByModule).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalledTimes(2));
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
// LO-V9 — per-currency coloring, Mobile/Custom/Recharges/Maintenance
// ---------------------------------------------------------------------------

describe("Profits Overview — LO-V9 per-currency profit coloring", () => {
  it("colors a Mobile Services USD loss red even when LBP is a gain (was green pre-fix)", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      mobile_services: {
        revenue_usd: 10,
        revenue_lbp: 50000,
        cost_usd: 15,
        cost_lbp: 0,
        profit_usd: -5,
        profit_lbp: 20000,
        count: 2,
      },
    });

    await renderOverview();

    // Pre-fix: a single span colored the WHOLE "-5 USD + 20000 LBP" string
    // by profit_lbp's sign (20000 > 0 → emerald), painting the USD loss
    // green. Each currency must now be its own colored element.
    const usdEl = await screen.findByText("-5 USD");
    const lbpEl = await screen.findByText("20000 LBP");
    expect(usdEl.className).toContain("text-red-400");
    expect(lbpEl.className).toContain("text-emerald-400");
  });

  it("colors a Custom Services LBP loss red even when USD is a gain", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      custom_services: {
        revenue_usd: 20,
        revenue_lbp: 10000,
        cost_usd: 5,
        cost_lbp: 30000,
        profit_usd: 15,
        profit_lbp: -20000,
        count: 1,
      },
    });

    await renderOverview();

    const usdEl = await screen.findByText("15 USD");
    const lbpEl = await screen.findByText("-20000 LBP");
    expect(usdEl.className).toContain("text-emerald-400");
    expect(lbpEl.className).toContain("text-red-400");
  });

  it("colors a Recharges LBP loss red even when USD is a gain", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      recharges: {
        revenue_usd: 20,
        revenue_lbp: 10000,
        cost_usd: 5,
        cost_lbp: 30000,
        profit_usd: 15,
        profit_lbp: -20000,
        count: 1,
      },
    });

    await renderOverview();

    const usdEl = await screen.findByText("15 USD");
    const lbpEl = await screen.findByText("-20000 LBP");
    expect(usdEl.className).toContain("text-emerald-400");
    expect(lbpEl.className).toContain("text-red-400");
  });

  it("colors a Maintenance LBP loss red even when USD is a gain", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      maintenance: {
        revenue_usd: 20,
        revenue_lbp: 10000,
        cost_usd: 5,
        cost_lbp: 30000,
        profit_usd: 15,
        profit_lbp: -20000,
        count: 1,
      },
    });

    await renderOverview();

    const usdEl = await screen.findByText("15 USD");
    const lbpEl = await screen.findByText("-20000 LBP");
    expect(usdEl.className).toContain("text-emerald-400");
    expect(lbpEl.className).toContain("text-red-400");
  });
});

describe("Profits Overview — LO-V9 headline/expenses zero-hiding", () => {
  it("the headline Gross/Expenses lines never print a fabricated 0 USD in an LBP-only period", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      expenses: { total_usd: 0, total_lbp: 10000, count: 1 },
      totals: {
        ...baseSummary().totals,
        gross_profit_usd: 0,
        gross_profit_lbp: 90000,
        net_profit_usd: 0,
        net_profit_lbp: 80000,
      },
    });

    await renderOverview();

    const headline = await screen.findByTestId("profits-headline-net-profit");
    // Pre-fix: unconditional formatAmount(gross_profit_usd, "USD") (and the
    // same for expenses/net) printed a fabricated "0 USD" as the FIRST
    // token of the equation regardless of currency, even though nothing
    // happened in USD at all this period.
    expect(headline.textContent).not.toContain("0 USD");
    expect(headline.textContent).toContain("90000 LBP");
    expect(headline.textContent).toContain("10000 LBP");
    expect(headline.textContent).toContain("80000 LBP");
  });

  it("Expenses Deducted hides the USD column in an LBP-only period (was a fabricated 'USD: -$0.00')", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      expenses: { total_usd: 0, total_lbp: 45000, count: 3 },
    });

    await renderOverview();

    const card = screen.getByText("Expenses Deducted").closest("div")!
      .parentElement!;
    expect(within(card).queryByText("0 USD")).not.toBeInTheDocument();
    expect(within(card).getByText("-45000 LBP")).toBeInTheDocument();
  });

  it("Expenses Deducted still shows USD: -$0.00 for a genuinely all-zero period", async () => {
    mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

    await renderOverview();

    const card = screen.getByText("Expenses Deducted").closest("div")!
      .parentElement!;
    expect(within(card).getByText("-0 USD")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// LO-V1 — Kept Change card
// ---------------------------------------------------------------------------

describe("Profits Overview — LO-V1 Kept Change card", () => {
  it("renders a sale's own LBP kept change, previously computed and never shown", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      sales: { revenue_usd: 100, cost_usd: 80, profit_usd: 20, profit_lbp: 45000, count: 1 },
    });

    await renderOverview();

    const line = await screen.findByTestId("kept-change-sales-lbp");
    expect(line.textContent).toContain("45000 LBP");
  });

  it("renders the recharge/mobile/loto off-currency kept-change roll-up", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      kept_change: { usd: 1, lbp: 45000 },
    });

    await renderOverview();

    const usdLine = await screen.findByTestId("kept-change-other-usd");
    const lbpLine = await screen.findByTestId("kept-change-other-lbp");
    expect(usdLine.textContent).toContain("1 USD");
    expect(lbpLine.textContent).toContain("45000 LBP");
  });

  it("opens the card for a sale-kept-change-only period, even with zero debt-repayment kept change", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      sales: { revenue_usd: 100, cost_usd: 80, profit_usd: 20, profit_lbp: 45000, count: 1 },
    });

    await renderOverview();

    // Pre-fix: the card's gate checked ONLY debt_repayments — a period
    // with a sale's kept change but zero debt-repayment kept change had
    // nowhere to render the card at all.
    expect(
      await screen.findByTestId("overview-kept-change-card"),
    ).toBeInTheDocument();
  });

  it("stays absent for a genuinely empty period", async () => {
    mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

    await renderOverview();

    expect(
      screen.queryByTestId("overview-kept-change-card"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// LO-V4 / LO-V8 — By Module footer net row
// ---------------------------------------------------------------------------

describe("Profits By Module — LO-V4/LO-V8 footer net row", () => {
  it("shows Σ gross − expenses = net from the mount-time summary fetch, with no Overview render needed", async () => {
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
    // Round 3 (LO-R1/LO-V8): getProfitSummary now fires twice for this
    // render (mount + by-module switch, see renderByModuleDirectly's own
    // comment) — `mockImplementation` (not `mockResolvedValueOnce`) so both
    // calls resolve, and `period` is derived from the actual args so the
    // footer's period-match gate (round 3) accepts it.
    mockGetProfitSummary.mockImplementation(async (from: string, to: string) => ({
      ...baseSummary(),
      period: `${from} to ${to}`,
      expenses: { total_usd: 8, total_lbp: 0, count: 1 },
      totals: {
        ...baseSummary().totals,
        gross_profit_usd: 40,
        net_profit_usd: 32,
        // note #3 (2026-09-24, CLOSED "no change") — an LBP rate is
        // configured here on purpose: the assertion below proves the
        // removed combined figure stays absent even when a rate EXISTS
        // (the exact inputs that used to render "2848000 LBP combined"),
        // not merely when there is nothing to show.
        lbp_buy_rate: 89000,
        // round-1 fix-round finding round2-absence-guard-vacuous — also
        // stamp the legacy fields themselves (a pre-removal backend/cache
        // response would still send them). Without these, a regressed UI
        // that started reading `combined_rate_used`/`combined_net_profit_lbp`
        // again would render nothing here (the fixture never supplied them
        // either), and this guard would stay green for the wrong reason.
        combined_rate_used: 89000,
        combined_net_profit_lbp: 2848000,
      },
    }));

    await renderByModuleDirectly();

    const netRow = await screen.findByTestId("by-module-net-row");
    expect(netRow.textContent).toContain("(Gross)");
    expect(netRow.textContent).toContain("40 USD");
    expect(netRow.textContent).toContain("(Expenses)");
    expect(netRow.textContent).toContain("8 USD");
    expect(netRow.textContent).toContain("(Net)");
    const netValue = within(netRow).getByTestId("by-module-net-value");
    expect(netValue.textContent).toContain("32 USD");
    // note #3 — the "≈ X LBP combined (at buy rate N)" figure that used to
    // sit here is REMOVED; per rule 24 this guards its absence instead of
    // deleting the test.
    expect(
      within(netRow).queryByTestId("by-module-net-combined"),
    ).not.toBeInTheDocument();
    expect(netRow.textContent).not.toMatch(/combined/i);
  });

  it("shows a named fallback instead of a stale/fabricated total when the summary fetch fails", async () => {
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
    // Round 3: every getProfitSummary call rejects (not just the first),
    // since renderByModuleDirectly now triggers two calls (mount +
    // by-module switch) and the failure must persist across both to prove
    // a genuinely down summary endpoint, not a lucky second call.
    mockGetProfitSummary.mockRejectedValue(new Error("summary down"));

    await renderByModuleDirectly();

    const netRow = await screen.findByTestId("by-module-net-row");
    expect(netRow.textContent).toContain("summary down");
    expect(netRow.textContent).not.toContain("(Net)");
  });
});

// ---------------------------------------------------------------------------
// LO-V1 (By Module) — off-currency kept change in the expandable detail
// ---------------------------------------------------------------------------

describe("Profits By Module — LO-V1 off-currency kept change detail", () => {
  it("shows the kept-change line for an FS-provider row when expanded", async () => {
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
        count: 3,
        margin_pct: 5,
        margin_converted: false,
        kept_change_usd: 0,
        kept_change_lbp: 45000,
      },
    ]);
    mockGetProfitSummary.mockResolvedValue(baseSummary());

    await renderByModuleDirectly();

    expect(
      screen.queryByTestId("by-module-kept-change-FINANCIAL_SERVICE_OMT"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("by-module-expand-FINANCIAL_SERVICE_OMT"));

    const line = await screen.findByTestId(
      "by-module-kept-change-FINANCIAL_SERVICE_OMT",
    );
    expect(line.textContent).toContain("45000 LBP");
  });

  it("omits the kept-change line entirely when a row carries none", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "RECHARGE",
        label: "Mobile Recharges",
        revenue_usd: 100,
        revenue_lbp: 0,
        cost_usd: 80,
        cost_lbp: 0,
        profit_usd: 20,
        profit_lbp: 0,
        count: 4,
        margin_pct: 20,
        margin_converted: false,
      },
    ]);
    mockGetProfitSummary.mockResolvedValue(baseSummary());

    await renderByModuleDirectly();
    fireEvent.click(screen.getByTestId("by-module-expand-RECHARGE"));

    await screen.findByTestId("by-module-detail-RECHARGE");
    expect(
      screen.queryByTestId("by-module-kept-change-RECHARGE"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// LO-V11 — no React key warning on the By Module expandable row
// ---------------------------------------------------------------------------

describe("Profits By Module — LO-V11 Fragment key", () => {
  it("renders multiple rows with no 'unique key' console warning", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
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
      {
        module: "LOTO",
        label: "Loto Tickets",
        revenue_usd: 0,
        revenue_lbp: 200000,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 20000,
        count: 3,
        margin_pct: 10,
        margin_converted: false,
      },
    ]);
    mockGetProfitSummary.mockResolvedValue(baseSummary());

    await renderByModuleDirectly();

    const keyWarning = errorSpy.mock.calls.some((args) =>
      String(args[0]).includes("unique") && String(args[0]).includes("key"),
    );
    expect(keyWarning).toBe(false);

    errorSpy.mockRestore();
  });
});
