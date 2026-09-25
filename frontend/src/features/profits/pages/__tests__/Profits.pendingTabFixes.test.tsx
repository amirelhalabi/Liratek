/** @jest-environment jsdom */

/**
 * OWNER_NOTES_2026-09-21.md §6 — Lane LP, Pending tab UI.
 *
 *  - PA-1.5: the unsettled-commissions row table printed a hard-coded `$`
 *    for Amount/OMT Fee/Commission, mislabeling every LBP row as USD.
 *  - PA-3.7: the "Pending OMT/WHISH Commissions" section used to hide
 *    entirely whenever the legacy (model-0) row list was empty, even when
 *    model-1 rows were genuinely awaiting settlement — invisible post-
 *    cutover pending commission. A Deferred Profit card (from
 *    `getDeferredProfit`, additive-only) is new on this tab.
 *  - PA-3.8: the unpaid-sales table now says on screen that it ignores the
 *    date range above (it always shows every outstanding receivable).
 *  - PA-4.16: a failed fetch shows a distinct error banner instead of the
 *    same "No data for this period" placeholder a quiet period renders.
 *  - PA-4.19: the Pending Profit card's caption no longer claims profit is
 *    "Recognized once fully paid" unconditionally — that is false for a
 *    partner-obligation sale (recognized as the partner settles, even
 *    though the customer never pays anything directly).
 *
 * Drives the REAL `Profits` page (only `useApi`/`useModules`/
 * `useCurrencyContext` mocked), matching this repo's layer-seam testing
 * convention (Profits.pendingSettlementCount.test.tsx et al.) so a wiring
 * mistake in the JSX itself is caught, not just in a helper function.
 *
 * RED proof (rule 17), actually run (2026-09-23): with the Pending tab's six
 * fixes each temporarily reverted via Edit (PA-1.5 back to a hard-coded `$`;
 * the unsettled-commissions section's visibility back to
 * `unsettled_commissions.length > 0` alone; the Deferred Profit card gated
 * on an unreachable tab value; the "Recognized once fully paid" copy and the
 * "regardless of the date range" caption removed; the error banner gated
 * unreachable) — `npx jest Profits.pendingTabFixes --maxWorkers=1` reported
 * "Tests: 6 failed, 2 passed, 8 total", failing exactly the 6 cases that
 * exercise a reverted fix while the 2 unaffected control cases ("absent when
 * nothing deferred", "quiet period renders the ordinary summary") still
 * passed. All six reverts were then undone and the same command reported
 * "Tests: 8 passed, 8 total" again.
 *
 * Round 2 (LP-1/LP-2/LP-4, OWNER_NOTES §6, adversarial re-review) — RED proof
 * actually run (2026-09-23): with the "Pending Profit" card's `subValue`
 * reverted to the round-1 copy ("Recognized once fully paid (or as the
 * covering partner settles, for partner-obligation sales)"), the
 * unpaid-sales table's `emptyMessage` reverted to "No unpaid sales in this
 * period", and BOTH the Pending-commissions and Deferred-profit section
 * headings' "for the selected period" caption spans removed — `npx jest
 * Profits.pendingTabFixes --maxWorkers=1 -t "round 2|LP-4"` reported "Tests:
 * 3 failed, 7 skipped, 10 total": the PA-4.19 test failed on
 * `getByText(/tracked separately in the Deferred card/i)` (not found — old
 * copy still present), the empty-state test failed on
 * `getByText("No unpaid sales")` (not found — got "No unpaid sales in this
 * period" instead), and the caption test failed on
 * `getAllByText("for the selected period")` (TestingLibraryElementError:
 * unable to find any element — zero matches instead of 2). All four reverts
 * were undone and `npx jest Profits.pendingTabFixes --maxWorkers=1` reported
 * "Tests: 10 passed, 10 total" again.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetPendingProfit = jest.fn();

// Module-level object — a STABLE reference across renders (rule 25: a fresh
// object literal per useApi() call is exactly the unstable identity that
// causes an infinite render loop if a component ever keys an effect on it).
const mockApi = {
  getPendingProfit: mockGetPendingProfit,
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
    formatAmount: (v: number, c: string) => {
      const n = Number(v ?? 0);
      return c === "LBP" ? `${n.toLocaleString()} LBP` : `$${n.toFixed(2)}`;
    },
  }),
}));

jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderPendingTab() {
  const utils = render(<Profits />);
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /pending/i }));
  await waitFor(() => expect(mockGetPendingProfit).toHaveBeenCalledTimes(1));
  return utils;
}

const emptyPendingPayload = {
  rows: [],
  totals: { total_outstanding_usd: 0, total_pending_profit_usd: 0, count: 0 },
  unsettled_commissions: [],
  unsettled_totals: {
    total_pending_commission_usd: 0,
    total_pending_commission_lbp: 0,
    count: 0,
    awaiting_settlement_count: 0,
  },
  deferred: {
    partner_profit_usd: 0,
    partner_profit_lbp: 0,
    client_debt_profit_usd: 0,
    client_debt_profit_lbp: 0,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Profits — Pending tab fixes (PA-1.5 / PA-3.7 / PA-3.8 / PA-4.16 / PA-4.19)", () => {
  it("PA-1.5: an LBP unsettled-commission row shows LBP, not a hard-coded $, for Amount/OMT Fee/Commission", async () => {
    mockGetPendingProfit.mockResolvedValueOnce({
      ...emptyPendingPayload,
      unsettled_commissions: [
        {
          id: 1,
          provider: "OMT",
          omt_service_type: "RECEIVE",
          amount: 5000000,
          currency: "LBP",
          commission: 25000,
          omt_fee: 10000,
          created_at: "2026-09-20 10:00:00",
        },
      ],
      unsettled_totals: {
        ...emptyPendingPayload.unsettled_totals,
        count: 1,
        total_pending_commission_lbp: 25000,
      },
    });

    const { container } = await renderPendingTab();
    await screen.findByText("Pending OMT/WHISH Commissions");

    const rowText = container.textContent ?? "";
    // The old code printed "$5000000.00" / "$10000.00" / "$25000.0000".
    expect(rowText).not.toMatch(/\$5,?000,?000/);
    expect(rowText).not.toMatch(/\$10,?000\.00/);
    expect(rowText).not.toMatch(/\$25,?000\.0000/);
    expect(rowText).toContain("5,000,000 LBP");
    expect(rowText).toContain("10,000 LBP");
    expect(rowText).toContain("25,000 LBP");
  });

  it("PA-3.7: the section still renders with a model-1 awaiting-settlement count when the legacy row list is empty", async () => {
    mockGetPendingProfit.mockResolvedValueOnce({
      ...emptyPendingPayload,
      unsettled_commissions: [], // no legacy rows at all
      unsettled_totals: {
        ...emptyPendingPayload.unsettled_totals,
        awaiting_settlement_count: 4,
      },
    });

    await renderPendingTab();

    // Pre-fix: this whole section was gated on
    // unsettled_commissions.length > 0 and never rendered here.
    await screen.findByText("Pending OMT/WHISH Commissions");
    expect(screen.getByText(/4\s+awaiting settlement/)).toBeInTheDocument();
  });

  it("PA-3.7: the Deferred Profit card surfaces partner- and client-debt-pending profit", async () => {
    mockGetPendingProfit.mockResolvedValueOnce({
      ...emptyPendingPayload,
      deferred: {
        partner_profit_usd: 42,
        partner_profit_lbp: 0,
        client_debt_profit_usd: 17,
        client_debt_profit_lbp: 0,
      },
    });

    await renderPendingTab();

    await screen.findByText(/Deferred Profit/);
    expect(screen.getByText("$42.00")).toBeInTheDocument();
    expect(screen.getByText("$17.00")).toBeInTheDocument();
  });

  it("PA-3.7: the Deferred Profit card is absent when nothing is deferred", async () => {
    mockGetPendingProfit.mockResolvedValueOnce(emptyPendingPayload);

    await renderPendingTab();
    // A successful (even empty) response always renders the summary cards —
    // pendingData is a real object, never null, on success.
    await screen.findByText("Unpaid Sales");

    expect(screen.queryByText(/Deferred Profit/)).not.toBeInTheDocument();
  });

  it("PA-3.8: the unpaid-sales table states it ignores the date range above", async () => {
    mockGetPendingProfit.mockResolvedValueOnce({
      ...emptyPendingPayload,
      rows: [
        {
          sale_id: 1,
          created_at: "2026-01-01 09:00:00",
          client_name: "Old Client",
          client_phone: "",
          total_amount_usd: 40,
          paid_usd: 0,
          outstanding_usd: 40,
          potential_profit_usd: 15,
          items_summary: "1x Widget",
        },
      ],
      totals: { total_outstanding_usd: 40, total_pending_profit_usd: 15, count: 1 },
    });

    await renderPendingTab();

    await screen.findByText(/regardless of the date range above/i);
  });

  it("PA-4.19 (round 2, LP-1 follow-through): the Pending Profit card no longer claims a partner-obligation carve-out that can never fire here — for-partner sales are excluded from this figure entirely (LP-1), so it points to the Deferred card instead", async () => {
    mockGetPendingProfit.mockResolvedValueOnce(emptyPendingPayload);

    await renderPendingTab();

    await screen.findByText("Unpaid Sales");
    // Round-1 copy ("or as the covering partner settles, for
    // partner-obligation sales") described a case that can no longer occur
    // in this figure post-LP-1 — a for-partner sale never reaches
    // totals.total_pending_profit_usd any more, so that qualifier would now
    // describe money that isn't there.
    expect(
      screen.queryByText(/or as the covering partner settles/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/tracked separately in the Deferred card/i),
    ).toBeInTheDocument();
  });

  it("LP-4: the unpaid-sales table's empty state no longer says 'in this period' — the table is date-independent (PA-3.8)", async () => {
    mockGetPendingProfit.mockResolvedValueOnce(emptyPendingPayload);

    await renderPendingTab();

    await screen.findByText("Unpaid Sales");
    expect(screen.getByText("No unpaid sales")).toBeInTheDocument();
    expect(
      screen.queryByText("No unpaid sales in this period"),
    ).not.toBeInTheDocument();
  });

  it("LP-4: the Pending-commissions and Deferred-profit sections caption themselves as period-bound, unlike the always-all-time unpaid-sales table", async () => {
    mockGetPendingProfit.mockResolvedValueOnce({
      ...emptyPendingPayload,
      unsettled_totals: {
        ...emptyPendingPayload.unsettled_totals,
        awaiting_settlement_count: 1,
      },
      deferred: {
        partner_profit_usd: 5,
        partner_profit_lbp: 0,
        client_debt_profit_usd: 0,
        client_debt_profit_lbp: 0,
      },
    });

    await renderPendingTab();

    await screen.findByText("Pending OMT/WHISH Commissions");
    expect(screen.getAllByText("for the selected period")).toHaveLength(2);
  });

  it("PA-4.16: a rejected fetch shows a visible error state, not the same placeholder as a quiet period", async () => {
    mockGetPendingProfit.mockRejectedValueOnce(new Error("network exploded"));

    await renderPendingTab();

    await screen.findByText("Couldn't load pending profit");
    expect(screen.getByText(/network exploded/)).toBeInTheDocument();
    // The plain "no data" placeholder must NOT also render alongside it —
    // pre-fix, this was the ONLY thing a failed fetch ever showed.
    expect(
      screen.queryByText("No data for this period"),
    ).not.toBeInTheDocument();
  });

  it("a quiet (successful, empty) period renders the ordinary (zeroed) summary, not an error", async () => {
    mockGetPendingProfit.mockResolvedValueOnce(emptyPendingPayload);

    await renderPendingTab();

    // A successful response is never `pendingData === null` — the "No data"
    // placeholder is a defensive fallback for a malformed/falsy success
    // response, not the normal shape of an empty-but-successful period.
    await screen.findByText("Unpaid Sales");
    expect(
      screen.queryByText("Couldn't load pending profit"),
    ).not.toBeInTheDocument();
  });
});
