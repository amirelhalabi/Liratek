/** @jest-environment jsdom */

/**
 * Owner decision D3 (2026-10-06) — the Dashboard "Pending Settlement" banner
 * must cover every ledger, not only suppliers: one line per partner with a
 * non-zero balance, fed by `api.partners.getAllBalances()` (dual-mode via
 * useApi()). Partner balance = DEBIT - CREDIT; > 0 means the partner owes
 * the shop ("owes you"), < 0 means the shop owes the partner ("you owe").
 *
 * `useApi` returns the module-level `mockApi` — a STABLE reference (rule 25).
 * formatAmount is mocked to "<value> <currency>".
 */

import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "../Dashboard";

jest.setTimeout(5000);

const mockGetUnsettledSummary = jest.fn();
const mockGetAllBalances = jest.fn();

const mockApi = {
  getDashboardStats: jest.fn().mockResolvedValue({
    totalSalesUSD: 0,
    totalSalesLBP: 0,
    cashCollectedUSD: 0,
    cashCollectedLBP: 0,
    ordersCount: 0,
    activeClients: 0,
  }),
  getProfitSalesChart: jest.fn().mockResolvedValue([]),
  getTodaysSales: jest.fn().mockResolvedValue([]),
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({}),
  getDebtSummary: jest.fn().mockResolvedValue({
    totalDebt: 0,
    totalDebtUsd: 0,
    totalDebtLbp: 0,
    topDebtors: [],
  }),
  getInventoryStockStats: jest
    .fn()
    .mockResolvedValue({ stock_budget_usd: 0, stock_count: 0 }),
  getNetProfitLast30Days: jest.fn().mockResolvedValue({
    netProfitUSD: 0,
    netProfitLBP: 0,
    fromDate: "2026-08-26",
    toDate: "2026-09-24",
  }),
  getDebtors: jest.fn().mockResolvedValue([]),
  getUnsettledSummary: mockGetUnsettledSummary,
  partners: { getAllBalances: mockGetAllBalances },
  getAllActiveCarrierLines: jest.fn().mockResolvedValue([]),
  // LIRA-086 — Dashboard now also calls useSellRate() (checkpoint variance
  // coloring), which reads api.getRates(); unmocked throws synchronously.
  getRates: jest.fn().mockResolvedValue([]),
  hasInitialBalancesSet: jest.fn().mockResolvedValue(true),
  holdMoney: {
    active: jest.fn().mockResolvedValue({ success: true, data: [] }),
  },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => jest.fn(),
}));

jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ isModuleEnabled: () => false }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
    getSymbol: (c: string) => (c === "USD" ? "$" : "LBP"),
  }),
}));

jest.mock("@/contexts/FeatureFlagContext", () => ({
  useFeatureFlags: () => ({
    flags: { sessionManagement: false, customerSessions: false },
    refreshFlags: async () => {},
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "cashier", username: "test" } }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

// Chart and modals are irrelevant to the banner — stubbed (same as the
// sibling Dashboard.awaitingSettlementCount.test.tsx).
jest.mock("../../components/DashboardChart", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../../components/DrawerTopUpModal", () => ({
  DrawerTopUpModal: () => null,
}));
jest.mock("../../components/DrawerCashoutModal", () => ({
  DrawerCashoutModal: () => null,
}));
jest.mock("../../../closing/components/InitialDrawerAmountsModal", () => ({
  InitialDrawerAmountsModal: () => null,
}));

const supplierRow = {
  provider: "OMT",
  count: 2,
  bill_count: 0,
  pending_commission_usd: 0,
  pending_commission_lbp: 0,
  total_owed_usd: 0,
  total_owed_lbp: 0,
  awaiting_settlement_count: 2,
};

function partner(id: number, name: string, usd: number, lbp: number, usdt = 0) {
  return { id, name, usd, lbp, usdt, is_active: 1 };
}

async function renderAndWaitForPartners() {
  render(<Dashboard />);
  await waitFor(() => expect(mockGetAllBalances).toHaveBeenCalledTimes(1));
}

function lineFor(name: string) {
  return screen
    .getAllByTestId("partner-settlement-line")
    .find((el) => el.textContent?.startsWith(`${name} (partner):`));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUnsettledSummary.mockResolvedValue([]);
  mockGetAllBalances.mockResolvedValue([]);
});

