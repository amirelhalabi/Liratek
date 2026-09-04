/** @jest-environment jsdom */

/**
 * LIRA-162 — pending commission is INVISIBLE on the Profits Overview card.
 *
 * D15's "N transactions awaiting settlement" count previously fed ONLY the
 * By-Payment-Method tab. `ProfitService.getSummary` now ALSO carries
 * `financial_services.awaiting_settlement_count`, so the Overview
 * "Financial Services" card's Pending line can render it.
 *
 * Corrected framing (verified against the pre-fix JSX): the Pending line
 * does NOT show a fabricated `$0.00` — it sits behind a
 * `pending_commission_usd > 0 || pending_commission_lbp > 0` guard that
 * never fires for an all-post-cutover period (both stay legacy-model-only
 * forever), so the line silently does not render AT ALL. This suite proves
 * the fix at the component level: a period with zero legacy pending dollars
 * but a nonzero `awaiting_settlement_count` now renders the Pending line
 * with the count, where it previously rendered nothing.
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked), matching this directory's established
 * convention (Profits.deferredSettlementCommission.test.tsx).
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

jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Fixture — every field the Overview tab reads unconditionally, mirroring
// Profits.deferredSettlementCommission.test.tsx's own baseSummary().
// ---------------------------------------------------------------------------

function baseSummary() {
  return {
    period: "2026-08-01 to 2026-08-31",
    sales: { revenue_usd: 0, cost_usd: 0, profit_usd: 0, count: 0 },
    financial_services: {
      revenue_usd: 105,
      revenue_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      pending_commission_usd: 0,
      pending_commission_lbp: 0,
      pm_fee_usd: 0,
      pm_fee_lbp: 0,
      count: 1,
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
    supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
    deferred: {
      partner_profit_usd: 0,
      partner_profit_lbp: 0,
      client_debt_profit_usd: 0,
      client_debt_profit_lbp: 0,
    },
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
  await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalledTimes(1));
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

describe("Profits — Overview, Financial Services Pending line (LIRA-162)", () => {
  it("worked example: one post-cutover OMT SEND — Pending line renders the count, not nothing", async () => {
    // Matches the ticket's worked example: $100 + $5 fee, unsettled,
    // pending_commission stays 0 (legacy-model-only) but
    // awaiting_settlement_count is 1.
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        awaiting_settlement_count: 1,
      },
    });

    await renderOverview();

    // Pre-fix this line simply did not exist in the document — the guard
    // (`pending_commission_usd > 0 || pending_commission_lbp > 0`) never
    // fired for this payload.
    const caption = await screen.findByTestId(
      "overview-finsvc-awaiting-settlement",
    );
    expect(caption.textContent).toContain("1 awaiting settlement");
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("still renders the legacy dollar figure unchanged when the period has real settled-legacy pending", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        pending_commission_usd: 4.5,
        awaiting_settlement_count: 0,
      },
    });

    await renderOverview();

    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(
      screen.queryByTestId("overview-finsvc-awaiting-settlement"),
    ).not.toBeInTheDocument();
  });

  it("omits the whole Pending line when there is genuinely nothing pending", async () => {
    mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

    await renderOverview();

    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("overview-finsvc-awaiting-settlement"),
    ).not.toBeInTheDocument();
  });
});
