/** @jest-environment jsdom */

/**
 * LIRA-158 follow-up (owner decision D17, 2026-08-31) — Overview tab.
 *
 * The owner settles OMT/WHISH batches out of his own drawer BEFORE the
 * clients who owe him for those transfers repay. Commission on a CASHLESS
 * settlement (no money actually arrives — OMT/WHISH, or a mixed bills+OMT
 * batch) now defers until the client's debt is covered, instead of
 * recognising on the settlement day. A bills-only Katsh/iPick settlement is
 * unchanged (still recognises immediately).
 *
 * Backend contract this page now codes against:
 *   - `supplier_commission.count` = the number of DISTINCT settlements that
 *     contributed RECOGNISED commission in the window (not every settlement
 *     touched) — a fully-deferred settlement contributes 0 and does not
 *     increment it.
 *   - the deferred commission itself is folded into
 *     `deferred.client_debt_profit_usd`/`client_debt_profit_lbp`, the same
 *     bucket that already carried account-charged-transaction profit
 *     stranded behind an uncovered client debt.
 *
 * This drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` are mocked, matching this directory's existing
 * convention in Profits.pendingSettlementCount.test.tsx), so a wiring
 * mistake in the JSX itself — not just in a service helper — would be
 * caught.
 */

import { render, screen, waitFor } from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProfitSummary = jest.fn();

const mockApi = {
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

// The chart uses recharts via React.lazy + Suspense; stubbed out purely to
// avoid pulling recharts into this render (Overview tab never shows it, but
// the module is still imported at the top of Profits.tsx).
jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** Every field the Overview tab reads unconditionally (no `summary.x &&`
 *  guard) must be present, or the render throws on `undefined.field`. */
function baseSummary() {
  return {
    period: "2026-08-01 to 2026-08-31",
    sales: { revenue_usd: 0, cost_usd: 0, profit_usd: 0, count: 0 },
    financial_services: {
      revenue_usd: 0,
      revenue_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
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
    expenses: { total_usd: 0, total_lbp: 0, count: 0 },
    totals: {
      gross_revenue_usd: 0,
      gross_revenue_lbp: 0,
      total_cost_usd: 0,
      total_cost_lbp: 0,
      gross_profit_usd: 0,
      gross_profit_lbp: 0,
      net_profit_usd: 0,
      net_profit_lbp: 0,
    },
  };
}

async function renderOverview() {
  const utils = render(<Profits />);
  await waitFor(() =>
    expect(mockGetProfitSummary).toHaveBeenCalledTimes(1),
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
// Tests
// ---------------------------------------------------------------------------

describe("Profits — Overview, D17 deferred settlement commission", () => {
  it("shows the normal Supplier Commission card when a settlement recognised commission", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      supplier_commission: { profit_usd: 2, profit_lbp: 0, count: 1 },
      deferred: {
        partner_profit_usd: 0,
        partner_profit_lbp: 0,
        client_debt_profit_usd: 0,
        client_debt_profit_lbp: 0,
      },
    });

    await renderOverview();

    const card = await screen.findByText("Supplier Commission");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("1 settlements")).toBeInTheDocument();
    expect(screen.getByText("2 USD")).toBeInTheDocument();
    // Not the fully-deferred pointer variant.
    expect(
      screen.queryByTestId("supplier-commission-fully-deferred"),
    ).not.toBeInTheDocument();
    // Nothing deferred this period — the Deferred Profit card stays hidden.
    expect(
      screen.queryByTestId("profits-deferred-card"),
    ).not.toBeInTheDocument();
  });

  it("points at Deferred Profit instead of vanishing when every settlement fully deferred", async () => {
    // count=0 / profit=0 — the D17 contract for a window where a cashless
    // settlement happened but nothing was recognised (everything deferred).
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
      deferred: {
        partner_profit_usd: 0,
        partner_profit_lbp: 0,
        client_debt_profit_usd: 2,
        client_debt_profit_lbp: 0,
      },
    });

    await renderOverview();

    // Deferred Profit card is visible (pre-existing behavior, still works).
    const deferredCard = await screen.findByTestId("profits-deferred-card");
    expect(deferredCard).toBeInTheDocument();
    expect(deferredCard.textContent).toContain("2 USD");

    // The caption calling out that this figure can include settlement
    // commission is present (item 2 — legibility, not silent folding).
    expect(
      screen.getByTestId("deferred-client-debt-caption"),
    ).toBeInTheDocument();

    // Supplier Commission renders the "fully deferred" pointer, not the
    // normal breakout (which would render nothing for count=0/profit=0),
    // and not silence.
    const pointer = screen.getByTestId("supplier-commission-fully-deferred");
    expect(pointer).toBeInTheDocument();
    expect(pointer.textContent).toContain("Supplier Commission");
    expect(pointer.textContent).toContain("Deferred");
    expect(pointer.textContent).toMatch(/deferred profit/i);
  });

  it("renders nothing for either card in a genuinely empty period", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
      deferred: {
        partner_profit_usd: 0,
        partner_profit_lbp: 0,
        client_debt_profit_usd: 0,
        client_debt_profit_lbp: 0,
      },
    });

    await renderOverview();

    // Give the (absent) cards a chance to have rendered before asserting
    // absence — the awaited helper above already settled the loading state.
    expect(screen.queryByText("Supplier Commission")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("profits-deferred-card"),
    ).not.toBeInTheDocument();
  });

  it("regression: a legacy bills-only-recognised period is unaffected by the D17 branch", async () => {
    // Pre-D17 shape: commission recognised, nothing ever deferred. Must
    // render exactly as before — no pointer card, no Deferred Profit card.
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      supplier_commission: { profit_usd: 5.5, profit_lbp: 0, count: 2 },
    });

    await renderOverview();

    expect(screen.getByText("2 settlements")).toBeInTheDocument();
    expect(screen.getByText("5.5 USD")).toBeInTheDocument();
    expect(
      screen.queryByTestId("supplier-commission-fully-deferred"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("profits-deferred-card"),
    ).not.toBeInTheDocument();
  });
});
