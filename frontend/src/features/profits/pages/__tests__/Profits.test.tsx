/**
 * Profits — 7 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 7).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetProfitSummary as unknown as jest.Mock).mockReset();
  (mockGetProfitByModule as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Profits.auditBatchLO.round2", () => {
  beforeAll(resetBetweenFiles);

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

  // ---------------------------------------------------------------------------
  // Fixtures
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

      const card = screen
        .getByText("Expenses Deducted")
        .closest("div")!.parentElement!;
      expect(within(card).queryByText("0 USD")).not.toBeInTheDocument();
      expect(within(card).getByText("-45000 LBP")).toBeInTheDocument();
    });

    // Owner request 2026-10-07 (production review): a zero deduction reads
    // "$0.00", never "-$0.00" — this assertion was "-0 USD" before that
    // decision. The LO-V9 property it guards (the USD column still shows for
    // an all-zero period) is unchanged.
    it("Expenses Deducted still shows USD: $0.00 for a genuinely all-zero period", async () => {
      mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

      await renderOverview();

      const card = screen
        .getByText("Expenses Deducted")
        .closest("div")!.parentElement!;
      expect(within(card).getByText("0 USD")).toBeInTheDocument();
      expect(within(card).queryByText("-0 USD")).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // LO-V1 — Kept Change card
  // ---------------------------------------------------------------------------

  describe("Profits Overview — LO-V1 Kept Change card", () => {
    it("renders a sale's own LBP kept change, previously computed and never shown", async () => {
      mockGetProfitSummary.mockResolvedValueOnce({
        ...baseSummary(),
        sales: {
          revenue_usd: 100,
          cost_usd: 80,
          profit_usd: 20,
          profit_lbp: 45000,
          count: 1,
        },
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
        sales: {
          revenue_usd: 100,
          cost_usd: 80,
          profit_usd: 20,
          profit_lbp: 45000,
          count: 1,
        },
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
      mockGetProfitSummary.mockImplementation(
        async (from: string, to: string) => ({
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
        }),
      );

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

      fireEvent.click(
        screen.getByTestId("by-module-expand-FINANCIAL_SERVICE_OMT"),
      );

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
      const errorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
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

      const keyWarning = errorSpy.mock.calls.some(
        (args) =>
          String(args[0]).includes("unique") && String(args[0]).includes("key"),
      );
      expect(keyWarning).toBe(false);

      errorSpy.mockRestore();
    });
  });
});

describe("Profits.auditBatchLO.round3", () => {
  beforeAll(resetBetweenFiles);

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

  // ---------------------------------------------------------------------------
  // Fixtures
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
      mockGetProfitSummary.mockImplementation(
        async (from: string, to: string) => ({
          ...baseSummary(),
          period: `${from} to ${to}`,
        }),
      );

      await renderByModuleDirectly();
      const summaryCallsBeforeDateChange =
        mockGetProfitSummary.mock.calls.length;
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
      mockGetProfitSummary.mockImplementation(
        async (from: string, to: string) => ({
          ...baseSummary(),
          period: `${from} to ${to}`,
          totals: {
            ...baseSummary().totals,
            gross_profit_usd: from === NEW_FROM ? 999 : 111,
            net_profit_usd: from === NEW_FROM ? 999 : 111,
          },
        }),
      );

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
      mockGetProfitSummary.mockImplementation(
        async (from: string, to: string) => {
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
        },
      );
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
      mockGetProfitSummary.mockImplementation(
        async (from: string, to: string) => ({
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
        }),
      );

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
      mockGetProfitSummary.mockImplementation(
        async (from: string, to: string) => ({
          ...baseSummary(),
          period: `${from} to ${to}`,
          totals: {
            ...baseSummary().totals,
            gross_profit_usd: 0,
            gross_profit_lbp: -5000,
            net_profit_usd: 0,
            net_profit_lbp: -5000,
          },
        }),
      );

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
});

describe("Profits.lira310Waived (LIRA-310)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-310 follow-up (owner decision 2026-10-12) — a basket Waive shows as
   * its OWN "Waived" line on the Profits page, never folded into Kept Change.
   * Owner example: Kept Change $2, Waived −$3 — the server now returns them
   * as two figures (`debt_repayments` and `waived`), and the page shows both:
   *   - Overview: a "Waived" card next to "Other / Kept Change";
   *   - By Module: a profit-only "Waived" row with its drill-down.
   * Drives the REAL page (only useApi, useModules, useCurrencyContext mocked).
   * Rule 17: written before the page knew `waived`; red run recorded in
   * specs/310-waive-everywhere/tasks.md.
   */

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

  beforeEach(() => jest.clearAllMocks());

  describe("Profits — Waived line (LIRA-310 follow-up)", () => {
    it("Overview: Kept Change shows $2 and a separate Waived card shows −$3", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        debt_repayments: { profit_usd: 2, profit_lbp: 0, count: 1 },
        waived: { profit_usd: -3, profit_lbp: 0, count: 1 },
      });
      render(<Profits />);
      const card = await screen.findByTestId("overview-waived-card");
      expect(card.textContent).toContain("Waived");
      expect(card.textContent).toContain("-3 USD");
      const kept = screen.getByTestId("overview-kept-change-card");
      expect(kept.textContent).toContain("2 USD");
      expect(kept.textContent).not.toContain("-3 USD");
    });

    it("no Waived card when the period has no waive", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        waived: { profit_usd: 0, profit_lbp: 0, count: 0 },
      });
      render(<Profits />);
      await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId("overview-waived-card")).toBeNull();
    });

    it("By Module: Kept Change $2 and a profit-only Waived −$3 row with its drill-down", async () => {
      mockGetProfitSummary.mockResolvedValue(baseSummary());
      const row = (module: string, label: string, profit: number) => ({
        module,
        label,
        revenue_usd: 0,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: profit,
        profit_lbp: 0,
        count: 1,
        margin_pct: null,
        margin_converted: false,
      });
      mockGetProfitByModule.mockResolvedValue([
        row("KEPT_CHANGE", "Kept Change", 2),
        row("WAIVED", "Waived", -3),
      ]);
      render(<Profits />);
      fireEvent.click(screen.getByText("By Module"));
      expect(await screen.findByText("Waived")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("by-module-expand-WAIVED"));
      const usd = await screen.findByTestId("by-module-detail-WAIVED-usd");
      expect(usd.textContent).toContain("Profit:");
      expect(usd.textContent).toContain("-3 USD");
      expect(
        screen.getByTestId("by-module-show-transactions-WAIVED"),
      ).toBeInTheDocument();
    });
  });
});

