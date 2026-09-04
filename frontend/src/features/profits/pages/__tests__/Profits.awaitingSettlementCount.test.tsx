/** @jest-environment jsdom */

/**
 * LIRA-159 D2 — Commissions tab, `getUnsettledSummaryByProvider` render.
 *
 * The core method's `UnsettledSummary` row is gaining `awaiting_settlement_count`
 * and narrowing `pending_commission_usd`/`_lbp` to LEGACY-model-only
 * (`commission_model = 0`) — 0 for a provider whose unsettled rows are all
 * post-cutover (`commission_model = 1`). Owner decision D15: a model-1 row's
 * commission is UNKNOWABLE until the operator enters it at settlement, so
 * these surfaces must show a COUNT ("N awaiting settlement"), never a
 * dollar figure — and never a fabricated `$0.00`/`$0.0000` standing in for
 * an unknown amount.
 *
 * Two render sites under test, both fed by `unsettledByProvider`
 * (`api.getUnsettledSummary()`):
 *   1. Provider Performance (Today) table's "Commission (Pending)" column
 *      and Status badge.
 *   2. The "Revenue by Provider" pie card's caption — the pie itself is a
 *      dollar-amount axis (fed by legacy `pending_commission_usd` only, via
 *      the mocked-out CommissionsChart below), so a provider whose pending
 *      commission is entirely model-1 would otherwise be invisible; the
 *      caption is how it surfaces instead.
 *
 * This drives the REAL `Profits` page with the REAL `DataTable` (@liratek/ui)
 * — only `useApi`, `useModules` and `useCurrencyContext` are mocked, matching
 * this directory's existing convention (Profits.pendingSettlementCount.test.tsx)
 * — so a wiring mistake in the JSX itself would be caught.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetOMTAnalytics = jest.fn();
const mockGetUnsettledSummary = jest.fn();

const mockApi = {
  getOMTAnalytics: mockGetOMTAnalytics,
  getUnsettledSummary: mockGetUnsettledSummary,
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

// The chart uses recharts via React.lazy + Suspense; it lives in a sibling
// boundary from the table/caption under test and is stubbed out purely to
// avoid pulling recharts into this render (matches the precedent tests in
// this directory).
jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderCommissionsTab() {
  const utils = render(<Profits />);
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /commissions/i }));
  await waitFor(() => expect(mockGetOMTAnalytics).toHaveBeenCalledTimes(1));
  await screen.findByText("Provider Performance (Today)");
  return utils;
}

/** Find a "Provider Performance" row by exact provider name and return its
 *  <td> cells in column order. */
function providerRowCells(
  container: HTMLElement,
  provider: string,
): HTMLTableCellElement[] {
  const rows = Array.from(
    container.querySelectorAll('[data-testid="data-table"] tbody tr'),
  );
  const row = rows.find((r) => r.querySelector("td")?.textContent === provider);
  if (!row) {
    throw new Error(`No provider row found for "${provider}"`);
  }
  return Array.from(row.querySelectorAll("td"));
}

