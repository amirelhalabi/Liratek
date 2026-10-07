/** @jest-environment jsdom */

/**
 * Profits page — display fixes from the production review of 2026-10-07
 * (money figures were correct; only how they read was wrong).
 *
 *  2. By Cashier showed "Transactions 5" next to an "Avg Profit/Txn" divided
 *     by a hidden count of 4. The Transactions column now shows the SAME
 *     counted figure the average divides by (By Cashier and By Client).
 *  4. Product Sales said "0 sales" for a period whose 3 sales were all voided
 *     or refunded — the badge now says the count is net, and the card says
 *     which sales are left out.
 *  5. Custom Services read "jobs" with no number when the count came back
 *     empty; "-0" (shown as "-$0.00") appeared on zero Cost / Expenses lines.
 *
 * Drives the real page; `useApi` returns ONE module-level object (rule 25 —
 * never a fresh literal per call).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
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
    formatAmount: (v: number, c: string) => `${v} ${c}`,
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
  mockGetProfitSummary.mockResolvedValue(baseSummary());
});

describe("Profits — By Cashier / By Client: the shown count is the average's count", () => {
  const cashier = {
    user_id: 1,
    username: "cashier1",
    revenue_usd: 10,
    revenue_lbp: 0,
    profit_usd: 0.24,
    profit_lbp: 0,
    transaction_count: 5,
    recognized_transaction_count: 4,
    pending_profit_usd: 0,
    pending_profit_lbp: 0,
  };

  it("By Cashier: Transactions shows 4 (the counted figure), Avg Profit/Txn is 0.24 / 4", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([cashier]);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    const row = (await screen.findByText("cashier1")).closest(
      "tr",
    ) as HTMLElement;
    const cells = within(row).getAllByRole("cell");
    // Columns: Cashier, Revenue, Profits, Pending, Transactions, Avg.
    expect(cells[4].textContent).toBe("4");
    expect(cells[5].textContent).toBe("0.06 USD");
  });

  it("By Client: Transactions shows the counted figure too", async () => {
    mockGetProfitByClient.mockResolvedValueOnce([
      {
        client_id: 7,
        client_name: "Client2",
        client_phone: null,
        revenue_usd: 10,
        revenue_lbp: 0,
        profit_usd: 0.24,
        profit_lbp: 0,
        transaction_count: 5,
        recognized_transaction_count: 4,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by client/i }));
    const row = (await screen.findByText("Client2")).closest(
      "tr",
    ) as HTMLElement;
    const cells = within(row).getAllByRole("cell");
    // Columns: #, Client, Revenue, Profits, Pending, Transactions.
    expect(cells[5].textContent).toBe("4");
  });
});

describe("Profits Overview — badges and zero amounts", () => {
  it("Product Sales: the badge says the count is net of refunds/voids", async () => {
    await renderPage();
    const card = cardOf("Product Sales");
    expect(card.textContent).toContain("0 net sales");
    expect(card.textContent).toMatch(
      /voided, fully refunded and unpaid sales are not counted/i,
    );
  });

  it("Custom Services: an empty count reads '0 jobs', never a bare 'jobs'", async () => {
    mockGetProfitSummary.mockReset();
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      custom_services: { ...moduleZero(), count: null },
    });
    await renderPage();
    const card = cardOf("Custom Services");
    expect(within(card).getByText("0 jobs")).toBeInTheDocument();
  });

  it("zero Cost and Expenses lines read '0', never '-0'", async () => {
    await renderPage();
    for (const title of ["Product Sales", "Maintenance", "Expenses Deducted"]) {
      const card = cardOf(title);
      expect(card.textContent).not.toMatch(/-0 (USD|LBP)/);
    }
    expect(
      within(cardOf("Expenses Deducted")).getByText("0 USD"),
    ).toBeInTheDocument();
  });

  it("a real cost still carries its minus sign", async () => {
    mockGetProfitSummary.mockReset();
    mockGetProfitSummary.mockResolvedValue({
      ...baseSummary(),
      sales: {
        revenue_usd: 10,
        cost_usd: 4,
        profit_usd: 6,
        profit_lbp: 0,
        count: 1,
      },
      expenses: { total_usd: 3, total_lbp: 0, count: 1 },
    });
    await renderPage();
    expect(
      within(cardOf("Product Sales")).getByText("-4 USD"),
    ).toBeInTheDocument();
    expect(
      within(cardOf("Expenses Deducted")).getByText("-3 USD"),
    ).toBeInTheDocument();
  });

  it("By Date: a zero expenses TOTAL reads '0 USD', not '-0 USD'", async () => {
    mockGetProfitByDate.mockResolvedValueOnce([
      {
        date: "2026-10-07",
        revenue_usd: 10,
        revenue_lbp: 0,
        profit_usd: 1,
        profit_lbp: 0,
        expenses_usd: 0,
        expenses_lbp: 0,
        net_profit_usd: 1,
        net_profit_lbp: 0,
      },
    ]);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by date/i }));
    const total = await screen.findByTestId("by-date-total-row");
    expect(total.textContent).not.toMatch(/-0 USD/);
  });
});
