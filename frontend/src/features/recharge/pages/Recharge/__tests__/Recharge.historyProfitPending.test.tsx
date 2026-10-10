/** @jest-environment jsdom */

/**
 * LIRA-185 owner decision #4 (2026-10-02) — MTC/Alfa History, a sale charged
 * to a customer's account keeps its profit figure with a "pending until
 * paid" label, matching the Profits page's deferral.
 *
 * Page half: `loadRechargeHistory` hand-builds each `FinancialTransaction`
 * and must carry the `profit_pending` flag `RechargeRepository.getHistory`
 * now projects (same rule as the Profits page, `notDebtPending`) — the same
 * trap that once dropped `is_refunded` (#6). Harness copied from
 * `Recharge.telecomHistoryAndDaysDefaultPrice.test.tsx` (stable `useApi()`
 * mock, rule 25). Rule 17: written before the fix; red run in the report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn();
const mockProcessRecharge = jest.fn();
const mockGetRechargeHistory = jest.fn();

const mockApi = {
  getAllSettings: mockGetAllSettings,
  getClients: jest.fn().mockResolvedValue([]),
  processRecharge: mockProcessRecharge,
  getRechargeHistory: mockGetRechargeHistory,
  getRechargeDrawerBalances: jest.fn().mockResolvedValue([]),
  getRechargeTodayStats: jest.fn().mockResolvedValue({
    count: 0,
    profit_usd: 0,
    profit_lbp: 0,
    byCurrency: [],
  }),
  getActiveCarrierLines: jest.fn().mockResolvedValue([]),
  getOMTHistory: jest.fn().mockResolvedValue([]),
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatshForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: ({
    rechargeType,
    setRechargeType,
    telecomAmount,
    setTelecomAmount,
    telecomPrice,
    setTelecomPrice,
    telecomDaysCostUsd,
    setTelecomDaysCostUsd,
    handleTelecomSubmit,
    rechargeHistory,
    onRefreshHistory,
  }: {
    rechargeType: string;
    setRechargeType: (t: string) => void;
    telecomAmount: string;
    setTelecomAmount: (v: string) => void;
    telecomPrice: string;
    setTelecomPrice: (v: string) => void;
    telecomDaysCostUsd: string;
    setTelecomDaysCostUsd: (v: string) => void;
    handleTelecomSubmit: () => void;
    rechargeHistory: Array<{
      id: number;
      is_refunded?: number;
      refunded_at?: string | null;
      profit_pending?: boolean;
    }>;
    onRefreshHistory?: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <span data-testid="recharge-type">{rechargeType}</span>
      <button data-testid="tab-days" onClick={() => setRechargeType("DAYS")} />
      <button data-testid="open-history" onClick={() => onRefreshHistory?.()} />
      <input
        data-testid="amount"
        value={telecomAmount}
        onChange={(e) => setTelecomAmount(e.target.value)}
      />
      <input
        data-testid="price"
        value={telecomPrice}
        onChange={(e) => setTelecomPrice(e.target.value)}
      />
      <input
        data-testid="days-cost"
        value={telecomDaysCostUsd}
        onChange={(e) => setTelecomDaysCostUsd(e.target.value)}
      />
      <button data-testid="confirm" onClick={handleTelecomSubmit} />
      {rechargeHistory.map((tx) => (
        <div key={tx.id} data-testid={`history-${tx.id}`}>
          profit_pending={String(tx.profit_pending)}
        </div>
      ))}
    </div>
  ),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 91000, buyRate: 90000 }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../hooks/useMobileServiceItems", () => ({
  useMobileServiceItems: () => ({
    getCategoriesForProvider: () => [],
    getItems: () => [],
    refresh: jest.fn(),
  }),
  formatCatalogItemName: (item: { label: string }) => item.label,
}));

jest.mock("../../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function renderPage() {
  render(<MobileRecharge />);
  await waitFor(() => expect(mockGetAllSettings).toHaveBeenCalled());
  await screen.findByTestId("stub-telecom-form");
}

describe("Recharge page — history carries the profit-pending flag (LIRA-185 #4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllSettings.mockResolvedValue([]);
    mockProcessRecharge.mockResolvedValue({ success: true, id: 1 });
    const row = {
      carrier: "MTC",
      recharge_type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 255000,
      price: 300000,
      default_price_to_client: 300000,
      currency_code: "LBP",
      phone_number: "71111111",
      client_name: "Rami",
      created_at: "2026-10-01 10:00:00",
      is_refunded: 0,
      refunded_at: null,
    };
    mockGetRechargeHistory.mockResolvedValue([
      { ...row, id: 1, paid_by: "CUSTOMER_ACCOUNT", profit_pending: 1 },
      { ...row, id: 2, paid_by: "CASH", profit_pending: 0 },
    ]);
  });

  it("maps profit_pending 1 → true (unpaid account sale) and 0 → false", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("open-history"));
    await waitFor(() =>
      expect(mockGetRechargeHistory).toHaveBeenCalledWith("MTC"),
    );
    expect((await screen.findByTestId("history-1")).textContent).toContain(
      "profit_pending=true",
    );
    expect((await screen.findByTestId("history-2")).textContent).toContain(
      "profit_pending=false",
    );
  });
});
