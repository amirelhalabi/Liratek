/** @jest-environment jsdom */

/**
 * Lane LO — OWNER_NOTES_2026-09-21.md §6 audit batches 2–4, By Date tab.
 *
 * Covers: PA-4.13 (chart reversed to chronological left-to-right — the
 * server returns dates newest-first, `ORDER BY dates.d DESC`, and the chart
 * used to map that straight into bar order, reading backwards in time),
 * PA-4.14 (expenses_lbp / net_profit_lbp rendered — already returned by
 * getByDate and simply never shown), PA-4.5 (sign-colored profit, not
 * hard-coded emerald), PA-4.16 (visible error state).
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked).
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProfitByDate = jest.fn();

const mockApi = {
  getProfitByDate: mockGetProfitByDate,
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

async function renderByDate() {
  const utils = render(<Profits />);
  fireEvent.click(screen.getByText("By Date"));
  await waitFor(() => expect(mockGetProfitByDate).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// PA-4.13 — chart reversed to chronological order
// ---------------------------------------------------------------------------

describe("Profits By Date — PA-4.13 chart chronological order", () => {
  it("renders the earliest date on the left and the latest on the right, given server DESC order", async () => {
    // The server returns newest-first (`ORDER BY dates.d DESC`) — this is
    // the exact shape getByDate sends today.
    mockGetProfitByDate.mockResolvedValueOnce([
      {
        date: "2026-08-03",
        revenue_usd: 30,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 30,
        profit_lbp: 0,
        expenses_usd: 0,
        expenses_lbp: 0,
        net_profit_usd: 30,
        net_profit_lbp: 0,
      },
      {
        date: "2026-08-02",
        revenue_usd: 20,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 20,
        profit_lbp: 0,
        expenses_usd: 0,
        expenses_lbp: 0,
        net_profit_usd: 20,
        net_profit_lbp: 0,
      },
      {
        date: "2026-08-01",
        revenue_usd: 10,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 10,
        profit_lbp: 0,
        expenses_usd: 0,
        expenses_lbp: 0,
        net_profit_usd: 10,
        net_profit_lbp: 0,
      },
    ]);

    await renderByDate();

    const chart = await screen.findByTestId("by-date-chart");
    const bars = chart.querySelectorAll('[data-testid^="by-date-bar-"]');
    // Pre-fix: the chart mapped byDate directly, so the DOM order was
    // 08-03, 08-02, 08-01 (newest left) — backwards in time. Fixed: the
    // chart-only array is reversed, so the DOM order is chronological.
    expect(bars[0].getAttribute("data-testid")).toBe("by-date-bar-2026-08-01");
    expect(bars[1].getAttribute("data-testid")).toBe("by-date-bar-2026-08-02");
    expect(bars[2].getAttribute("data-testid")).toBe("by-date-bar-2026-08-03");

    // The date-range labels beneath the chart follow the same (corrected)
    // order. Each date text also appears in the table below, so use
    // getAllByText rather than asserting uniqueness.
    expect(screen.getAllByText("2026-08-01").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("2026-08-03").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// PA-4.14 — expenses_lbp / net_profit_lbp rendered
// ---------------------------------------------------------------------------

describe("Profits By Date — PA-4.14 LBP columns", () => {
  it("shows expenses_lbp and net_profit_lbp, already returned but never rendered", async () => {
    mockGetProfitByDate.mockResolvedValueOnce([
      {
        date: "2026-08-01",
        revenue_usd: 0,
        revenue_lbp: 100000,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 40000,
        expenses_usd: 0,
        expenses_lbp: 15000,
        net_profit_usd: 0,
        net_profit_lbp: 25000,
      },
    ]);

    await renderByDate();

    expect(screen.getByText("Expenses (LBP)")).toBeInTheDocument();
    expect(screen.getByText("Net Profit (LBP)")).toBeInTheDocument();
    // Both figures appear twice: the row's own cell AND the (single-row)
    // TOTAL footer, whose sum equals the row.
    expect(screen.getAllByText("-15000 LBP").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("25000 LBP").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// PA-4.5 — sign-colored profit (not hard-coded emerald)
// ---------------------------------------------------------------------------

describe("Profits By Date — PA-4.5 loss visibility", () => {
  it("renders a negative day (USD) in red, not the hard-coded emerald", async () => {
    mockGetProfitByDate.mockResolvedValueOnce([
      {
        date: "2026-08-01",
        revenue_usd: 5,
        revenue_lbp: 0,
        cost_usd: 20,
        cost_lbp: 0,
        profit_usd: -15,
        profit_lbp: 0,
        expenses_usd: 0,
        expenses_lbp: 0,
        net_profit_usd: -15,
        net_profit_lbp: 0,
      },
    ]);

    await renderByDate();

    const matches = await screen.findAllByText("-15 USD");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    for (const el of matches) {
      expect(el.className).toContain("text-red-400");
    }
  });
});

// ---------------------------------------------------------------------------
// PA-4.16 — visible error state
// ---------------------------------------------------------------------------

describe("Profits By Date — PA-4.16 error visibility", () => {
  it("shows a visible error, not the empty-data message, when the fetch rejects", async () => {
    mockGetProfitByDate.mockRejectedValueOnce(new Error("kaboom"));

    render(<Profits />);
    fireEvent.click(screen.getByText("By Date"));
    await waitFor(() => expect(mockGetProfitByDate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/failed to load profit by date/i),
    ).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    expect(
      screen.queryByText("No data for this period"),
    ).not.toBeInTheDocument();
  });
});