function byProvider(provider: string, commission: number, count: number) {
  return { provider, commission, currency: "USD", count };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests — Provider Performance (Today) table, "Commission (Pending)" column
// ---------------------------------------------------------------------------

describe("Profits — Commissions tab, Provider Performance Commission (Pending) column (LIRA-159 D2)", () => {
  it("shows a COUNT, never a fabricated dollar, for a provider whose pending commission is entirely model-1", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: { commission: 0, pending_commission: 0, count: 5 },
      month: { commission: 0, pending_commission: 0, count: 5 },
      byProvider: [byProvider("OMT", 0, 5)],
    });
    mockGetUnsettledSummary.mockResolvedValueOnce([
      {
        provider: "OMT",
        count: 5,
        bill_count: 0,
        pending_commission_usd: 0,
        pending_commission_lbp: 0,
        total_owed_usd: 100,
        total_owed_lbp: 0,
        awaiting_settlement_count: 3,
      },
    ]);

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "OMT");

    expect(cells[3].textContent).toContain("3 awaiting settlement");
    expect(cells[3].textContent).not.toMatch(/\$0\.00/);
  });

  it("still renders the legacy dollar figure for a model-0-only provider", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: { commission: 2.5, pending_commission: 0, count: 2 },
      month: { commission: 2.5, pending_commission: 0, count: 2 },
      byProvider: [byProvider("WHISH", 2.5, 2)],
    });
    mockGetUnsettledSummary.mockResolvedValueOnce([
      {
        provider: "WHISH",
        count: 2,
        bill_count: 0,
        pending_commission_usd: 2.5,
        pending_commission_lbp: 0,
        total_owed_usd: 50,
        total_owed_lbp: 0,
        awaiting_settlement_count: 0,
      },
    ]);

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "WHISH");

    expect(cells[3].textContent).toContain("$2.5000");
    expect(cells[3].textContent).not.toContain("awaiting settlement");
  });

  it("renders both the legacy dollar and the awaiting-settlement count for a mixed provider", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: { commission: 4, pending_commission: 0, count: 3 },
      month: { commission: 4, pending_commission: 0, count: 3 },
      byProvider: [byProvider("BINANCE", 4, 3)],
    });
    mockGetUnsettledSummary.mockResolvedValueOnce([
      {
        provider: "BINANCE",
        count: 3,
        bill_count: 0,
        pending_commission_usd: 4,
        pending_commission_lbp: 0,
        total_owed_usd: 80,
        total_owed_lbp: 0,
        awaiting_settlement_count: 2,
      },
    ]);

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "BINANCE");

    expect(cells[3].textContent).toContain("$4.0000");
    expect(cells[3].textContent).toContain("2 awaiting settlement");
  });
});

// ---------------------------------------------------------------------------
// Tests — Revenue by Provider pie card caption
// ---------------------------------------------------------------------------

describe("Profits — Commissions tab, Revenue by Provider caption (LIRA-159 D2)", () => {
  it("surfaces the total awaiting-settlement count when a provider's pending commission is entirely model-1", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: { commission: 0, pending_commission: 0, count: 5 },
      month: { commission: 0, pending_commission: 0, count: 5 },
      byProvider: [byProvider("OMT", 0, 5)],
    });
    mockGetUnsettledSummary.mockResolvedValueOnce([
      {
        provider: "OMT",
        count: 5,
        bill_count: 0,
        pending_commission_usd: 0,
        pending_commission_lbp: 0,
        total_owed_usd: 100,
        total_owed_lbp: 0,
        awaiting_settlement_count: 3,
      },
    ]);

    await renderCommissionsTab();

    // The "3 awaiting settlement" string legitimately renders twice now —
    // once in the Provider Performance table cell (asserted in the describe
    // block above) and once in this chart card's caption. getByText would
    // throw on the ambiguity; scope to the caption's own data-testid so this
    // assertion is specific to the surface this describe block is about —
    // and so it FAILS (element not found) if the caption itself regresses,
    // rather than silently passing on the table cell's copy of the text.
    expect(
      screen.getByTestId("revenue-by-provider-awaiting-caption").textContent,
    ).toContain("3 awaiting settlement");
  });

  it("omits the caption when every provider's pending commission is a legacy dollar figure", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: { commission: 2.5, pending_commission: 0, count: 2 },
      month: { commission: 2.5, pending_commission: 0, count: 2 },
      byProvider: [byProvider("WHISH", 2.5, 2)],
    });
    mockGetUnsettledSummary.mockResolvedValueOnce([
      {
        provider: "WHISH",
        count: 2,
        bill_count: 0,
        pending_commission_usd: 2.5,
        pending_commission_lbp: 0,
        total_owed_usd: 50,
        total_owed_lbp: 0,
        awaiting_settlement_count: 0,
      },
    ]);

    await renderCommissionsTab();

    expect(screen.queryByText(/awaiting settlement/)).not.toBeInTheDocument();
  });
});
