/** @jest-environment jsdom */

/**
 * LIRA-159 D2 — Commissions tab, "N awaiting settlement" render (owner
 * decision D15: a model-1 row's commission is UNKNOWABLE until the operator
 * enters it at settlement, so these surfaces must show a COUNT, never a
 * fabricated `$0.00`/`$0.0000` standing in for an unknown amount).
 *
 * UPDATED (OWNER_NOTES_2026-09-21.md §6, lane LC): rewritten from
 * `api.getOMTAnalytics()`/`api.getUnsettledSummary()` mocks to
 * `api.getProfitsCommissions(from, to)` — see
 * Profits.commissionsAnalyticsAwaitingSettlement.test.tsx's header for the
 * full rationale (rule 24). The two `CommissionProviderRow` fields under
 * test here (`pending_usd`/`_lbp` and `awaiting_settlement_count`) are the
 * direct successors of the old `pending_commission_usd`/`_lbp` and
 * `awaiting_settlement_count` on `UnsettledSummary` — same LIRA-159/D15
 * meaning, sourced the same way (FinancialServiceRepository
 * .getUnsettledSummaryByProvider, untouched by this lane).
 *
 * Two render sites under test, both fed by the SAME `commissionsReport`:
 *   1. Provider Performance table's "Pending (now)" column and Status badge.
 *   2. The "Revenue by Provider" pie card's caption — the pie itself is a
 *      USD-only revenue axis (CommissionsChart, mocked out below), so a
 *      provider whose pending commission is entirely model-1 would
 *      otherwise be invisible there; the caption is how it surfaces.
 *
 * This drives the REAL `Profits` page with the REAL `DataTable` (@liratek/ui)
 * — only `useApi`, `useModules` and `useCurrencyContext` are mocked, matching
 * this directory's existing convention — so a wiring mistake in the JSX
 * itself would be caught.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";
import type { CommissionsReport } from "@liratek/ui";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProfitsCommissions = jest.fn();

const mockApi = {
  getProfitsCommissions: mockGetProfitsCommissions,
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

function report(byProvider: CommissionsReport["byProvider"]): CommissionsReport {
  const awaiting_settlement_count = byProvider.reduce(
    (sum, p) => sum + p.awaiting_settlement_count,
    0,
  );
  return {
    from: "2026-09-01",
    to: "2026-09-30",
    realized_usd: byProvider.reduce((s, p) => s + p.realized_usd, 0),
    realized_lbp: byProvider.reduce((s, p) => s + p.realized_lbp, 0),
    revenue_usd: byProvider.reduce((s, p) => s + p.revenue_usd, 0),
    revenue_lbp: byProvider.reduce((s, p) => s + p.revenue_lbp, 0),
    pending_usd: byProvider.reduce((s, p) => s + p.pending_usd, 0),
    pending_lbp: byProvider.reduce((s, p) => s + p.pending_lbp, 0),
    total_owed_usd: byProvider.reduce((s, p) => s + p.total_owed_usd, 0),
    total_owed_lbp: byProvider.reduce((s, p) => s + p.total_owed_lbp, 0),
    awaiting_settlement_count,
    bill_count: byProvider.reduce((s, p) => s + p.bill_count, 0),
    byProvider,
  };
}

function providerRow(
  provider: string,
  overrides: Partial<CommissionsReport["byProvider"][number]> = {},
): CommissionsReport["byProvider"][number] {
  return {
    provider: provider as CommissionsReport["byProvider"][number]["provider"],
    realized_usd: 0,
    realized_lbp: 0,
    revenue_usd: 0,
    revenue_lbp: 0,
    count: 0,
    pending_usd: 0,
    pending_lbp: 0,
    total_owed_usd: 0,
    total_owed_lbp: 0,
    awaiting_settlement_count: 0,
    bill_count: 0,
    ...overrides,
  };
}

async function renderCommissionsTab() {
  const utils = render(<Profits />);
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /commissions/i }));
  await waitFor(() =>
    expect(mockGetProfitsCommissions).toHaveBeenCalledTimes(1),
  );
  await screen.findByText(/Provider Performance/);
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

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests — Provider Performance table, "Pending (now)" column
// ---------------------------------------------------------------------------

describe("Profits — Commissions tab, Provider Performance Pending (now) column (LIRA-159 D2)", () => {
  it("shows a COUNT, never a fabricated dollar, for a provider whose pending commission is entirely model-1", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report([
        providerRow("OMT", { count: 5, awaiting_settlement_count: 3 }),
      ]),
    );

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "OMT");

    expect(cells[3].textContent).toContain("3 awaiting settlement");
    expect(cells[3].textContent).not.toMatch(/\$0\.00/);
  });

  it("still renders the real pending dollar figure for a legacy-model provider", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report([
        providerRow("WHISH", {
          count: 2,
          pending_usd: 2.5,
          awaiting_settlement_count: 0,
        }),
      ]),
    );

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "WHISH");

    expect(cells[3].textContent).toContain("2.5 USD");
    expect(cells[3].textContent).not.toContain("awaiting settlement");
  });

  it("renders both the pending dollar and the awaiting-settlement count for a mixed provider", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report([
        providerRow("BINANCE", {
          count: 3,
          pending_usd: 4,
          awaiting_settlement_count: 2,
        }),
      ]),
    );

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "BINANCE");

    expect(cells[3].textContent).toContain("4 USD");
    expect(cells[3].textContent).toContain("2 awaiting settlement");
  });
});

// ---------------------------------------------------------------------------
// Tests — Revenue by Provider pie card caption
// ---------------------------------------------------------------------------

describe("Profits — Commissions tab, Revenue by Provider caption (LIRA-159 D2)", () => {
  it("surfaces the total awaiting-settlement count when a provider's pending commission is entirely model-1", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report([
        providerRow("OMT", { count: 5, awaiting_settlement_count: 3 }),
      ]),
    );

    await renderCommissionsTab();

    // The "3 awaiting settlement" string legitimately renders twice now —
    // once in the Provider Performance table cell (asserted above) and once
    // in this chart card's caption. getByText would throw on the ambiguity;
    // scope to the caption's own data-testid so this assertion is specific
    // to the surface this describe block is about — and so it FAILS
    // (element not found) if the caption itself regresses, rather than
    // silently passing on the table cell's copy of the text.
    expect(
      screen.getByTestId("revenue-by-provider-awaiting-caption").textContent,
    ).toContain("3 awaiting settlement");
  });

  it("omits the caption when every provider's pending commission is a legacy dollar figure", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report([
        providerRow("WHISH", {
          count: 2,
          pending_usd: 2.5,
          awaiting_settlement_count: 0,
        }),
      ]),
    );

    await renderCommissionsTab();

    expect(screen.queryByText(/awaiting settlement/)).not.toBeInTheDocument();
  });
});
