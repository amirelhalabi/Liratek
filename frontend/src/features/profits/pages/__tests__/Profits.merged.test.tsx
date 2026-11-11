/**
 * Profits — 4 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 4).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetProfitSummary as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Profits.auditBatchLO.overview", () => {
  beforeAll(resetBetweenFiles);

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

  // ---------------------------------------------------------------------------
  // Fixture
  // ---------------------------------------------------------------------------

  function baseSummary() {
    return {
      period: "2026-08-01 to 2026-08-31",
      sales: {
        revenue_usd: 0,
        cost_usd: 0,
        profit_usd: 0,
        profit_lbp: 0,
        count: 0,
      },
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
  // Hold Money pickup kept change (owner decision 2026-10-07)
  // ---------------------------------------------------------------------------

  describe("Profits Overview — Hold Money card", () => {
    it("renders the pickups' kept change per currency", async () => {
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        hold_money: { profit_usd: 0.12, profit_lbp: 50000, count: 2 },
      });

      await renderOverview();

      const card = await screen.findByTestId("overview-hold-money-card");
      expect(card.textContent).toContain("Hold Money");
      expect(card.textContent).toContain("2 txns");
      expect(card.textContent).toContain("0.12 USD");
      expect(card.textContent).toContain("50000 LBP");
    });

    it("is absent when no pickup kept change in the period", async () => {
      mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

      await renderOverview();

      expect(
        screen.queryByTestId("overview-hold-money-card"),
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

      expect(
        screen.getByText("Commission (at settlement)"),
      ).toBeInTheDocument();
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
        sales: {
          revenue_usd: 10,
          cost_usd: 15,
          profit_usd: -5,
          profit_lbp: 0,
          count: 1,
        },
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
      const card = screen
        .getByText("Total Expenses")
        .closest("div")!.parentElement!;
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
      const usdCard = screen
        .getByText("Net Profit (USD)")
        .closest("div")!.parentElement!;
      const lbpCard = screen
        .getByText("Net Profit (LBP)")
        .closest("div")!.parentElement!;
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
});

describe("Profits.deferredSettlementCommission (LIRA-158)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-158 follow-up (owner decision D17, 2026-08-31) — Overview tab.
   *
   * The owner settles OMT/WHISH batches out of his own drawer BEFORE the
   * clients who owe him for those transfers repay. Commission on a CASHLESS
   * settlement (no money actually arrives — OMT/WHISH, or a mixed bills+OMT
   * batch) now defers until the client's debt is covered, instead of
   * recognising on the settlement day. A bills-only Katsh/iPick settlement is
   * unchanged (still recognises immediately).
   *
   * Backend contract this page now codes against:
   *   - `supplier_commission.count` = the number of DISTINCT settlements that
   *     contributed RECOGNISED commission in the window (not every settlement
   *     touched) — a fully-deferred settlement contributes 0 and does not
   *     increment it.
   *   - the deferred commission itself is folded into
   *     `deferred.client_debt_profit_usd`/`client_debt_profit_lbp`, the same
   *     bucket that already carried account-charged-transaction profit
   *     stranded behind an uncovered client debt.
   *
   * This drives the REAL `Profits` page (only `useApi`, `useModules` and
   * `useCurrencyContext` are mocked, matching this directory's existing
   * convention in Profits.pendingSettlementCount.test.tsx), so a wiring
   * mistake in the JSX itself — not just in a service helper — would be
   * caught.
   */

  // Setup notes from this file (its mocks are the shared ones above):
  // The chart uses recharts via React.lazy + Suspense; stubbed out purely to
  // avoid pulling recharts into this render (Overview tab never shows it, but
  // the module is still imported at the top of Profits.tsx).

  // ---------------------------------------------------------------------------
  // Fixture
  // ---------------------------------------------------------------------------

  /** Every field the Overview tab reads unconditionally (no `summary.x &&`
   *  guard) must be present, or the render throws on `undefined.field`. */
  function baseSummary() {
    return {
      period: "2026-08-01 to 2026-08-31",
      sales: { revenue_usd: 0, cost_usd: 0, profit_usd: 0, count: 0 },
      financial_services: {
        revenue_usd: 0,
        revenue_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
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
      expenses: { total_usd: 0, total_lbp: 0, count: 0 },
      totals: {
        gross_revenue_usd: 0,
        gross_revenue_lbp: 0,
        total_cost_usd: 0,
        total_cost_lbp: 0,
        gross_profit_usd: 0,
        gross_profit_lbp: 0,
        net_profit_usd: 0,
        net_profit_lbp: 0,
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
  // Tests
  // ---------------------------------------------------------------------------

  describe("Profits — Overview, D17 deferred settlement commission", () => {
    it("shows the normal Supplier Commission card when a settlement recognised commission", async () => {
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        supplier_commission: { profit_usd: 2, profit_lbp: 0, count: 1 },
        deferred: {
          partner_profit_usd: 0,
          partner_profit_lbp: 0,
          client_debt_profit_usd: 0,
          client_debt_profit_lbp: 0,
        },
      });

      await renderOverview();

      const card = await screen.findByText("Supplier Commission");
      expect(card).toBeInTheDocument();
      expect(screen.getByText("1 settlements")).toBeInTheDocument();
      expect(screen.getByText("2 USD")).toBeInTheDocument();
      // Not the fully-deferred pointer variant.
      expect(
        screen.queryByTestId("supplier-commission-fully-deferred"),
      ).not.toBeInTheDocument();
      // Nothing deferred this period — the Deferred Profit card stays hidden.
      expect(
        screen.queryByTestId("profits-deferred-card"),
      ).not.toBeInTheDocument();
    });

    it("points at Deferred Profit instead of vanishing when every settlement fully deferred", async () => {
      // count=0 / profit=0 — the D17 contract for a window where a cashless
      // settlement happened but nothing was recognised (everything deferred).
      // PA-3.10: `cashless_deferred_profit_usd` is the field the pointer card
      // now gates on — it is ALWAYS folded, undistinguished, into
      // `client_debt_profit_usd` too (see ProfitSummary.deferred's own doc
      // comment), so a genuine cashless deferral carries both.
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
        deferred: {
          partner_profit_usd: 0,
          partner_profit_lbp: 0,
          client_debt_profit_usd: 2,
          client_debt_profit_lbp: 0,
          cashless_deferred_profit_usd: 2,
          cashless_deferred_profit_lbp: 0,
        },
      });

      await renderOverview();

      // Deferred Profit card is visible (pre-existing behavior, still works).
      const deferredCard = await screen.findByTestId("profits-deferred-card");
      expect(deferredCard).toBeInTheDocument();
      expect(deferredCard.textContent).toContain("2 USD");

      // The caption calling out that this figure can include settlement
      // commission is present (item 2 — legibility, not silent folding).
      expect(
        screen.getByTestId("deferred-client-debt-caption"),
      ).toBeInTheDocument();

      // Supplier Commission renders the "fully deferred" pointer, not the
      // normal breakout (which would render nothing for count=0/profit=0),
      // and not silence.
      const pointer = screen.getByTestId("supplier-commission-fully-deferred");
      expect(pointer).toBeInTheDocument();
      expect(pointer.textContent).toContain("Supplier Commission");
      expect(pointer.textContent).toContain("Deferred");
      expect(pointer.textContent).toMatch(/deferred profit/i);
    });

    it("renders nothing for either card in a genuinely empty period", async () => {
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
        deferred: {
          partner_profit_usd: 0,
          partner_profit_lbp: 0,
          client_debt_profit_usd: 0,
          client_debt_profit_lbp: 0,
        },
      });

      await renderOverview();

      // Give the (absent) cards a chance to have rendered before asserting
      // absence — the awaited helper above already settled the loading state.
      expect(screen.queryByText("Supplier Commission")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("profits-deferred-card"),
      ).not.toBeInTheDocument();
    });

    it("regression: a legacy bills-only-recognised period is unaffected by the D17 branch", async () => {
      // Pre-D17 shape: commission recognised, nothing ever deferred. Must
      // render exactly as before — no pointer card, no Deferred Profit card.
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        supplier_commission: { profit_usd: 5.5, profit_lbp: 0, count: 2 },
      });

      await renderOverview();

      expect(screen.getByText("2 settlements")).toBeInTheDocument();
      expect(screen.getByText("5.5 USD")).toBeInTheDocument();
      expect(
        screen.queryByTestId("supplier-commission-fully-deferred"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("profits-deferred-card"),
      ).not.toBeInTheDocument();
    });

    // PA-3.10 (OWNER_NOTES_2026-09-21.md §6.5) — the actual bug this batch
    // fixes: the pointer card used to gate on `client_debt_profit_usd/_lbp`,
    // which ALSO carries ordinary debt-pending recharge/service/loto/
    // maintenance profit that has nothing to do with a cashless settlement.
    // RED (pre-fix, reintroduced here to prove it): with the OLD gate
    // (`(summary.deferred?.client_debt_profit_usd ?? 0) !== 0`), this exact
    // fixture — client_debt_profit_usd: 2, cashless_deferred_profit_usd: 0 —
    // rendered the "fully deferred" pointer card, wrongly implying a
    // cashless OMT/Whish settlement was awaiting the client's repayment when
    // none had happened at all; the 2 dollars are ordinary unpaid recharge
    // debt. Confirmed by temporarily reverting the JSX gate to
    // `client_debt_profit_usd`/`_lbp` and re-running this test: it failed
    // with "Unable to find an element by: [data-testid="supplier-commission-
    // fully-deferred"]" was NOT thrown — the element WAS found (the bug), so
    // `.not.toBeInTheDocument()` below failed. GREEN after gating on
    // `cashless_deferred_profit_usd`/`_lbp` alone.
    it("PA-3.10: ordinary debt-pending profit (no cashless settlement) does NOT trigger the fully-deferred pointer", async () => {
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
        deferred: {
          partner_profit_usd: 0,
          partner_profit_lbp: 0,
          // Ordinary unpaid recharge/service/loto/maintenance debt — NOT a
          // cashless settlement.
          client_debt_profit_usd: 2,
          client_debt_profit_lbp: 0,
          cashless_deferred_profit_usd: 0,
          cashless_deferred_profit_lbp: 0,
        },
      });

      await renderOverview();

      // The Deferred Profit card still shows the ordinary pending debt (it
      // gates on the combined field, unchanged).
      const deferredCard = await screen.findByTestId("profits-deferred-card");
      expect(deferredCard.textContent).toContain("2 USD");

      // But the Supplier Commission pointer must NOT claim a cashless
      // settlement is awaiting repayment — none happened this period.
      expect(
        screen.queryByTestId("supplier-commission-fully-deferred"),
      ).not.toBeInTheDocument();
      // And the normal Supplier Commission card doesn't appear either
      // (count 0 / profit 0 — nothing was recognised OR deferred via a
      // settlement).
      expect(screen.queryByText("Supplier Commission")).not.toBeInTheDocument();
    });
  });
});

