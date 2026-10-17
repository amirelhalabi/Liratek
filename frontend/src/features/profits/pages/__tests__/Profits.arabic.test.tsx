/** @jest-environment jsdom */

/**
 * LIRA-331 (T067) — the Profits page renders in Arabic when the language is
 * `ar`, and the English text stays byte-identical in `en`. One check per
 * main screen (Overview, By Module, Commissions, Pending Profit).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { i18n } from "@/i18n/setup";
import Profits from "../Profits";

const mockGetProfitSummary = jest.fn();
const mockGetProfitByModule = jest.fn();
const mockGetProfitsCommissions = jest.fn();
const mockGetPendingProfit = jest.fn();

// rule 25 — one stable object for the whole file.
const mockApi = {
  getProfitSummary: mockGetProfitSummary,
  getProfitByModule: mockGetProfitByModule,
  getProfitsCommissions: mockGetProfitsCommissions,
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
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

const zeroModule = {
  revenue_usd: 0,
  revenue_lbp: 0,
  cost_usd: 0,
  cost_lbp: 0,
  profit_usd: 0,
  profit_lbp: 0,
  count: 0,
};

function summary() {
  return {
    period: "x to y",
    sales: { revenue_usd: 10, cost_usd: 4, profit_usd: 6, count: 1 },
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
    mobile_services: zeroModule,
    recharges: zeroModule,
    custom_services: zeroModule,
    maintenance: zeroModule,
    loto: { revenue_lbp: 0, profit_lbp: 0, count: 0 },
    exchange: { revenue_usd: 0, profit_usd: 0, count: 0 },
    expenses: { total_usd: 0, total_lbp: 0, count: 0 },
    totals: {
      gross_revenue_usd: 10,
      gross_revenue_lbp: 0,
      total_cost_usd: 4,
      total_cost_lbp: 0,
      gross_profit_usd: 6,
      gross_profit_lbp: 0,
      net_profit_usd: 6,
      net_profit_lbp: 0,
    },
  };
}

async function switchToArabic() {
  const { loadLanguage } = await import("@/i18n/setup");
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProfitSummary.mockResolvedValue(summary());
  mockGetProfitByModule.mockResolvedValue([
    {
      module: "SALE",
      label: "Sales",
      ...zeroModule,
      revenue_usd: 10,
      cost_usd: 4,
      profit_usd: 6,
      count: 1,
    },
  ]);
  mockGetProfitsCommissions.mockResolvedValue({
    from: "x",
    to: "y",
    realized_usd: 0,
    realized_lbp: 0,
    revenue_usd: 0,
    revenue_lbp: 0,
    pending_usd: 0,
    pending_lbp: 0,
    total_owed_usd: 0,
    total_owed_lbp: 0,
    awaiting_settlement_count: 0,
    bill_count: 0,
    byProvider: [],
    excludedProviders: [],
  });
  mockGetPendingProfit.mockResolvedValue({
    rows: [],
    totals: { total_outstanding_usd: 0, total_pending_profit_usd: 0, count: 0 },
    unsettled_commissions: [],
    unsettled_totals: {
      total_pending_commission_usd: 0,
      total_pending_commission_lbp: 0,
      count: 0,
    },
  });
});

afterEach(() => i18n.changeLanguage("en"));

describe("Profits — Arabic UI (LIRA-331)", () => {
  it("keeps the English Overview text unchanged", async () => {
    render(<Profits />);
    expect(
      await screen.findByText("Total Net Profit"),
    ).toBeInTheDocument();
    expect(screen.getByText("Product Sales")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cash intake by method/ }))
      .toBeInTheDocument();
  });

  it("renders the Overview in Arabic, data labels untouched", async () => {
    await switchToArabic();
    render(<Profits />);
    expect(await screen.findByText("صافي الربح الإجمالي")).toBeInTheDocument();
    expect(screen.getByText("مبيعات المنتجات")).toBeInTheDocument();
    expect(screen.getByText("1 مبيعة صافية")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /المقبوضات حسب طريقة الدفع/ }),
    ).toBeInTheDocument();
    // amounts are never translated
    expect(screen.getAllByText("6 USD").length).toBeGreaterThan(0);
  });

  it("renders the By Module tab in Arabic, the module label stays as sent", async () => {
    await switchToArabic();
    render(<Profits />);
    await screen.findByText("صافي الربح الإجمالي");
    fireEvent.click(screen.getByRole("button", { name: /حسب القسم/ }));
    await waitFor(() => expect(mockGetProfitByModule).toHaveBeenCalled());
    expect(await screen.findByText("القسم")).toBeInTheDocument();
    expect(screen.getByText("المجموع")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
  });

  it("renders the Commissions tab in Arabic", async () => {
    await switchToArabic();
    render(<Profits />);
    await screen.findByText("صافي الربح الإجمالي");
    fireEvent.click(screen.getByRole("button", { name: /العمولات/ }));
    expect(
      await screen.findByText("أداء المزوّدين (الفترة المحدّدة / حتى الآن)"),
    ).toBeInTheDocument();
    expect(screen.getByText("لا بيانات للمزوّدين")).toBeInTheDocument();
  });

  it("renders the Pending Profit tab in Arabic", async () => {
    await switchToArabic();
    render(<Profits />);
    await screen.findByText("صافي الربح الإجمالي");
    fireEvent.click(screen.getByRole("button", { name: /الأرباح المعلّقة/ }));
    expect(await screen.findByText("مبيعات غير مدفوعة")).toBeInTheDocument();
    expect(screen.getByText("لا مبيعات غير مدفوعة")).toBeInTheDocument();
  });
});
