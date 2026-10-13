/** @jest-environment jsdom */
/**
 * LIRA-319 (owner 2026-10-13) — "Extra charges" on the Profits page: what
 * cashiers added on top of a price shows as its OWN line, never inside an
 * item's or module's profit.
 *   - Overview: an "Extra charges" card (per currency), from
 *     `getSummary().extra_charges` (already folded into the totals server-side).
 *   - By Module: a profit-only "Extra charges" row (module EXTRA_CHARGE,
 *     revenue = profit, cost 0) with its drill-down.
 * Mock data is shaped per the Profits contract (specs/319-extra-charges
 * data-model.md "Reporting shape"). Not proven failing-first: written after
 * the page change.
 * Drives the REAL page (only useApi, useModules, useCurrencyContext mocked;
 * one stable mockApi object — rule 25).
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

describe("Profits — Extra charges (LIRA-319)", () => {
  it("Overview: an Extra charges card shows $3 and 10,000 LBP", async () => {
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      extra_charges: { usd: 3, lbp: 10000 },
    });
    render(<Profits />);
    const card = await screen.findByTestId("overview-extra-charges-card");
    expect(card.textContent).toContain("Extra charges");
    expect(screen.getByTestId("extra-charges-usd").textContent).toContain(
      "3 USD",
    );
    expect(screen.getByTestId("extra-charges-lbp").textContent).toContain(
      "10000 LBP",
    );
  });

  it("no card when the period has no extra (or an older payload without the field)", async () => {
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      extra_charges: { usd: 0, lbp: 0 },
    });
    render(<Profits />);
    await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("overview-extra-charges-card")).toBeNull();
  });

  it("By Module: a profit-only Extra charges row ($3, cost 0) with its drill-down", async () => {
    mockGetProfitSummary.mockResolvedValue(baseSummary());
    mockGetProfitByModule.mockResolvedValue([
      {
        module: "POS",
        label: "POS Sales",
        revenue_usd: 12,
        revenue_lbp: 0,
        cost_usd: 10,
        cost_lbp: 0,
        profit_usd: 2,
        profit_lbp: 0,
        count: 2,
        margin_pct: null,
        margin_converted: false,
      },
      {
        module: "EXTRA_CHARGE",
        label: "Extra charges",
        revenue_usd: 3,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 3,
        profit_lbp: 0,
        count: 2,
        margin_pct: null,
        margin_converted: false,
      },
    ]);
    render(<Profits />);
    fireEvent.click(screen.getByText("By Module"));
    expect(await screen.findByText("Extra charges")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("by-module-expand-EXTRA_CHARGE"));
    const usd = await screen.findByTestId("by-module-detail-EXTRA_CHARGE-usd");
    expect(usd.textContent).toContain("Profit:");
    expect(usd.textContent).toContain("3 USD");
    // Profit-only: no revenue − cost equation on this row.
    expect(usd.textContent).not.toContain("Cost");
    expect(
      screen.getByTestId("by-module-show-transactions-EXTRA_CHARGE"),
    ).toBeInTheDocument();
  });
});
