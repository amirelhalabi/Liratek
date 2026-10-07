/** @jest-environment jsdom */

/**
 * Profits Overview — "-$0.00" on the Mobile Services, Custom Services and
 * Mobile Recharges Cost lines (production check 2026-10-07). The earlier
 * deduction-label fix covered Product Sales / Maintenance / Expenses but
 * these cards still hard-coded a "-" before the amount. A zero cost (or
 * float dust that rounds to zero) must read "$0.00"; a real cost keeps its
 * minus.
 *
 * `useApi` returns ONE module-level object (rule 25).
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import Profits from "../Profits";

const mockGetProfitSummary = jest.fn();
const mockGetProfitByUser = jest.fn();
const mockGetProfitByClient = jest.fn();
const mockGetProfitByDate = jest.fn();

const mockApi = {
  getProfitSummary: mockGetProfitSummary,
  getProfitByUser: mockGetProfitByUser,
  getProfitByClient: mockGetProfitByClient,
  getProfitByDate: mockGetProfitByDate,
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
    // Realistic precision: cents for USD, whole pounds for LBP — so float
    // dust renders the way production renders it ("$0.00", "0 LBP").
    formatAmount: (v: number, c: string) =>
      c === "USD" ? `$${v.toFixed(2)}` : `${Math.round(v)} LBP`,
  }),
}));

jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

function moduleZero() {
  return {
    revenue_usd: 0,
    revenue_lbp: 0,
    cost_usd: 0,
    cost_lbp: 0,
    profit_usd: 0,
    profit_lbp: 0,
    count: 0,
  };
}

function baseSummary() {
  return {
    period: "2026-10-07 to 2026-10-07",
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
    mobile_services: moduleZero(),
    recharges: moduleZero(),
    custom_services: moduleZero(),
    maintenance: moduleZero(),
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
      lbp_buy_rate: null,
    },
  };
}

async function renderPage() {
  const utils = render(<Profits />);
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  return utils;
}

function cardOf(title: string): HTMLElement {
  // Card root: title span → header row → card.
  return screen.getByText(title).closest("div")!.parentElement as HTMLElement;
}

beforeEach(() => {
  jest.clearAllMocks();
});

function costLine(title: string): string {
  const card = cardOf(title);
  const label = within(card).getByText("Cost");
  return (label.parentElement as HTMLElement).textContent ?? "";
}

const CARDS = ["Mobile Services", "Custom Services", "Mobile Recharges"];

describe("Profits Overview — zero cost never reads '-$0.00'", () => {
  it("exact zero cost reads '$0.00'", async () => {
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      mobile_services: {
        ...moduleZero(),
        revenue_usd: 5,
        profit_usd: 5,
        count: 1,
      },
      custom_services: {
        ...moduleZero(),
        revenue_usd: 5,
        profit_usd: 5,
        count: 1,
      },
      recharges: { ...moduleZero(), revenue_usd: 5, profit_usd: 5, count: 1 },
    });
    await renderPage();
    for (const title of CARDS) {
      expect(costLine(title)).toBe("Cost$0.00");
    }
  });

  it("float dust that rounds to zero reads '$0.00' / '0 LBP', never with a minus", async () => {
    const dust = { ...moduleZero(), cost_usd: 0.001, cost_lbp: 0, count: 1 };
    const lbpDust = { ...moduleZero(), cost_usd: 0, cost_lbp: 0.3, count: 1 };
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      mobile_services: dust,
      custom_services: lbpDust,
      recharges: { ...moduleZero(), cost_usd: 0.002, cost_lbp: 0.2, count: 1 },
      maintenance: { ...moduleZero(), cost_usd: 0, cost_lbp: 0.4, count: 1 },
    });
    await renderPage();
    for (const title of [...CARDS, "Maintenance"]) {
      expect(costLine(title)).not.toMatch(/[-−]\s*\$?0(\.00)?( LBP)?\b/);
    }
  });

  it("a real cost keeps its minus sign (USD, LBP and both)", async () => {
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      mobile_services: { ...moduleZero(), cost_usd: 4, count: 1 },
      custom_services: { ...moduleZero(), cost_lbp: 90000, count: 1 },
      recharges: { ...moduleZero(), cost_usd: 2, cost_lbp: 1000, count: 1 },
    });
    await renderPage();
    expect(costLine("Mobile Services")).toBe("Cost-$4.00");
    expect(costLine("Custom Services")).toBe("Cost-90000 LBP");
    expect(costLine("Mobile Recharges")).toBe("Cost-$2.00 + 1000 LBP");
  });
});
