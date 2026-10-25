/** @jest-environment jsdom */
/**
 * LIRA-341 — "Session discounts" on the Profits Overview: the basket
 * discounts given at session checkout (LIRA-341 core books them as
 * BASKET_DISCOUNT rows and returns `getSummary().session_discounts`, already
 * inside the totals). Its own line next to Waived / Extra charges.
 * Drives the REAL page (only useApi, useModules, useCurrencyContext mocked;
 * one stable mockApi object — rule 25).
 */
import { render, screen, waitFor } from "@testing-library/react";
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

describe("Profits — Session discounts (LIRA-341)", () => {
  it("Overview: a Session discounts line shows -$8, -90,000 LBP and the count", async () => {
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      session_discounts: { profit_usd: -8, profit_lbp: -90000, count: 2 },
    });
    render(<Profits />);
    const card = await screen.findByTestId("overview-session-discounts-card");
    expect(card.textContent).toContain("Session discounts");
    expect(card.textContent).toContain("2");
    expect(screen.getByTestId("session-discounts-usd").textContent).toContain(
      "-8 USD",
    );
    expect(screen.getByTestId("session-discounts-lbp").textContent).toContain(
      "-90000 LBP",
    );
  });

  it("no line when the period has none (or an older payload without the field)", async () => {
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      session_discounts: { profit_usd: 0, profit_lbp: 0, count: 0 },
    });
    render(<Profits />);
    await waitFor(() => expect(mockGetProfitSummary).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("overview-session-discounts-card")).toBeNull();
  });
});
