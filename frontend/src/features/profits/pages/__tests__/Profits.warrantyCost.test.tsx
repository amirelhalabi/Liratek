/** @jest-environment jsdom */
/**
 * LIRA-296 (T041, owner decision D1) — the Profits page shows the cost of
 * honouring warranties as ONE "Warranty cost" line:
 *   - By Module: a profit-only row ("Profit: <amount>", never "0 − 0 = X")
 *     with its "Show transactions" drill-down;
 *   - Overview: a "Warranty cost" card when the period has any.
 * Drives the REAL page (only useApi, useModules, useCurrencyContext mocked).
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Profits from "../Profits";

const mockGetProfitSummary = jest.fn();
const mockGetProfitByModule = jest.fn();
const mockApi = {
  getProfitSummary: mockGetProfitSummary,
  getProfitByModule: mockGetProfitByModule,
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
    sales: {
      revenue_usd: 0,
      cost_usd: 0,
      profit_usd: 0,
      profit_lbp: 0,
      count: 0,
    },
    financial_services: {
      revenue_usd: 0,
      revenue_lbp: 0,
      pending_revenue_usd: 0,
      pending_revenue_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      commission_at_settlement_usd: 0,
      commission_at_settlement_lbp: 0,
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
    debt_repayments: { profit_usd: 0, profit_lbp: 0, count: 0 },
    expenses: { total_usd: 0, total_lbp: 0, count: 0 },
    discounts: { usd: 0, lbp: 0 },
    supplier_commission: { profit_usd: 0, profit_lbp: 0, count: 0 },
    topups_buybacks: { profit_usd: 0, profit_lbp: 0, count: 0 },
    deferred: {
      partner_profit_usd: 0,
      partner_profit_lbp: 0,
      client_debt_profit_usd: 0,
      client_debt_profit_lbp: 0,
      cashless_deferred_profit_usd: 0,
      cashless_deferred_profit_lbp: 0,
      unpaid_sales_outstanding_usd: 0,
      unpaid_sales_potential_profit_usd: 0,
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
      // note #3 (2026-09-24, CLOSED "no change") — `combined_rate_used`/
      // `combined_net_profit_lbp` were removed with the combined net-profit
      // line; `lbp_buy_rate` is the field ProfitService.getSummary returns
      // today (kept only to weight the By Module TOTAL row's margin_pct).
      lbp_buy_rate: null,
    },
  };
}

beforeEach(() => jest.clearAllMocks());

describe("Profits — Warranty cost (LIRA-296)", () => {
  it("Overview shows a Warranty cost card", async () => {
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      warranty: { profit_usd: -6, profit_lbp: 0, count: 1 },
    });
    render(<Profits />);
    const card = await screen.findByTestId("overview-warranty-card");
    expect(card.textContent).toContain("Warranty cost");
    expect(card.textContent).toContain("1 claims");
    expect(card.textContent).toContain("-6 USD");
  });

  it("no card when the period has no warranty cost", async () => {
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      warranty: { profit_usd: 0, profit_lbp: 0, count: 0 },
    });
    render(<Profits />);
    await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("overview-warranty-card")).toBeNull();
  });

  it("By Module: a profit-only Warranty cost row with its drill-down", async () => {
    mockGetProfitSummary.mockResolvedValue(baseSummary());
    mockGetProfitByModule.mockResolvedValue([
      {
        module: "WARRANTY",
        label: "Warranty cost",
        revenue_usd: 0,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: -6,
        profit_lbp: 0,
        count: 1,
        margin_pct: null,
        margin_converted: false,
      },
    ]);
    render(<Profits />);
    fireEvent.click(screen.getByText("By Module"));
    expect(await screen.findByText("Warranty cost")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("by-module-expand-WARRANTY"));
    const usd = await screen.findByTestId("by-module-detail-WARRANTY-usd");
    expect(usd.textContent).toContain("Profit:");
    expect(usd.textContent).not.toContain("−");
    expect(
      screen.getByTestId("by-module-show-transactions-WARRANTY"),
    ).toBeInTheDocument();
  });
});