describe("Profits.lira319ExtraCharges (LIRA-319)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-319 (owner 2026-10-13) — "Extra charges" on the Profits page: what
   * cashiers added on top of a price shows as its OWN line, never inside an
   * item's or module's profit.
   *   - Overview: an "Extra charges" card (per currency), from
   *     `getSummary().extra_charges` (already folded into the totals server-side).
   *   - By Module: a profit-only "Extra charges" row (module EXTRA_CHARGE,
   *     revenue = profit, cost 0) with its drill-down.
   * Mock data is shaped per the Profits contract (specs/319-extra-charges
   * data-model.md "Reporting shape"). Not proven failing-first: written after
   * the page change.
   * Drives the REAL page (only useApi, useModules, useCurrencyContext mocked;
   * one stable mockApi object — rule 25).
   */

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

  beforeEach(() => jest.clearAllMocks());

  describe("Profits — Extra charges (LIRA-319)", () => {
    it("Overview: an Extra charges card shows $3 and 10,000 LBP", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        extra_charges: { usd: 3, lbp: 10000 },
      });
      render(<Profits />);
      const card = await screen.findByTestId("overview-extra-charges-card");
      expect(card.textContent).toContain("Extra charges");
      expect(screen.getByTestId("extra-charges-usd").textContent).toContain(
        "3 USD",
      );
      expect(screen.getByTestId("extra-charges-lbp").textContent).toContain(
        "10000 LBP",
      );
    });

    it("no card when the period has no extra (or an older payload without the field)", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        extra_charges: { usd: 0, lbp: 0 },
      });
      render(<Profits />);
      await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId("overview-extra-charges-card")).toBeNull();
    });

    it("By Module: a profit-only Extra charges row ($3, cost 0) with its drill-down", async () => {
      mockGetProfitSummary.mockResolvedValue(baseSummary());
      mockGetProfitByModule.mockResolvedValue([
        {
          module: "POS",
          label: "POS Sales",
          revenue_usd: 12,
          revenue_lbp: 0,
          cost_usd: 10,
          cost_lbp: 0,
          profit_usd: 2,
          profit_lbp: 0,
          count: 2,
          margin_pct: null,
          margin_converted: false,
        },
        {
          module: "EXTRA_CHARGE",
          label: "Extra charges",
          revenue_usd: 3,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: 3,
          profit_lbp: 0,
          count: 2,
          margin_pct: null,
          margin_converted: false,
        },
      ]);
      render(<Profits />);
      fireEvent.click(screen.getByText("By Module"));
      expect(await screen.findByText("Extra charges")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("by-module-expand-EXTRA_CHARGE"));
      const usd = await screen.findByTestId(
        "by-module-detail-EXTRA_CHARGE-usd",
      );
      expect(usd.textContent).toContain("Profit:");
      expect(usd.textContent).toContain("3 USD");
      // Profit-only: no revenue − cost equation on this row.
      expect(usd.textContent).not.toContain("Cost");
      expect(
        screen.getByTestId("by-module-show-transactions-EXTRA_CHARGE"),
      ).toBeInTheDocument();
    });
  });
});

