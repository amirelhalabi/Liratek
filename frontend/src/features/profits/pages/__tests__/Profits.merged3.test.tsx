/**
 * Profits — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Profits from "../Profits";

const mockGetProfitByModule = jest.fn();

const mockGetProfitSummary = jest.fn().mockResolvedValue(null);

const mockGetProfitModuleDetail = jest.fn();

const mockApi = {
  getProfitByModule: mockGetProfitByModule,
  getProfitSummary: mockGetProfitSummary,
  getProfitModuleDetail: mockGetProfitModuleDetail,
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
  (mockGetProfitByModule as unknown as jest.Mock).mockReset();
  (mockGetProfitSummary as unknown as jest.Mock).mockReset();
  (mockGetProfitSummary as unknown as jest.Mock).mockResolvedValue(null);
  (mockGetProfitModuleDetail as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Profits.moduleDetailDrilldown", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NOT RUN — proven at the end-of-batch gate (OWNER_NOTES_REMAINING_BUILD.md
   * #14 slice 2 batch process rule: implement first, verify at the end).
   *
   * PROF-DD-FIX (review round, 2026-09-24) — a frontend component test for the
   * By Module "Show transactions" drill-down (M5: this layer was entirely
   * missing before — see n14_review_r0.json). Covers the two UI defects the
   * review found by reading, which only a rendered-component test can catch:
   *
   *  - M3: the counted table must show the WEIGHTED counted_profit_usd/lbp
   *    (never the raw unweighted profit_usd/lbp), a partial row's reason must
   *    be visible even though it IS counted, and a visible "Counted total"
   *    footer must equal counted_total_profit_usd/lbp (the owner's own "add up
   *    EXACTLY" ask).
   *  - M2: changing the date range must clear the cached drill-down (the
   *    "Show transactions" button reappears) instead of silently showing the
   *    OLD period's rows under the NEW period's By Module row.
   *
   * Drives the REAL `Profits` page (only `useApi`, `useModules` and
   * `useCurrencyContext` mocked) — same harness as
   * `Profits.byModuleRowClassification.test.tsx`.
   */

  const SALE_ROW = {
    module: "SALE",
    label: "Product Sales",
    revenue_usd: 75,
    revenue_lbp: 0,
    cost_usd: 45,
    cost_lbp: 0,
    profit_usd: 30,
    profit_lbp: 0,
    count: 2,
    margin_pct: 40,
    margin_converted: false,
  };

  // Sale A: fully counted (100%). Sale B: partner-settled at 50% — its ROW
  // profit_usd (20) is deliberately NOT what should render; the WEIGHTED
  // counted_profit_usd (10) is. 20 (weight 1.0) + 10 (20 * 0.5) = 30, matching
  // SALE_ROW.profit_usd above exactly (the owner's "add up EXACTLY" ask).
  const DETAIL = {
    module: "SALE",
    counted: [
      {
        id: 1,
        date: "2026-09-05 10:00:00",
        counterpart: "Walk-in",
        detail: "Charger x1",
        amount_usd: 50,
        amount_lbp: 0,
        cost_usd: 30,
        cost_lbp: 0,
        profit_usd: 20,
        profit_lbp: 0,
        counted_pct: 100,
        counted_profit_usd: 20,
        counted_profit_lbp: 0,
        reason: null,
        fee_note: null,
      },
      {
        id: 2,
        date: "2026-09-06 11:00:00",
        counterpart: "071000000",
        detail: "Case x1",
        amount_usd: 25,
        amount_lbp: 0,
        cost_usd: 15,
        cost_lbp: 0,
        profit_usd: 20,
        profit_lbp: 0,
        counted_pct: 50,
        counted_profit_usd: 10,
        counted_profit_lbp: 0,
        reason: "Partner has settled 50% of this sale so far.",
        fee_note: null,
      },
    ],
    not_counted: [
      {
        id: 3,
        date: "2026-09-07 12:00:00",
        counterpart: "Walk-in",
        detail: "Screen x1",
        amount_usd: 40,
        amount_lbp: 0,
        cost_usd: 25,
        cost_lbp: 0,
        profit_usd: 15,
        profit_lbp: 0,
        counted_pct: 0,
        counted_profit_usd: 0,
        counted_profit_lbp: 0,
        reason: "Customer still owes — paid $0.00 of $40.00.",
        fee_note: null,
      },
    ],
    counted_total_profit_usd: 30,
    counted_total_profit_lbp: 0,
  };

  async function renderByModule() {
    const utils = render(<Profits />);
    fireEvent.click(screen.getByText("By Module"));
    await waitFor(() => expect(mockGetProfitByModule).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    return utils;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfitByModule.mockResolvedValue([SALE_ROW]);
    mockGetProfitModuleDetail.mockResolvedValue(DETAIL);
  });

  describe("Profits By Module drill-down — 'Show transactions' (PROF-DD-FIX, review round)", () => {
    it("shows the WEIGHTED counted_profit_usd (never the raw unweighted profit_usd) and a Counted total that equals the module row's own profit", async () => {
      await renderByModule();
      fireEvent.click(screen.getByTestId("by-module-expand-SALE"));
      fireEvent.click(screen.getByTestId("by-module-show-transactions-SALE"));

      await waitFor(() =>
        expect(mockGetProfitModuleDetail).toHaveBeenCalledWith(
          "SALE",
          expect.any(String),
          expect.any(String),
        ),
      );

      const table = await screen.findByTestId(
        "by-module-transactions-counted-SALE",
      );
      // Sale B's row shows 10 USD (counted_profit_usd, weighted), never 20 USD
      // (profit_usd, unweighted).
      expect(table.textContent).toContain("10 USD");

      const totalRow = await screen.findByTestId(
        "by-module-transactions-counted-total-SALE",
      );
      expect(totalRow.textContent).toContain("30 USD");
    });

    it("shows the partial row's reason even though it IS counted (50%)", async () => {
      await renderByModule();
      fireEvent.click(screen.getByTestId("by-module-expand-SALE"));
      fireEvent.click(screen.getByTestId("by-module-show-transactions-SALE"));

      const table = await screen.findByTestId(
        "by-module-transactions-counted-SALE",
      );
      expect(table.textContent).toContain(
        "Partner has settled 50% of this sale so far.",
      );
    });

    it("shows the not-counted row's reason in the greyed section", async () => {
      await renderByModule();
      fireEvent.click(screen.getByTestId("by-module-expand-SALE"));
      fireEvent.click(screen.getByTestId("by-module-show-transactions-SALE"));

      const notCounted = await screen.findByTestId(
        "by-module-transactions-not-counted-SALE",
      );
      expect(notCounted.textContent).toContain(
        "Customer still owes — paid $0.00 of $40.00.",
      );
    });

    it("PROF-DD-FIX M2: changing the date range clears the cached drill-down instead of showing the old period's rows", async () => {
      await renderByModule();
      fireEvent.click(screen.getByTestId("by-module-expand-SALE"));
      fireEvent.click(screen.getByTestId("by-module-show-transactions-SALE"));
      await screen.findByTestId("by-module-transactions-counted-SALE");
      expect(mockGetProfitModuleDetail).toHaveBeenCalledTimes(1);

      // Change the date range — must clear the loaded drill-down.
      fireEvent.change(screen.getByTestId("date-range-from"), {
        target: { value: "2026-08-01" },
      });

      // The table is gone and the button is back (not silently showing stale
      // rows under the new period's By Module row).
      await waitFor(() =>
        expect(
          screen.queryByTestId("by-module-transactions-counted-SALE"),
        ).not.toBeInTheDocument(),
      );
      expect(
        screen.getByTestId("by-module-show-transactions-SALE"),
      ).toBeInTheDocument();

      // Clicking it again re-fetches for the NEW range, not a no-op.
      fireEvent.click(screen.getByTestId("by-module-show-transactions-SALE"));
      await waitFor(() =>
        expect(mockGetProfitModuleDetail).toHaveBeenCalledTimes(2),
      );
      const [, secondCallFrom] = mockGetProfitModuleDetail.mock.calls[1] as [
        string,
        string,
        string,
      ];
      expect(secondCallFrom).toBe("2026-08-01");
    });
  });

  // ---------------------------------------------------------------------------
  // LIRA-385 (owner decision 2026-11-11, "Per-module columns + Other row") —
  // Expenses USD / Expenses LBP columns per module, a final "Other expenses"
  // row, and a click on an expense figure opens that row's expense list.
  // ---------------------------------------------------------------------------

  const SALE_ROW_WITH_EXPENSES = {
    ...SALE_ROW,
    expenses_usd: 0.5,
    expenses_lbp: 0,
  };
  const OTHER_ROW = {
    module: "OTHER_EXPENSES",
    label: "Other expenses (not linked to a module)",
    revenue_usd: 0,
    revenue_lbp: 0,
    cost_usd: 0,
    cost_lbp: 0,
    profit_usd: 0,
    profit_lbp: 0,
    count: 0,
    margin_pct: null,
    margin_converted: false,
    expenses_usd: 5,
    expenses_lbp: 450000,
  };
  const SALE_EXPENSE = {
    id: 41,
    date: "2026-09-05 10:00:00",
    category: "Change rounding",
    description: "Change rounding on sale #1",
    amount_usd: 0.5,
    amount_lbp: 0,
    linked_summary: "Sale #1 — Charger x1",
  };
  const OTHER_EXPENSES_DETAIL = {
    module: "OTHER_EXPENSES",
    counted: [],
    not_counted: [],
    counted_total_profit_usd: 0,
    counted_total_profit_lbp: 0,
    expenses: [
      {
        id: 42,
        date: "2026-09-06 09:00:00",
        category: "Shop_Supply",
        description: "Paper rolls",
        amount_usd: 5,
        amount_lbp: 0,
        linked_summary: null,
      },
      {
        id: 43,
        date: "2026-09-07 09:00:00",
        category: "Bill",
        description: "Electricity",
        amount_usd: 0,
        amount_lbp: 450000,
        linked_summary: null,
      },
    ],
  };

  describe("Profits By Module — expenses per module (LIRA-385)", () => {
    beforeEach(() => {
      mockGetProfitByModule.mockResolvedValue([
        SALE_ROW_WITH_EXPENSES,
        OTHER_ROW,
      ]);
      mockGetProfitModuleDetail.mockImplementation((key: string) =>
        Promise.resolve(
          key === "OTHER_EXPENSES"
            ? OTHER_EXPENSES_DETAIL
            : { ...DETAIL, expenses: [SALE_EXPENSE] },
        ),
      );
    });

    it("shows Expenses USD/LBP columns, an Other row, and a TOTAL that sums them", async () => {
      await renderByModule();
      expect(screen.getAllByText("Expenses (USD)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Expenses (LBP)").length).toBeGreaterThan(0);
      expect(
        screen.getByTestId("by-module-expenses-usd-SALE").textContent,
      ).toBe("0.5 USD");
      const other = screen.getByTestId("by-module-row-OTHER_EXPENSES");
      expect(other.textContent).toContain(
        "Other expenses (not linked to a module)",
      );
      expect(
        screen.getByTestId("by-module-expenses-lbp-OTHER_EXPENSES").textContent,
      ).toBe("450000 LBP");
      expect(
        screen.getByTestId("by-module-total-expenses-usd").textContent,
      ).toBe("5.5 USD");
      expect(
        screen.getByTestId("by-module-total-expenses-lbp").textContent,
      ).toBe("450000 LBP");
      // The net row spans every column (11 now).
      const netCell = screen
        .getByTestId("by-module-net-row")
        .querySelector("td");
      expect(netCell?.getAttribute("colspan")).toBe("11");
    });

    it("clicking a module's expense figure opens its panel on the expense list", async () => {
      await renderByModule();
      fireEvent.click(screen.getByTestId("by-module-expenses-usd-SALE"));
      await waitFor(() =>
        expect(mockGetProfitModuleDetail).toHaveBeenCalledWith(
          "SALE",
          expect.any(String),
          expect.any(String),
        ),
      );
      const list = await screen.findByTestId("by-module-expenses-list-SALE");
      expect(list.textContent).toContain("Change rounding");
      expect(list.textContent).toContain("Sale #1 — Charger x1");
      expect(list.textContent).toContain("0.5 USD");
    });

    it("clicking the Other row's expense figure lists the unlinked expenses (no transactions button)", async () => {
      await renderByModule();
      fireEvent.click(
        screen.getByTestId("by-module-expenses-lbp-OTHER_EXPENSES"),
      );
      const list = await screen.findByTestId(
        "by-module-expenses-list-OTHER_EXPENSES",
      );
      expect(list.textContent).toContain("Paper rolls");
      expect(list.textContent).toContain("450000 LBP");
      expect(
        screen.queryByTestId("by-module-show-transactions-OTHER_EXPENSES"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("Profits.moduleDetailDrilldownSlice3 (LIRA-233)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-233 (#14 slice 3) — the By Module "Show transactions" drill-down
   * used to render its button for SALE/RECHARGE_<carrier> only (slice 2);
   * `ProfitService.getModuleDetail` now has a registry entry for every module
   * `getByModule` can emit (MAINTENANCE, KEPT_CHANGE, COUNTERPARTY_DISCOUNT,
   * SUPPLIER_COMMISSION, TOPUP_BUYBACK, FINANCIAL_SERVICE_*, CUSTOM_SERVICE,
   * LOTO, EXCHANGE, PM_FEE — see ProfitService.ts's moduleDetailRegistry), so
   * the button must render for those too, and never throw.
   *
   * Covers:
   *  - MAINTENANCE: the "Show transactions" table renders a per-row parts/
   *    labour split (mirroring the module TOTALS row's own split, scaled
   *    down to one counted transaction).
   *  - a profit-only module (KEPT_CHANGE): amount_usd/amount_lbp are 0 (no
   *    revenue/cost concept for this class — PA-4.23), but the row still
   *    renders its counted profit figure, and a not-counted row's reason is
   *    still visible.
   *
   * Drives the REAL `Profits` page (only `useApi`, `useModules` and
   * `useCurrencyContext` mocked) — same harness as
   * `Profits.moduleDetailDrilldown.test.tsx` (slice 2's own test).
   */

  const MAINTENANCE_ROW = {
    module: "MAINTENANCE",
    label: "Maintenance",
    revenue_usd: 100,
    revenue_lbp: 0,
    cost_usd: 40,
    cost_lbp: 0,
    profit_usd: 60,
    profit_lbp: 0,
    count: 1,
    margin_pct: 60,
    margin_converted: false,
    parts_revenue_usd: 50,
    parts_cost_usd: 40,
    parts_profit_usd: 10,
    labour_profit_usd: 50,
    labour_profit_lbp: 0,
  };

  const MAINTENANCE_DETAIL = {
    module: "MAINTENANCE",
    counted: [
      {
        id: 11,
        date: "2026-09-05 10:00:00",
        counterpart: "071000000",
        detail: "Screen repair",
        amount_usd: 100,
        amount_lbp: 0,
        cost_usd: 40,
        cost_lbp: 0,
        profit_usd: 60,
        profit_lbp: 0,
        counted_pct: 100,
        counted_profit_usd: 60,
        counted_profit_lbp: 0,
        reason: null,
        fee_note: null,
        parts_revenue_usd: 50,
        parts_cost_usd: 40,
        parts_profit_usd: 10,
        labour_profit_usd: 50,
        labour_profit_lbp: 0,
      },
    ],
    not_counted: [],
    counted_total_profit_usd: 60,
    counted_total_profit_lbp: 0,
  };

  const KEPT_CHANGE_ROW = {
    module: "KEPT_CHANGE",
    label: "Kept Change",
    revenue_usd: 0,
    revenue_lbp: 0,
    cost_usd: 0,
    cost_lbp: 0,
    profit_usd: 3,
    profit_lbp: 0,
    count: 2,
    margin_pct: undefined,
    margin_converted: false,
  };

  const KEPT_CHANGE_DETAIL = {
    module: "KEPT_CHANGE",
    counted: [
      {
        id: 21,
        date: "2026-09-05 10:00:00",
        counterpart: "Walk-in",
        detail: "Sale #55 kept change",
        amount_usd: 0,
        amount_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 3,
        profit_lbp: 0,
        counted_pct: 100,
        counted_profit_usd: 3,
        counted_profit_lbp: 0,
        reason: null,
        fee_note: null,
      },
    ],
    not_counted: [
      {
        id: 22,
        date: "2026-09-06 11:00:00",
        counterpart: "Walk-in",
        detail: "Sale #56 kept change",
        amount_usd: 0,
        amount_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 2,
        profit_lbp: 0,
        counted_pct: 0,
        counted_profit_usd: 0,
        counted_profit_lbp: 0,
        reason: "Sale #56 still pending settlement.",
        fee_note: null,
      },
    ],
    counted_total_profit_usd: 3,
    counted_total_profit_lbp: 0,
  };

  async function renderByModule() {
    const utils = render(<Profits />);
    fireEvent.click(screen.getByText("By Module"));
    await waitFor(() => expect(mockGetProfitByModule).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    return utils;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const FS_ROW = {
    module: "FINANCIAL_SERVICE_OMT",
    label: "OMT",
    revenue_usd: 0,
    revenue_lbp: 0,
    cost_usd: 0,
    cost_lbp: 0,
    profit_usd: 9,
    profit_lbp: 0,
    count: 2,
    margin_pct: undefined,
    margin_converted: false,
  };

  // LIRA-233 (#14 slice 3 review round, finding 2) — a `financial_services.id`
  // and a `settlement_commission_allocations.id` are independent sequences
  // that CAN collide (both are `5` here). Distinguishable only by `source`.
  const FS_DETAIL_DUPLICATE_IDS = {
    module: "FINANCIAL_SERVICE_OMT",
    counted: [
      {
        id: 5,
        source: "financial_service_transfer",
        date: "2026-09-05 10:00:00",
        counterpart: "Ali",
        detail: "SEND transfer",
        amount_usd: 20,
        amount_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 0,
        counted_pct: 100,
        counted_profit_usd: 0,
        counted_profit_lbp: 0,
        reason: null,
        fee_note: null,
      },
      {
        id: 5,
        source: "financial_service_allocation",
        date: "2026-09-05 10:00:00",
        counterpart: "Ali",
        detail: "SEND transfer (settlement allocation)",
        amount_usd: 0,
        amount_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 9,
        profit_lbp: 0,
        counted_pct: 100,
        counted_profit_usd: 9,
        counted_profit_lbp: 0,
        reason: null,
        fee_note: null,
      },
    ],
    not_counted: [
      // finding 4 — a not-counted row must show its own detail label + amount,
      // not just date/client/reason.
      {
        id: 6,
        source: "financial_service_transfer",
        date: "2026-09-06 10:00:00",
        counterpart: "Sara",
        detail: "EUR transfer",
        amount_usd: 0,
        amount_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 4,
        profit_lbp: 0,
        counted_pct: 0,
        counted_profit_usd: 0,
        counted_profit_lbp: 0,
        reason: "This transfer's currency isn't tracked as USD or LBP.",
        fee_note: null,
      },
    ],
    counted_total_profit_usd: 9,
    counted_total_profit_lbp: 0,
  };

  // LIRA-233 (#14 slice 3 review round, finding 9) — an "info" note (e.g. a
  // positive kept-change aside) must NOT render in the same red used for a
  // real fee deduction.
  const KEPT_CHANGE_INFO_NOTE_DETAIL = {
    module: "KEPT_CHANGE",
    counted: [
      {
        id: 31,
        source: "kept_change",
        date: "2026-09-05 10:00:00",
        counterpart: "Walk-in",
        detail: "Kept change",
        amount_usd: 0,
        amount_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 1,
        profit_lbp: 0,
        counted_pct: 100,
        counted_profit_usd: 1,
        counted_profit_lbp: 0,
        reason: null,
        fee_note: "kept change +1 USD",
        fee_note_kind: "info",
      },
    ],
    not_counted: [],
    counted_total_profit_usd: 1,
    counted_total_profit_lbp: 0,
  };

  describe("Profits By Module drill-down — slice 3 (LIRA-233, every module)", () => {
    it("renders 'Show transactions' for MAINTENANCE and shows the per-row parts/labour split", async () => {
      mockGetProfitByModule.mockResolvedValueOnce([MAINTENANCE_ROW]);
      mockGetProfitModuleDetail.mockResolvedValueOnce(MAINTENANCE_DETAIL);

      await renderByModule();
      fireEvent.click(screen.getByTestId("by-module-expand-MAINTENANCE"));
      fireEvent.click(
        screen.getByTestId("by-module-show-transactions-MAINTENANCE"),
      );

      await waitFor(() =>
        expect(mockGetProfitModuleDetail).toHaveBeenCalledWith(
          "MAINTENANCE",
          expect.any(String),
          expect.any(String),
        ),
      );

      const table = await screen.findByTestId(
        "by-module-transactions-counted-MAINTENANCE",
      );
      expect(table.textContent).toContain("60 USD");

      const split = await screen.findByTestId(
        "by-module-transactions-parts-labour-MAINTENANCE-11",
      );
      expect(split.textContent).toContain("50 USD");
      expect(split.textContent).toContain("40 USD");
      expect(split.textContent).toContain("10 USD");
    });

    it("renders 'Show transactions' for a profit-only module (KEPT_CHANGE) and shows the counted profit + not-counted reason", async () => {
      mockGetProfitByModule.mockResolvedValueOnce([KEPT_CHANGE_ROW]);
      mockGetProfitModuleDetail.mockResolvedValueOnce(KEPT_CHANGE_DETAIL);

      await renderByModule();
      fireEvent.click(screen.getByTestId("by-module-expand-KEPT_CHANGE"));
      fireEvent.click(
        screen.getByTestId("by-module-show-transactions-KEPT_CHANGE"),
      );

      await waitFor(() =>
        expect(mockGetProfitModuleDetail).toHaveBeenCalledWith(
          "KEPT_CHANGE",
          expect.any(String),
          expect.any(String),
        ),
      );

      const table = await screen.findByTestId(
        "by-module-transactions-counted-KEPT_CHANGE",
      );
      expect(table.textContent).toContain("3 USD");

      const notCounted = await screen.findByTestId(
        "by-module-transactions-not-counted-KEPT_CHANGE",
      );
      expect(notCounted.textContent).toContain(
        "Sale #56 still pending settlement.",
      );
    });

    // LIRA-233 (#14 slice 3 review round, finding 2) — a transfer row's
    // `financial_services.id` and a settlement_allocation row's
    // `settlement_commission_allocations.id` are independent sequences that
    // CAN collide; keying the list by bare `id` (pre-fix) makes React log a
    // "two children with the same key" warning and risks losing one row on a
    // later re-render. Failing-first: this spies on console.error and asserts
    // NO such warning fires when two rows share id=5.
    it("keys FINANCIAL_SERVICE_<provider> rows by source+id, never a bare duplicate id (finding 2)", async () => {
      mockGetProfitByModule.mockResolvedValueOnce([FS_ROW]);
      mockGetProfitModuleDetail.mockResolvedValueOnce(FS_DETAIL_DUPLICATE_IDS);
      const errorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      try {
        await renderByModule();
        fireEvent.click(
          screen.getByTestId("by-module-expand-FINANCIAL_SERVICE_OMT"),
        );
        fireEvent.click(
          screen.getByTestId(
            "by-module-show-transactions-FINANCIAL_SERVICE_OMT",
          ),
        );

        const table = await screen.findByTestId(
          "by-module-transactions-counted-FINANCIAL_SERVICE_OMT",
        );
        // Both duplicate-id rows must render distinctly.
        expect(table.textContent).toContain("SEND transfer");
        expect(table.textContent).toContain(
          "SEND transfer (settlement allocation)",
        );

        const duplicateKeyWarning = errorSpy.mock.calls.some((call) =>
          call.some(
            (arg) =>
              typeof arg === "string" &&
              arg.includes("two children with the same key"),
          ),
        );
        expect(duplicateKeyWarning).toBe(false);
      } finally {
        errorSpy.mockRestore();
      }
    });

    // LIRA-233 (#14 slice 3 review round, finding 4) — a not-counted row used
    // to show only date/client/reason; the row's OWN detail label and amount
    // were invisible, so two different not-counted rows (or a not-counted row
    // and its counted sibling above) were indistinguishable except by reason
    // text.
    it("shows the not-counted row's detail label and amount, not just its reason (finding 4)", async () => {
      mockGetProfitByModule.mockResolvedValueOnce([FS_ROW]);
      mockGetProfitModuleDetail.mockResolvedValueOnce(FS_DETAIL_DUPLICATE_IDS);

      await renderByModule();
      fireEvent.click(
        screen.getByTestId("by-module-expand-FINANCIAL_SERVICE_OMT"),
      );
      fireEvent.click(
        screen.getByTestId("by-module-show-transactions-FINANCIAL_SERVICE_OMT"),
      );

      const notCounted = await screen.findByTestId(
        "by-module-transactions-not-counted-FINANCIAL_SERVICE_OMT",
      );
      expect(notCounted.textContent).toContain("EUR transfer");
      expect(notCounted.textContent).toContain("4 USD");
      expect(notCounted.textContent).toContain(
        "This transfer's currency isn't tracked as USD or LBP.",
      );
    });

    // LIRA-233 (#14 slice 3 review round, finding 9) — every `fee_note` used
    // to render `text-red-400` unconditionally, so LOTO's positive kept-change
    // note read as a deduction. An "info"-kind note must NOT carry the red
    // fee-deduction class.
    it("renders an info-kind fee_note in a neutral colour, not the fee-deduction red (finding 9)", async () => {
      mockGetProfitByModule.mockResolvedValueOnce([
        {
          module: "KEPT_CHANGE",
          label: "Kept Change",
          revenue_usd: 0,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: 1,
          profit_lbp: 0,
          count: 1,
          margin_pct: undefined,
          margin_converted: false,
        },
      ]);
      mockGetProfitModuleDetail.mockResolvedValueOnce(
        KEPT_CHANGE_INFO_NOTE_DETAIL,
      );

      await renderByModule();
      fireEvent.click(screen.getByTestId("by-module-expand-KEPT_CHANGE"));
      fireEvent.click(
        screen.getByTestId("by-module-show-transactions-KEPT_CHANGE"),
      );

      const table = await screen.findByTestId(
        "by-module-transactions-counted-KEPT_CHANGE",
      );
      const note = await waitFor(() => {
        const el = Array.from(table.querySelectorAll("span")).find((span) =>
          span.textContent?.includes("kept change +1 USD"),
        );
        if (!el) throw new Error("info note span not found");
        return el;
      });
      expect(note.className).not.toContain("text-red-400");
    });
  });
});