describe("Profits.overviewAwaitingSettlement (LIRA-162)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-162 — pending commission is INVISIBLE on the Profits Overview card.
   *
   * D15's "N transactions awaiting settlement" count previously fed ONLY the
   * By-Payment-Method tab. `ProfitService.getSummary` now ALSO carries
   * `financial_services.awaiting_settlement_count`, so the Overview
   * "Financial Services" card's Pending line can render it.
   *
   * Corrected framing (verified against the pre-fix JSX): the Pending line
   * does NOT show a fabricated `$0.00` — it sits behind a
   * `pending_commission_usd > 0 || pending_commission_lbp > 0` guard that
   * never fires for an all-post-cutover period (both stay legacy-model-only
   * forever), so the line silently does not render AT ALL. This suite proves
   * the fix at the component level: a period with zero legacy pending dollars
   * but a nonzero `awaiting_settlement_count` now renders the Pending line
   * with the count, where it previously rendered nothing.
   *
   * Drives the REAL `Profits` page (only `useApi`, `useModules` and
   * `useCurrencyContext` mocked), matching this directory's established
   * convention (Profits.deferredSettlementCommission.test.tsx).
   */

  // ---------------------------------------------------------------------------
  // Fixture — every field the Overview tab reads unconditionally, mirroring
  // Profits.deferredSettlementCommission.test.tsx's own baseSummary().
  // ---------------------------------------------------------------------------

  function baseSummary() {
    return {
      period: "2026-08-01 to 2026-08-31",
      sales: { revenue_usd: 0, cost_usd: 0, profit_usd: 0, count: 0 },
      financial_services: {
        revenue_usd: 105,
        revenue_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        pending_commission_usd: 0,
        pending_commission_lbp: 0,
        pm_fee_usd: 0,
        pm_fee_lbp: 0,
        count: 1,
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
      expenses: { total_usd: 0, total_lbp: 0, count: 0 },
      supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
      deferred: {
        partner_profit_usd: 0,
        partner_profit_lbp: 0,
        client_debt_profit_usd: 0,
        client_debt_profit_lbp: 0,
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
  // Tests
  // ---------------------------------------------------------------------------

  describe("Profits — Overview, Financial Services Pending line (LIRA-162)", () => {
    it("worked example: one post-cutover OMT SEND — Pending line renders the count, not nothing", async () => {
      // Matches the ticket's worked example: $100 + $5 fee, unsettled,
      // pending_commission stays 0 (legacy-model-only) but
      // awaiting_settlement_count is 1.
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        financial_services: {
          ...baseSummary().financial_services,
          awaiting_settlement_count: 1,
        },
      });

      await renderOverview();

      // Pre-fix this line simply did not exist in the document — the guard
      // (`pending_commission_usd > 0 || pending_commission_lbp > 0`) never
      // fired for this payload.
      const caption = await screen.findByTestId(
        "overview-finsvc-awaiting-settlement",
      );
      expect(caption.textContent).toContain("1 awaiting settlement");
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });

    it("still renders the legacy dollar figure unchanged when the period has real settled-legacy pending", async () => {
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        financial_services: {
          ...baseSummary().financial_services,
          pending_commission_usd: 4.5,
          awaiting_settlement_count: 0,
        },
      });

      await renderOverview();

      expect(screen.getByText("Pending")).toBeInTheDocument();
      expect(
        screen.queryByTestId("overview-finsvc-awaiting-settlement"),
      ).not.toBeInTheDocument();
    });

    it("omits the whole Pending line when there is genuinely nothing pending", async () => {
      mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

      await renderOverview();

      expect(screen.queryByText("Pending")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("overview-finsvc-awaiting-settlement"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("Profits.overviewWaitingForRepayment", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Owner decision (h), 2026-09-24 afternoon (OWNER_NOTES_2026-09-21.md §6.9,
   * L0-4) — the Financial Services card gets a "waiting for repayment" line:
   * the commission on OMT/Whish/other FS transfers charged to a customer's
   * account that is still debt-pending, per currency. Shown like the card's
   * other pending figures (hidden when zero); NEVER added to gross or net
   * profit.
   *
   * Drives the REAL `Profits` page (only `useApi`, `useModules` and
   * `useCurrencyContext` mocked), matching this directory's established
   * convention (Profits.overviewAwaitingSettlement.test.tsx).
   */

  function baseSummary() {
    return {
      period: "2026-08-01 to 2026-08-31",
      sales: { revenue_usd: 0, cost_usd: 0, profit_usd: 0, count: 0 },
      financial_services: {
        revenue_usd: 105,
        revenue_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        pending_commission_usd: 0,
        pending_commission_lbp: 0,
        pm_fee_usd: 0,
        pm_fee_lbp: 0,
        count: 1,
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
      expenses: { total_usd: 0, total_lbp: 0, count: 0 },
      supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
      deferred: {
        partner_profit_usd: 0,
        partner_profit_lbp: 0,
        client_debt_profit_usd: 0,
        client_debt_profit_lbp: 0,
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

  describe("Profits — Overview, Financial Services 'waiting for repayment' line (owner decision h)", () => {
    it("renders the USD + LBP figures when waiting_for_repayment is nonzero", async () => {
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        financial_services: {
          ...baseSummary().financial_services,
          waiting_for_repayment_usd: 5,
          waiting_for_repayment_lbp: 30_000,
        },
      });

      await renderOverview();

      const line = await screen.findByTestId(
        "overview-finsvc-waiting-for-repayment",
      );
      expect(line.textContent).toContain("Waiting for repayment");
      expect(line.textContent).toContain("5 USD");
      expect(line.textContent).toContain("30000 LBP");
    });

    it("hides the line entirely when both currencies are zero (no debt-pending FS commission this period)", async () => {
      mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

      await renderOverview();

      expect(
        screen.queryByTestId("overview-finsvc-waiting-for-repayment"),
      ).not.toBeInTheDocument();
    });

    it("does not change totals — the figure is additive visibility only, never folded into gross/net", async () => {
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        financial_services: {
          ...baseSummary().financial_services,
          waiting_for_repayment_usd: 5,
        },
        totals: {
          ...baseSummary().totals,
          gross_profit_usd: 12,
          net_profit_usd: 12,
        },
      });

      await renderOverview();

      await screen.findByTestId("overview-finsvc-waiting-for-repayment");
      // The $5 waiting-for-repayment figure must never be folded into the Net
      // Profit total (12 + 5 = 17) — totals are rendered from their own
      // server-computed fields, untouched by this line.
      expect(screen.queryByText("17 USD")).not.toBeInTheDocument();
      expect(screen.getAllByText("12 USD").length).toBeGreaterThan(0);
    });
  });
});