describe("Dashboard — Pending Settlement banner partner lines (D3)", () => {
  it("renders 'you owe' when the shop owes the partner (negative balance)", async () => {
    mockGetAllBalances.mockResolvedValue([partner(1, "Ali", -303, 0)]);
    await renderAndWaitForPartners();

    await screen.findByTestId("partner-settlement-line");
    expect(lineFor("Ali")?.textContent).toBe("Ali (partner): you owe 303 USD");
    // Fetched with inactive partners included — an open balance on a
    // deactivated partner still has to be settled.
    expect(mockGetAllBalances).toHaveBeenCalledWith(true);
  });

  it("renders 'owes you' when the partner owes the shop (positive balance)", async () => {
    mockGetAllBalances.mockResolvedValue([partner(2, "Sami", 120, 0)]);
    await renderAndWaitForPartners();

    await screen.findByTestId("partner-settlement-line");
    expect(lineFor("Sami")?.textContent).toBe(
      "Sami (partner): owes you 120 USD",
    );
  });

  it("shows both USD and LBP when both are non-zero, and splits mixed directions", async () => {
    mockGetAllBalances.mockResolvedValue([
      partner(1, "Ali", -303, -4500000),
      partner(2, "Sami", 50, -900000),
    ]);
    await renderAndWaitForPartners();

    await screen.findAllByTestId("partner-settlement-line");
    expect(lineFor("Ali")?.textContent).toBe(
      "Ali (partner): you owe 303 USD + 4500000 LBP",
    );
    expect(lineFor("Sami")?.textContent).toBe(
      "Sami (partner): you owe 900000 LBP; owes you 50 USD",
    );
  });

  it("omits partners whose balance is zero (within the settle threshold) in every currency", async () => {
    mockGetAllBalances.mockResolvedValue([
      partner(1, "Ali", -303, 0),
      partner(3, "Zero", 0, 0.001),
    ]);
    await renderAndWaitForPartners();

    await screen.findByTestId("partner-settlement-line");
    expect(screen.getAllByTestId("partner-settlement-line")).toHaveLength(1);
    expect(screen.queryByText(/Zero \(partner\)/)).toBeNull();
  });

  it("renders the banner with partner lines only — no supplier rows, no fake transaction count", async () => {
    mockGetUnsettledSummary.mockResolvedValue([]);
    mockGetAllBalances.mockResolvedValue([partner(1, "Ali", -303, 0)]);
    await renderAndWaitForPartners();

    await screen.findByTestId("partner-settlement-line");
    const heading = screen.getByText(/^Pending Settlement/);
    expect(heading.textContent?.trim()).toBe("Pending Settlement");
    expect(heading.textContent).not.toMatch(/transaction/);
    // Supplier-only footer is not shown when there are no supplier rows.
    expect(screen.queryByText(/Supplier Ledger/)).toBeNull();
    expect(
      screen.getByText(/Settle partner balances via Partners/),
    ).toBeTruthy();
  });

  it("keeps the supplier transaction count and lists partner lines underneath", async () => {
    mockGetUnsettledSummary.mockResolvedValue([supplierRow]);
    mockGetAllBalances.mockResolvedValue([partner(1, "Ali", 120, 0)]);
    await renderAndWaitForPartners();

    await screen.findByText(/Pending Settlement — 2 transactions/);
    await screen.findByTestId("partner-settlement-line");
    expect(lineFor("Ali")?.textContent).toBe("Ali (partner): owes you 120 USD");
    expect(screen.getByText(/OMT:/)).toBeTruthy();
  });

  it("shows no banner when there are neither supplier rows nor open partner balances", async () => {
    mockGetAllBalances.mockResolvedValue([partner(3, "Zero", 0, 0)]);
    await renderAndWaitForPartners();
    await waitFor(() => expect(mockGetUnsettledSummary).toHaveBeenCalled());

    expect(screen.queryByText(/^Pending Settlement/)).toBeNull();
    expect(screen.queryByTestId("partner-settlement-line")).toBeNull();
  });
});