describe("Profits.lira341SessionDiscounts (LIRA-341)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-341 — "Session discounts" on the Profits Overview: the basket
   * discounts given at session checkout (LIRA-341 core books them as
   * BASKET_DISCOUNT rows and returns `getSummary().session_discounts`, already
   * inside the totals). Its own line next to Waived / Extra charges.
   * Drives the REAL page (only useApi, useModules, useCurrencyContext mocked;
   * one stable mockApi object — rule 25).
   */

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

  beforeEach(() => jest.clearAllMocks());

  describe("Profits — Session discounts (LIRA-341)", () => {
    it("Overview: a Session discounts line shows -$8, -90,000 LBP and the count", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        session_discounts: { profit_usd: -8, profit_lbp: -90000, count: 2 },
      });
      render(<Profits />);
      const card = await screen.findByTestId("overview-session-discounts-card");
      expect(card.textContent).toContain("Session discounts");
      expect(card.textContent).toContain("2");
      expect(screen.getByTestId("session-discounts-usd").textContent).toContain(
        "-8 USD",
      );
      expect(screen.getByTestId("session-discounts-lbp").textContent).toContain(
        "-90000 LBP",
      );
    });

    it("no line when the period has none (or an older payload without the field)", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        session_discounts: { profit_usd: 0, profit_lbp: 0, count: 0 },
      });
      render(<Profits />);
      await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByTestId("overview-session-discounts-card"),
      ).toBeNull();
    });
  });
});

