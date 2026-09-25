/** @jest-environment jsdom */

/**
 * Lane LO — OWNER_NOTES_2026-09-21.md §6 audit batches 2–4, By Module tab.
 *
 * Covers: PA-2.9 (cost columns), PA-4.5 (sign-colored USD profit column),
 * PA-4.12 (TOTAL footer, Count-0 caption — server-side sort/labels are
 * covered by the core-side test suite, not re-tested here), PA-4.16 (visible
 * error state instead of a silent empty table), PA-4.21 (server-computed
 * margin column replaces the old client-side USD-only formatPct),
 * PA-4.23 (expandable Revenue − Cost = Profit rows + maintenance
 * parts/labour split, footer Σ).
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked).
 */

import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProfitByModule = jest.fn();
// LO-V8 (round 2 adversarial review) — the By Module tab now ALSO co-fetches
// getProfitSummary (for the new footer's Σ gross − expenses = net line,
// LO-V4/LO-V8 below). Mocked here as a normal resolving promise so it races
// getProfitByModule the same way it does in production, rather than
// throwing synchronously (api.getProfitSummary undefined) BEFORE
// getProfitByModule's own mocked promise settles — that asymmetry could
// flip `loading` to false while `byModule` was still `[]`, making every
// other test in this file flaky.
const mockGetProfitSummary = jest.fn().mockResolvedValue(null);

const mockApi = {
  getProfitByModule: mockGetProfitByModule,
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
});

// ---------------------------------------------------------------------------
// PA-2.9 — cost columns
// ---------------------------------------------------------------------------

describe("Profits By Module — PA-2.9 cost columns", () => {
  it("shows Cost (USD) and Cost (LBP) headers and values, previously always 0/hidden", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "FINANCIAL_SERVICE_OMT",
        label: "OMT",
        revenue_usd: 100,
        revenue_lbp: 0,
        cost_usd: 7,
        cost_lbp: 0,
        profit_usd: 5,
        profit_lbp: 0,
        count: 3,
        margin_pct: 5,
        margin_converted: false,
      },
    ]);

    await renderByModule();

    expect(screen.getByText("Cost (USD)")).toBeInTheDocument();
    expect(screen.getByText("Cost (LBP)")).toBeInTheDocument();
    // "7 USD" appears twice: the row's own Cost (USD) cell AND the TOTAL
    // footer (only row, so its total equals the row). The row renders
    // first in DOM order.
    const matches = screen.getAllByText("7 USD");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// PA-4.5 — sign-colored USD profit column
// ---------------------------------------------------------------------------

describe("Profits By Module — PA-4.5 loss visibility (USD column)", () => {
  it("renders a negative USD profit in red, not the hard-coded emerald", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 10,
        revenue_lbp: 0,
        cost_usd: 15,
        cost_lbp: 0,
        profit_usd: -5,
        profit_lbp: 0,
        count: 1,
        margin_pct: -50,
        margin_converted: false,
      },
    ]);

    await renderByModule();

    // "-5 USD" appears in both the row cell and the (single-row) TOTAL
    // footer; both must be red — assert the row cell specifically (first in
    // DOM order) plus that every match is red.
    const matches = await screen.findAllByText("-5 USD");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    for (const el of matches) {
      expect(el.className).toContain("text-red-400");
    }
  });
});

// ---------------------------------------------------------------------------
// PA-4.16 — visible error state
// ---------------------------------------------------------------------------

