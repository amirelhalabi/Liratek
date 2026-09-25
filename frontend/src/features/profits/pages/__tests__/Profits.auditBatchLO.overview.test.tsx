/** @jest-environment jsdom */

/**
 * Lane LO — OWNER_NOTES_2026-09-21.md §6 audit batches 2–4, Overview tab.
 *
 * Covers the items this lane's UI half owns on the Overview tab:
 *   PA-2.3 (Top-ups/Buybacks card), PA-2.4 (FS "Commission (at settlement)"),
 *   PA-3.10 (Supplier Commission fully-deferred gate — see the dedicated
 *   suite in Profits.deferredSettlementCommission.test.tsx for the RED/GREEN
 *   proof; this file adds the card-rendering half), PA-3.11 (unpaid sales
 *   line), PA-3.6 (pending revenue line), PA-4.5 (sign-colored profit —
 *   profitClass), PA-4.6 (Kept Change negatives visible), PA-4.7 (LBP-only
 *   period never shows a bare "$0.00" headline), PA-4.8 (Turnover rename +
 *   equal-weight currencies), PA-4.9 (Payment Method Fees own card),
 *   PA-4.21/PA-4.22 (headline Total Net Profit; the combined "≈ X LBP" line
 *   PA-4.21 originally specified was CLOSED "no change" by the owner on
 *   2026-09-24 — note #3 — so this file now guards its absence instead).
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked), matching this directory's established
 * convention (Profits.deferredSettlementCommission.test.tsx).
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProfitSummary = jest.fn();

const mockApi = {
  getProfitSummary: mockGetProfitSummary,
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
// Fixture
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

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// PA-2.3 — Top-ups / Buybacks card
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-2.3 Top-ups/Buybacks card", () => {
  it("renders a signed profit-only card when nonzero", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      topups_buybacks: { profit_usd: 3.5, profit_lbp: -1000, count: 2 },
    });

    await renderOverview();

    const card = await screen.findByTestId("overview-topups-buybacks-card");
    expect(card.textContent).toContain("Top-ups / Buybacks");
    expect(card.textContent).toContain("2 txns");
    expect(card.textContent).toContain("3.5 USD");
    expect(card.textContent).toContain("-1000 LBP");
  });

  it("is absent for a genuinely empty period (pre-fix: this data didn't exist at all)", async () => {
    mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

    await renderOverview();

    expect(
      screen.queryByTestId("overview-topups-buybacks-card"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PA-2.4 — Financial Services "Commission (at settlement)"
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-2.4 Commission (at settlement)", () => {
  it("shows the cashless settlement commission share on the FS card", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        commission_at_settlement_usd: 4.2,
        commission_at_settlement_lbp: 0,
      },
    });

    await renderOverview();

    expect(screen.getByText("Commission (at settlement)")).toBeInTheDocument();
    expect(screen.getByText("4.2 USD")).toBeInTheDocument();
  });

  it("omits the line when there is no cashless settlement commission", async () => {
    mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

    await renderOverview();

    expect(
      screen.queryByText("Commission (at settlement)"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PA-3.11 — Unpaid sales line on the Deferred card
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-3.11 unpaid sales line", () => {
  it("opens the Deferred card and shows the line for an unpaid-sales-only period", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      deferred: {
        ...baseSummary().deferred,
        unpaid_sales_outstanding_usd: 50,
        unpaid_sales_potential_profit_usd: 8,
      },
    });

    await renderOverview();

    // Pre-fix: the Deferred card's gate never opened for an unpaid-sales-only
    // period (it only checked partner/client_debt fields), so this line had
    // nowhere to render at all.
    const line = await screen.findByTestId("deferred-unpaid-sales");
    expect(line.textContent).toContain("Unpaid sales (not counted)");
    expect(line.textContent).toContain("50 USD");
    expect(line.textContent).toContain("8 USD");
    // LO-V14 (open_LO.txt) — this figure comes from the LP-owned,
    // date-independent getPendingSaleProfit(): the all-time outstanding
    // total, not scoped to the date range picked above. Without this
    // caption the line reads as period-specific when it is not. NOT RUN
    // tonight — red/green proof pending (tomorrow).
    const caption = within(line).getByTestId("deferred-unpaid-sales-caption");
    expect(caption.textContent).toMatch(/as of now, all dates/i);
  });

  it("does not open the Deferred card when unpaid sales are zero and nothing else deferred", async () => {
    mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

    await renderOverview();

    expect(
      screen.queryByTestId("profits-deferred-card"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PA-3.6 — pending revenue line on the FS card
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-3.6 pending revenue", () => {
  it("shows pending revenue separately from pending commission", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        pending_revenue_usd: 105,
        pending_revenue_lbp: 0,
      },
    });

    await renderOverview();

    const line = await screen.findByTestId("overview-finsvc-pending-revenue");
    expect(line.textContent).toContain("105 USD");
    expect(line.textContent).toContain("pending revenue");
  });
});

// ---------------------------------------------------------------------------
// PA-4.5 — sign-colored profit (profitClass)
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-4.5 loss visibility", () => {
  it("renders a Sales loss in red, not the hard-coded emerald", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      sales: { revenue_usd: 10, cost_usd: 15, profit_usd: -5, profit_lbp: 0, count: 1 },
    });

    await renderOverview();

    const el = await screen.findByText("-5 USD");
    // Pre-fix this span was hard-coded `text-emerald-400` regardless of sign.
    expect(el.className).toContain("text-red-400");
    expect(el.className).not.toContain("text-emerald-400");
  });

  it("renders a Kept Change loss (net reversal) in red and visible", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      debt_repayments: { profit_usd: -3, profit_lbp: 0, count: 1 },
    });

    await renderOverview();

    // Pre-fix: the `profit_usd > 0` guard hid this line entirely — a
    // negative net (reversal outweighing gains) rendered NOTHING.
    const el = await screen.findByText("-3 USD");
    expect(el.className).toContain("text-red-400");
  });
});

// ---------------------------------------------------------------------------
// PA-4.7 — LBP-only period never shows a bare "$0.00" headline
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-4.7 LBP-only headline", () => {
  it("Total Expenses shows the LBP figure, not $0.00, in an LBP-only period", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      expenses: { total_usd: 0, total_lbp: 90000, count: 1 },
    });

    await renderOverview();

    // Pre-fix the headline value was unconditionally formatAmount(total_usd,
    // "USD") = "0 USD", with the LBP figure demoted to a barely-visible
    // sub-line only when > 0. Scoped to the Total Expenses card specifically
    // — several OTHER cards legitimately show "0 USD" in this all-zero-USD
    // fixture (e.g. Net Profit (USD)), so a page-wide query would be
    // ambiguous.
    const card = screen.getByText("Total Expenses").closest("div")!
      .parentElement!;
    expect(within(card).queryByText("0 USD")).not.toBeInTheDocument();
    expect(within(card).getByText("90000 LBP")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PA-4.8 — Turnover rename + equal-weight currencies
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-4.8 Turnover", () => {
  it("renamed the label and shows both currencies in one run when both are nonzero", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      totals: {
        ...baseSummary().totals,
        gross_revenue_usd: 100,
        gross_revenue_lbp: 50000,
      },
    });

    await renderOverview();

    expect(
      screen.getByText("Turnover (incl. transfers & exchange)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Total Revenue")).not.toBeInTheDocument();
    expect(screen.getByText("100 USD + 50000 LBP")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PA-4.9 — Payment Method Fees own card
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-4.9 Payment Method Fees own card", () => {
  it("renders fees as their own card, not folded into Financial Services", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        pm_fee_usd: 2.5,
        pm_fee_lbp: 0,
      },
    });

    await renderOverview();

    const card = await screen.findByTestId("overview-pm-fee-card");
    expect(card.textContent).toContain("Payment Method Fees");
    expect(card.textContent).toContain("2.5 USD");
  });
});

// ---------------------------------------------------------------------------
// PA-4.1 / PA-4.2 / PA-4.3 — Recharges, Custom Services, Mobile Services
// show both currencies (previously USD-only / single-currency-only)
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-4.1/4.2/4.3 dual-currency module cards", () => {
  it("Recharges shows both USD and LBP (was USD-only)", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      recharges: {
        revenue_usd: 100,
        revenue_lbp: 50000,
        cost_usd: 80,
        cost_lbp: 40000,
        profit_usd: 20,
        profit_lbp: 10000,
        count: 3,
      },
    });

    await renderOverview();

    expect(screen.getByText("Mobile Recharges")).toBeInTheDocument();
    expect(screen.getByText("100 USD + 50000 LBP")).toBeInTheDocument();
    // LO-V9 (round 2): the Profit line now colors each currency in its OWN
    // span (see Profits.auditBatchLO.round2.test.tsx), so the combined
    // "20 USD + 10000 LBP" no longer lives in a single text node — assert
    // each currency separately instead.
    expect(screen.getByText("20 USD")).toBeInTheDocument();
    expect(screen.getByText("10000 LBP")).toBeInTheDocument();
  });

  it("Custom Services shows both USD and LBP (was USD-only)", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      custom_services: {
        revenue_usd: 60,
        revenue_lbp: 30000,
        cost_usd: 10,
        cost_lbp: 0,
        profit_usd: 50,
        profit_lbp: 30000,
        count: 1,
      },
    });

    await renderOverview();

    expect(screen.getByText("60 USD + 30000 LBP")).toBeInTheDocument();
    // LO-V9 (round 2): see the Recharges test above for why the Profit line
    // is asserted per-currency now.
    expect(screen.getByText("50 USD")).toBeInTheDocument();
    expect(screen.getByText("30000 LBP")).toBeInTheDocument();
  });

  it("Mobile Services shows both currencies simultaneously, not just the one with an LBP balance", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      mobile_services: {
        revenue_usd: 40,
        revenue_lbp: 20000,
        cost_usd: 30,
        cost_lbp: 0,
        profit_usd: 10,
        profit_lbp: 20000,
        count: 2,
      },
    });

    await renderOverview();

    // Pre-fix: the card picked ONE currency (LBP, since revenue_lbp > 0)
    // and the USD side (40) was never shown at all.
    expect(screen.getByText("40 USD + 20000 LBP")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PA-4.21 / PA-4.22 — headline Total Net Profit (combined line REMOVED)
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-4.21/PA-4.22 headline Total Net Profit", () => {
  // note #3 (2026-09-24, CLOSED "no change") — the owner rejected PA-4.21's
  // combined "≈ X LBP (at buy rate N)" line entirely: credits are reduced
  // in USD, so a `-0.32$` must never fold into one LBP total. The two tests
  // below used to assert that line's presence (the worked-example text) and
  // its "Set an LBP rate" empty state; per rule 24 they are rewritten into
  // guards that the removed element is NEVER rendered — on the same inputs
  // that used to produce it — rather than deleted.
  it("never renders a combined ≈ line, even with the worked-example inputs and lbp_buy_rate configured (90,000 − 0.32×89,000 = 61,520 LBP)", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      totals: {
        ...baseSummary().totals,
        net_profit_usd: -0.32,
        net_profit_lbp: 90000,
        gross_profit_usd: -0.32,
        gross_profit_lbp: 90000,
        lbp_buy_rate: 89000,
      },
    });

    await renderOverview();

    const headline = await screen.findByTestId("profits-headline-net-profit");
    expect(headline.textContent).toContain("Total Net Profit");
    expect(
      screen.queryByTestId("profits-combined-net-profit"),
    ).not.toBeInTheDocument();
    expect(headline.textContent).not.toContain("≈");
    expect(headline.textContent).not.toMatch(/combined/i);
  });

  it("never renders a combined line or a 'set an LBP rate' prompt when no rate is configured either", async () => {
    mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

    await renderOverview();

    const headline = await screen.findByTestId("profits-headline-net-profit");
    expect(
      screen.queryByTestId("profits-combined-net-profit"),
    ).not.toBeInTheDocument();
    expect(headline.textContent).not.toMatch(/set an lbp rate/i);
  });

  it("net_profit_usd/net_profit_lbp per-currency cards remain unchanged, shown separately and never combined", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      totals: {
        ...baseSummary().totals,
        net_profit_usd: 12,
        net_profit_lbp: 5000,
        lbp_buy_rate: 89000,
      },
    });

    await renderOverview();

    // The original per-currency cards still show their own unconverted
    // figures — the combined line is additive, not a replacement.
    // LO-R6 (round 3): the headline equation now ALSO renders "12 USD" and
    // "5000 LBP" as their own exact-text elements (per-currency
    // ProfitAmountSpans, replacing the old single "12 USD + 5000 LBP"
    // combined string) — so these must be scoped to each SummaryCard,
    // otherwise `getByText` throws "multiple elements found".
    const usdCard = screen.getByText("Net Profit (USD)").closest("div")!
      .parentElement!;
    const lbpCard = screen.getByText("Net Profit (LBP)").closest("div")!
      .parentElement!;
    expect(within(usdCard).getByText("12 USD")).toBeInTheDocument();
    expect(within(lbpCard).getByText("5000 LBP")).toBeInTheDocument();
    // note #3 — no combined figure ever renders alongside them.
    expect(
      screen.queryByTestId("profits-combined-net-profit"),
    ).not.toBeInTheDocument();
  });

  // PA-4.22 — an explicit Gross − Expenses = Net equation on the headline
  // card (not just a bare net figure). Previously there was no headline
  // card at all: this whole element is new.
  it("shows an explicit Gross − Expenses = Net equation, not just the bare net figure", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      expenses: { total_usd: 8, total_lbp: 0, count: 2 },
      totals: {
        ...baseSummary().totals,
        gross_profit_usd: 20,
        gross_profit_lbp: 0,
        net_profit_usd: 12,
        net_profit_lbp: 0,
      },
    });

    await renderOverview();

    const headline = await screen.findByTestId("profits-headline-net-profit");
    expect(headline.textContent).toContain("20 USD");
    expect(headline.textContent).toContain("(Gross)");
    expect(headline.textContent).toContain("8 USD");
    expect(headline.textContent).toContain("(Expenses)");
    expect(headline.textContent).toContain("12 USD");
  });
});

// ---------------------------------------------------------------------------
// PA-4.16 — Overview loader visible error state (own loader)
// ---------------------------------------------------------------------------

describe("Profits Overview — PA-4.16 error visibility (own loader)", () => {
  it("shows a visible error, not the empty-data message, when getProfitSummary rejects", async () => {
    mockGetProfitSummary.mockRejectedValueOnce(new Error("summary boom"));

    render(<Profits />);
    await waitFor(() =>
      expect(mockGetProfitSummary).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );

    // Pre-fix: loadSummary's catch block only ever called setSummary(null),
    // rendering the SAME "No data for this period" message a genuine
    // no-activity period shows.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/failed to load the profit summary/i),
    ).toBeInTheDocument();
    expect(screen.getByText("summary boom")).toBeInTheDocument();
    expect(
      screen.queryByText("No data for this period"),
    ).not.toBeInTheDocument();
  });
});