describe("Profits.warrantyCost (LIRA-296)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-296 (T041, owner decision D1) — the Profits page shows the cost of
   * honouring warranties as ONE "Warranty cost" line:
   *   - By Module: a profit-only row ("Profit: <amount>", never "0 − 0 = X")
   *     with its "Show transactions" drill-down;
   *   - Overview: a "Warranty cost" card when the period has any.
   * Drives the REAL page (only useApi, useModules, useCurrencyContext mocked).
   */

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

  beforeEach(() => jest.clearAllMocks());

  describe("Profits — Warranty cost (LIRA-296)", () => {
    it("Overview shows a Warranty cost card", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        warranty: { profit_usd: -6, profit_lbp: 0, count: 1 },
      });
      render(<Profits />);
      const card = await screen.findByTestId("overview-warranty-card");
      expect(card.textContent).toContain("Warranty cost");
      expect(card.textContent).toContain("1 claims");
      expect(card.textContent).toContain("-6 USD");
    });

    it("no card when the period has no warranty cost", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        warranty: { profit_usd: 0, profit_lbp: 0, count: 0 },
      });
      render(<Profits />);
      await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId("overview-warranty-card")).toBeNull();
    });

    it("By Module: a profit-only Warranty cost row with its drill-down", async () => {
      mockGetProfitSummary.mockResolvedValue(baseSummary());
      mockGetProfitByModule.mockResolvedValue([
        {
          module: "WARRANTY",
          label: "Warranty cost",
          revenue_usd: 0,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: -6,
          profit_lbp: 0,
          count: 1,
          margin_pct: null,
          margin_converted: false,
        },
      ]);
      render(<Profits />);
      fireEvent.click(screen.getByText("By Module"));
      expect(await screen.findByText("Warranty cost")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("by-module-expand-WARRANTY"));
      const usd = await screen.findByTestId("by-module-detail-WARRANTY-usd");
      expect(usd.textContent).toContain("Profit:");
      expect(usd.textContent).not.toContain("−");
      expect(
        screen.getByTestId("by-module-show-transactions-WARRANTY"),
      ).toBeInTheDocument();
    });
  });
});

describe("Profits.wrongNumberRecovery (LIRA-312)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-312 (T024) — credits sent back after a wrong-number card are ONE
   * "Wrong-number credits recovered" line in Profits: an Overview card (only
   * when the period has any) and a profit-only By Module row with its
   * drill-down. Same shape as the Warranty cost card (LIRA-296).
   *
   * Rule 17 note: written after the UI, so NOT proven failing-first.
   */

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

  beforeEach(() => jest.clearAllMocks());

  describe("Profits — Wrong-number credits recovered (LIRA-312)", () => {
    it("Overview shows a Wrong-number credits recovered card", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        wrong_number_recovery: { profit_usd: 0, profit_lbp: 668000, count: 1 },
      });
      render(<Profits />);
      const card = await screen.findByTestId("overview-wrong-number-card");
      expect(card.textContent).toContain("Wrong-number credits recovered");
      expect(card.textContent).toContain("1 entries");
      expect(card.textContent).toContain("668000 LBP");
    });

    it("no card when the period has no recovered credits", async () => {
      mockGetProfitSummary.mockResolvedValue({
        ...baseSummary(),
        wrong_number_recovery: { profit_usd: 0, profit_lbp: 0, count: 0 },
      });
      render(<Profits />);
      await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId("overview-wrong-number-card")).toBeNull();
    });

    it("By Module: a profit-only row with its drill-down", async () => {
      mockGetProfitSummary.mockResolvedValue(baseSummary());
      mockGetProfitByModule.mockResolvedValue([
        {
          module: "WRONG_NUMBER",
          label: "Wrong-number credits recovered",
          revenue_usd: 0,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: 0,
          profit_lbp: 668000,
          count: 1,
          margin_pct: null,
          margin_converted: false,
        },
      ]);
      render(<Profits />);
      fireEvent.click(screen.getByText("By Module"));
      expect(
        await screen.findByText("Wrong-number credits recovered"),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("by-module-expand-WRONG_NUMBER"));
      const lbpLine = await screen.findByTestId(
        "by-module-detail-WRONG_NUMBER-lbp",
      );
      expect(lbpLine.textContent).toContain("Profit:");
      expect(
        screen.getByTestId("by-module-show-transactions-WRONG_NUMBER"),
      ).toBeInTheDocument();
    });
  });
});