describe("Profits By Module — PA-4.16 error visibility", () => {
  it("shows a visible error, not the empty-data message, when the fetch rejects", async () => {
    mockGetProfitByModule.mockRejectedValueOnce(new Error("boom"));

    render(<Profits />);
    fireEvent.click(screen.getByText("By Module"));
    await waitFor(() =>
      expect(mockGetProfitByModule).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );

    // Pre-fix: getByModule threw (per the data lane's PA-4.16 rethrow), the
    // old catch swallowed it into setByModule([]), and the DataTable
    // rendered "No data for this period" — indistinguishable from a real
    // no-activity period.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/failed to load profit by module/i)).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(
      screen.queryByText("No data for this period"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PA-4.21 — server-computed margin column
// ---------------------------------------------------------------------------

describe("Profits By Module — PA-4.21 server-computed margin", () => {
  it("shows an exact margin for a single-currency (LBP-only) row instead of the old USD-only 0%", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "LOTO",
        label: "Loto Tickets",
        revenue_usd: 0,
        revenue_lbp: 1000000,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 100000,
        count: 5,
        margin_pct: 10,
        margin_converted: false,
      },
    ]);

    await renderByModule();

    // Pre-fix: formatPct(row.profit_usd, row.revenue_usd) = formatPct(0, 0)
    // = "0%" for every LBP-only row, regardless of its real margin. "10.0%"
    // appears twice (row cell + single-row TOTAL footer, whose margin is
    // computed independently from the same underlying totals and happens
    // to match here) — both are the fix, not a collision to worry about.
    expect(screen.getAllByText("10.0%").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows an em dash and never a fabricated ratio when margin_pct is null", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "CUSTOM_SERVICE",
        label: "Custom Services",
        revenue_usd: 10,
        revenue_lbp: 50000,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 10,
        profit_lbp: 50000,
        count: 1,
        margin_pct: null,
        margin_converted: true,
      },
    ]);

    await renderByModule();

    // "—" also appears in the (zero) Cost columns for this fixture — assert
    // at least one em dash rendered (the margin cell) and, crucially, that
    // no fabricated percentage (e.g. "0%") appeared instead.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/^\d.*%$/)).not.toBeInTheDocument();
  });

  it("marks a converted (mixed-currency) margin with ≈", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "CUSTOM_SERVICE",
        label: "Custom Services",
        revenue_usd: 10,
        revenue_lbp: 50000,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 10,
        profit_lbp: 50000,
        count: 1,
        margin_pct: 42,
        margin_converted: true,
      },
    ]);

    await renderByModule();

    expect(screen.getByText("≈ 42.0%")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PA-4.23 — expandable rows + maintenance parts/labour + footer
// ---------------------------------------------------------------------------

describe("Profits By Module — PA-4.23 expandable rows and footer", () => {
  it("expands a row on click to show Revenue − Cost = Profit per currency", async () => {
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

    await renderByModule();

    expect(
      screen.queryByTestId("by-module-detail-RECHARGE"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("by-module-expand-RECHARGE"));

    const detail = await screen.findByTestId("by-module-detail-RECHARGE");
    expect(detail.textContent).toContain("100 USD");
    expect(detail.textContent).toContain("80 USD");
    expect(detail.textContent).toContain("20 USD");
  });

  it("shows the maintenance parts/labour split when expanded — computed since LIRA-176, never rendered before", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
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
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-MAINTENANCE"));

    const split = await screen.findByTestId(
      "by-module-maintenance-parts-labour",
    );
    expect(split.textContent).toContain("50 USD");
    expect(split.textContent).toContain("40 USD");
    expect(split.textContent).toContain("10 USD");
  });

  it("renders a TOTAL footer row summing every module — previously absent entirely", async () => {
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

    await renderByModule();

    const footer = await screen.findByTestId("by-module-total-row");
    expect(footer.textContent).toContain("TOTAL");
    expect(footer.textContent).toContain("100 USD");
    expect(footer.textContent).toContain("200000 LBP");
    expect(footer.textContent).toContain("40 USD");
    expect(footer.textContent).toContain("20000 LBP");
    // count column: 2 + 3 = 5 — read the Count <td> directly (index 7:
    // Module, RevUSD, RevLBP, CostUSD, CostLBP, ProfitUSD, ProfitLBP,
    // Count, Margin) rather than regex-matching the concatenated
    // textContent, where "LBP" + "5" abut with no word boundary.
    const cells = footer.querySelectorAll("td");
    expect(cells[7].textContent).toBe("5");
  });
});

// ---------------------------------------------------------------------------
// LO-loading-race (OWNER_NOTES_2026-09-21.md §6.6 round 4; open_LO.txt) —
// loadByModule and loadSummary co-fire on this tab; `loading` must stay true
// until BOTH have settled, not whichever settles first.
// ---------------------------------------------------------------------------

describe("Profits By Module — LO-loading-race", () => {
  it("stays in the loading state (table unrendered) after getProfitSummary settles while getProfitByModule is still in flight, and only clears once BOTH have settled", async () => {
    // NOT RUN tonight — red/green proof pending (tomorrow). Pre-fix, each
    // loader called plain setLoading(true)/setLoading(false) on the SAME
    // boolean: whichever of the two co-fired fetches resolved FIRST flipped
    // `loading` false via its own finally block, even while the OTHER fetch
    // was still in flight for the new date range. This deterministically
    // resolves the mount-time overview call first (never held open — it is
    // not part of the race under test), then holds BOTH the by-module
    // tab-switch's getProfitSummary call and getProfitByModule open, and
    // resolves the summary call first (the scenario that broke pre-fix) —
    // the by-module fetch is still pending at that point, so the page must
    // still read "Loading..." with no (stale/empty) TOTAL row.
    let resolveSecondSummary!: (v: unknown) => void;
    mockGetProfitSummary
      .mockResolvedValueOnce(null) // mount-time overview call — not under test
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondSummary = resolve;
          }),
      );
    let resolveByModule!: (v: unknown[]) => void;
    mockGetProfitByModule.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveByModule = resolve;
        }),
    );

    render(<Profits />);
    fireEvent.click(screen.getByText("By Module"));

    await waitFor(() =>
      expect(mockGetProfitByModule).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(mockGetProfitSummary).toHaveBeenCalledTimes(2),
    );

    // Resolve the FASTER of the two co-fired fetches (summary) first.
    await act(async () => {
      resolveSecondSummary(null);
    });

    // getProfitByModule is STILL pending — a last-write-wins `loading` flag
    // would have flipped false here already (the exact pre-fix bug); the
    // counter-based fix must keep it true.
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(
      screen.queryByTestId("by-module-total-row"),
    ).not.toBeInTheDocument();

    // Now resolve the slower fetch — only NOW should loading clear.
    await act(async () => {
      resolveByModule([]);
    });

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
  });
});
