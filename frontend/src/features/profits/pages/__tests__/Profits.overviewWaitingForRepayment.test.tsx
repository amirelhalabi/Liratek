/** @jest-environment jsdom */

/**
 * Owner decision (h), 2026-09-24 afternoon (OWNER_NOTES_2026-09-21.md §6.9,
 * L0-4) — the Financial Services card gets a "waiting for repayment" line:
 * the commission on OMT/Whish/other FS transfers charged to a customer's
 * account that is still debt-pending, per currency. Shown like the card's
 * other pending figures (hidden when zero); NEVER added to gross or net
 * profit.
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked), matching this directory's established
 * convention (Profits.overviewAwaitingSettlement.test.tsx).
 */

import { render, screen, waitFor } from "@testing-library/react";
import Profits from "../Profits";

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

describe("Profits — Overview, Financial Services 'waiting for repayment' line (owner decision h)", () => {
  it("renders the USD + LBP figures when waiting_for_repayment is nonzero", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        waiting_for_repayment_usd: 5,
        waiting_for_repayment_lbp: 30_000,
      },
    });

    await renderOverview();

    const line = await screen.findByTestId(
      "overview-finsvc-waiting-for-repayment",
    );
    expect(line.textContent).toContain("Waiting for repayment");
    expect(line.textContent).toContain("5 USD");
    expect(line.textContent).toContain("30000 LBP");
  });

  it("hides the line entirely when both currencies are zero (no debt-pending FS commission this period)", async () => {
    mockGetProfitSummary.mockResolvedValueOnce(baseSummary());

    await renderOverview();

    expect(
      screen.queryByTestId("overview-finsvc-waiting-for-repayment"),
    ).not.toBeInTheDocument();
  });

  it("does not change totals — the figure is additive visibility only, never folded into gross/net", async () => {
    mockGetProfitSummary.mockResolvedValueOnce({
      ...baseSummary(),
      financial_services: {
        ...baseSummary().financial_services,
        waiting_for_repayment_usd: 5,
      },
      totals: {
        ...baseSummary().totals,
        gross_profit_usd: 12,
        net_profit_usd: 12,
      },
    });

    await renderOverview();

    await screen.findByTestId("overview-finsvc-waiting-for-repayment");
    // The $5 waiting-for-repayment figure must never be folded into the Net
    // Profit total (12 + 5 = 17) — totals are rendered from their own
    // server-computed fields, untouched by this line.
    expect(screen.queryByText("17 USD")).not.toBeInTheDocument();
    expect(screen.getAllByText("12 USD").length).toBeGreaterThan(0);
  });
});
