/** @jest-environment jsdom */

/**
 * LIRA-158 Phase 2b (D15) — "By Payment Method" tab, Commission Pending
 * Settlement row.
 *
 * Owner decision D15: a commission_model = 1 row's pending commission is
 * UNKNOWABLE until the operator enters it at settlement, so it must surface
 * as a COUNT ("N transactions awaiting settlement"), never a dollar figure.
 * Legacy commission_model = 0 rows keep their dollar figure. Both can be
 * present in the same period, and neither may hide the other.
 *
 * This drives the REAL `Profits` page with the REAL `DataTable` (@liratek/ui)
 * — only `useApi`, `useModules` and `useCurrencyContext` are mocked — so a
 * wiring mistake in the row's JSX (not just the service assembling the row)
 * would be caught, matching the layer-seam testing lesson recorded for this
 * repo (a props-level assertion on a helper alone would not catch it).
 *
 * Also covers the companion display fix in the "Commissions" tab's
 * "Provider Performance (Today)" table: Phase 2a made the per-provider
 * `commission` figure commission_model=0-only while `count` stayed
 * unrestricted, so an all-model-1 provider used to render "10 / $0.00" —
 * indistinguishable from ten transactions that genuinely earned nothing.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProfitByPaymentMethod = jest.fn();
const mockGetOMTAnalytics = jest.fn();
const mockGetUnsettledSummary = jest.fn();

const mockApi = {
  getProfitByPaymentMethod: mockGetProfitByPaymentMethod,
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
// boundary from the tables under test and is stubbed out purely to avoid
// pulling recharts into this render.
jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderPage() {
  const utils = render(<Profits />);
  // Let the initial (Overview) tab's fetch attempt settle before switching —
  // getProfitSummary is intentionally unmocked (not under test) and its
  // rejection is swallowed by the page's own try/catch.
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  return utils;
}

/** Find a "By Payment Method" row by a substring of its method label, and
 *  return its <td> cells in column order. Avoids screen.getByText on the
 *  method cell, which would ambiguously match both the <td> and its
 *  wrapping <div> (both share the same textContent). */
