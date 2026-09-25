/** @jest-environment jsdom */

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
  await waitFor(() =>
    expect(mockGetProfitByModule).toHaveBeenCalledTimes(1),
  );
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
