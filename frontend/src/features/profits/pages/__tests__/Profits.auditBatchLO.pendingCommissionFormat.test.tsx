/** @jest-environment jsdom */

/**
 * Lane LO — OWNER_NOTES_2026-09-21.md §6.6 PA-4.13, second half (the line
 * assigned to LO after lane LP finished the rest of the Pending tab).
 *
 * The unsettled-commissions row table's Commission column used a hard-coded
 * ternary: `r.currency === "LBP" ? formatAmount(r.commission, "LBP") :
 * "$" + r.commission.toFixed(4)`. Two bugs in one line: a USD row always
 * showed 4 decimal places (formatAmount's own convention is 2), and any
 * currency that is neither USD nor LBP (e.g. a EUR-denominated financial
 * service) fell into the `else` branch and rendered a bare "$" prefix on an
 * amount that was never dollars.
 *
 * Fix: `formatAmount(r.commission, r.currency)` — formatAmount already
 * knows every currency's symbol and decimal_places (LBP included), so it
 * replaces the ternary outright (Profits.tsx ~3869).
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked), matching this repo's layer-seam testing
 * convention.
 *
 * RED proof (rule 17), actually run (2026-09-24): with Profits.tsx's fix
 * reverted back to `r.currency === "LBP" ? formatAmount(r.commission,
 * "LBP") : \`$${r.commission.toFixed(4)}\`` — `npx jest
 * Profits.auditBatchLO.pendingCommissionFormat --maxWorkers=1` reported:
 *
 *   ● Profits — Pending tab, PA-4.13 commission format › a USD pending row
 *     renders the commission with 2 decimals, not 4
 *     expect(element).toBeInTheDocument()
 *     expected document not to contain element, found <div ...>$12.50</div>
 *     ... (received "$12.5000" instead)
 *
 *   ● Profits — Pending tab, PA-4.13 commission format › a EUR pending row
 *     renders its own currency, not a bare "$" prefix
 *     expect(element).toBeInTheDocument()
 *     found no element matching "8.40 EUR" — received "$8.4000"
 *
 * "Tests: 2 failed, 2 total". The revert was then undone (Edit restored to
 * `formatAmount(r.commission, r.currency)`) and the same command reported
 * "Tests: 2 passed, 2 total" again.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetPendingProfit = jest.fn();

// Module-level object — a STABLE reference across renders (rule 25).
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

// A realistic formatAmount: 2 decimals for a $-symbol currency, a bare
// "<amount> <code>" fallback for anything else — the same shape the real
// CurrencyContext produces from the tenant's currencies table, close enough
// to pin the two bugs this line had (wrong decimal count, wrong/missing
// symbol) without depending on the context's own currency-loading plumbing.
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => {
      const n = Number(v ?? 0);
      if (c === "LBP") return `${n.toLocaleString()} LBP`;
      if (c === "USD") return `$${n.toFixed(2)}`;
      return `${n.toFixed(2)} ${c}`;
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
  unsettled_commissions: [] as unknown[],
  unsettled_totals: {
    total_pending_commission_usd: 0,
    total_pending_commission_lbp: 0,
    count: 0,
    awaiting_settlement_count: 0,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Profits — Pending tab, PA-4.13 commission format", () => {
  it("a USD pending row renders the commission with 2 decimals, not 4", async () => {
    mockGetPendingProfit.mockResolvedValueOnce({
      ...emptyPendingPayload,
      unsettled_commissions: [
        {
          id: 1,
          provider: "OMT",
          omt_service_type: "SEND",
          amount: 100,
          currency: "USD",
          commission: 12.5,
          omt_fee: null,
          created_at: "2026-09-20 10:00:00",
        },
      ],
      unsettled_totals: {
        ...emptyPendingPayload.unsettled_totals,
        count: 1,
        // Deliberately distinct from the row's commission (12.5) so the
        // per-row column and the "Pending Commission (USD)" summary card
        // (a second, separate hard-coded `$…toFixed(4)` found while fixing
        // the assigned line — same block, same bug) can be told apart.
        total_pending_commission_usd: 30,
      },
    });

    await renderPendingTab();
    await screen.findByText("Pending OMT/WHISH Commissions");

    expect(screen.getByText("$12.50")).toBeInTheDocument(); // per-row column
    expect(screen.getByText("$30.00")).toBeInTheDocument(); // summary card
    expect(screen.queryByText("$12.5000")).not.toBeInTheDocument();
    expect(screen.queryByText("$30.0000")).not.toBeInTheDocument();
  });

  it("a EUR pending row renders its own currency, not a bare \"$\" prefix", async () => {
    mockGetPendingProfit.mockResolvedValueOnce({
      ...emptyPendingPayload,
      unsettled_commissions: [
        {
          id: 2,
          provider: "BINANCE",
          omt_service_type: "RECEIVE",
          amount: 200,
          currency: "EUR",
          commission: 8.4,
          omt_fee: null,
          created_at: "2026-09-20 11:00:00",
        },
      ],
      unsettled_totals: {
        ...emptyPendingPayload.unsettled_totals,
        count: 1,
      },
    });

    await renderPendingTab();
    await screen.findByText("Pending OMT/WHISH Commissions");

    expect(screen.getByText("8.40 EUR")).toBeInTheDocument();
    expect(screen.queryByText("$8.4000")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\$8\.40$/)).not.toBeInTheDocument();
  });
});