function paymentRowCells(
  container: HTMLElement,
  methodSubstring: string,
): HTMLTableCellElement[] {
  const rows = Array.from(
    container.querySelectorAll('[data-testid="data-table"] tbody tr'),
  );
  const row = rows.find((r) =>
    r.querySelector("td")?.textContent?.includes(methodSubstring),
  );
  if (!row) {
    throw new Error(`No payment-method row found containing "${methodSubstring}"`);
  }
  return Array.from(row.querySelectorAll("td"));
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
// Tests
// ---------------------------------------------------------------------------

describe("Profits — By Payment Method tab, D15 pending-settlement count", () => {
  it("shows a COUNT (not $0.00) when every pending row is commission_model=1", async () => {
    mockGetProfitByPaymentMethod.mockResolvedValueOnce([
      {
        method: "Commission Pending Settlement (OMT 3 awaiting settlement)",
        total_usd: 0,
        total_lbp: 0,
        count: 0,
        pending_commission_usd: 0,
        pending_commission_lbp: 0,
        awaiting_settlement_count: 3,
        is_settled: 0,
      },
    ]);

    const { container } = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by payment method/i }));
    await waitFor(() =>
      expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(1),
    );
    await screen.findByText(/Commission Pending Settlement/);

    const cells = paymentRowCells(container, "Commission Pending Settlement");
    // Total (USD) column: count, never a dollar figure, for an all-model-1 row.
    expect(cells[1].textContent).toContain(
      "3 transactions awaiting settlement",
    );
    expect(cells[1].textContent).not.toContain("$0.00");
    expect(cells[1].textContent).not.toMatch(/\$0\.0000/);
  });

  it("shows BOTH the legacy dollar figure and the awaiting-settlement count in a mixed period", async () => {
    mockGetProfitByPaymentMethod.mockResolvedValueOnce([
      {
        method:
          "Commission Pending Settlement (OMT $12.50, WHISH 2 awaiting settlement)",
        total_usd: 0,
        total_lbp: 0,
        count: 1,
        pending_commission_usd: 12.5,
        pending_commission_lbp: 150000,
        awaiting_settlement_count: 2,
        is_settled: 0,
      },
    ]);

    const { container } = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by payment method/i }));
    await waitFor(() =>
      expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(1),
    );
    await screen.findByText(/Commission Pending Settlement/);

    const cells = paymentRowCells(container, "Commission Pending Settlement");
    expect(cells[1].textContent).toContain("$12.5000");
    expect(cells[1].textContent).toContain(
      "2 transactions awaiting settlement",
    );
    // The previously-hardcoded-to-0 pending LBP figure now reaches the UI.
    expect(cells[2].textContent).toContain("150000 LBP");
  });

  it("regression: a legacy model-0-only pending row still shows a plain dollar figure, no count text", async () => {
    mockGetProfitByPaymentMethod.mockResolvedValueOnce([
      {
        method: "Commission Pending Settlement (OMT $5.00)",
        total_usd: 0,
        total_lbp: 0,
        count: 1,
        pending_commission_usd: 5,
        pending_commission_lbp: 0,
        awaiting_settlement_count: 0,
        is_settled: 0,
      },
    ]);

    const { container } = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by payment method/i }));
    await waitFor(() =>
      expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(1),
    );
    await screen.findByText(/Commission Pending Settlement/);

    const cells = paymentRowCells(container, "Commission Pending Settlement");
    expect(cells[1].textContent).toContain("$5.0000");
    expect(cells[1].textContent).not.toContain("awaiting settlement");
    // total_lbp stays 0 by design and pending_commission_lbp is 0 here too.
    expect(cells[2].textContent?.trim()).toBe("—");
  });
});

describe("Profits — Commissions tab, Provider Performance (Today) honesty fix", () => {
  it("labels a zero-realized-but-active provider as awaiting settlement, not $0.00", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: { commission: 3.5, pending_commission: 0, count: 15 },
      month: { commission: 3.5, pending_commission: 0, count: 15 },
      byProvider: [
        // All-model-1 traffic today: count is unrestricted, commission is
        // commission_model=0-only (LIRA-158 Phase 2a) — reads as "10 / $0.00"
        // pre-fix.
        { provider: "OMT", commission: 0, currency: "USD", count: 10 },
        // A provider that did realize commission — must render unchanged.
        { provider: "WHISH", commission: 3.5, currency: "USD", count: 5 },
        // A provider with genuinely no activity — must still read "$0.00".
        { provider: "BINANCE", commission: 0, currency: "USD", count: 0 },
      ],
    });
    mockGetUnsettledSummary.mockResolvedValueOnce([]);

    const { container } = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /commissions/i }));
    await waitFor(() => expect(mockGetOMTAnalytics).toHaveBeenCalledTimes(1));
    await screen.findByText("Provider Performance (Today)");
    await waitFor(() => expect(providerRowCells(container, "OMT")).toBeTruthy());

    const omtCells = providerRowCells(container, "OMT");
    expect(omtCells[1].textContent).toBe("10");
    expect(omtCells[2].textContent).toContain("Awaiting settlement");
    expect(omtCells[2].textContent).not.toContain("$0.00");
    expect(omtCells[4].textContent).toContain("Awaiting Settlement");

    const whishCells = providerRowCells(container, "WHISH");
    expect(whishCells[2].textContent).toContain("$3.5000");
    expect(whishCells[4].textContent).toContain("Settled");

    const binanceCells = providerRowCells(container, "BINANCE");
    expect(binanceCells[1].textContent).toBe("0");
    expect(binanceCells[2].textContent).toContain("$0.00");
    expect(binanceCells[4].textContent?.trim()).toBe("—");
  });
});
