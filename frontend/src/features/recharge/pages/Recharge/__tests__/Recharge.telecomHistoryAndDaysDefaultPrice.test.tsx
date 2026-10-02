/** @jest-environment jsdom */

/**
 * LIRA-185 display batch — recharge lane, leads #6 and #12 (audit journal
 * wf_a89a1432-255, verify:recharge).
 *
 * #6 — `loadRechargeHistory` (Recharge/index.tsx) hand-builds a
 * `FinancialTransaction` per `recharges` row and dropped `is_refunded`/
 * `refunded_at`, although `RechargeRepository.getHistory` projects both
 * (LIRA-131). HistoryModal reads `Boolean(tx.is_refunded)`, so a refunded
 * MTC/Alfa sale never showed as refunded in the module's History. Same
 * defect the Binance mapping already had fixed (Recharge.binanceRefundedMapping
 * .test.tsx).
 *
 * #12 — `handleTelecomSubmit` sent `default_price_to_client = amount x
 * alfaCreditSellRate` unconditionally. On the Days tab `amount` is a DAY
 * COUNT, so a 30-day sale sent 30 x 100,000 = 3,000,000 LBP as the "default
 * price", which made HistoryModal's margin-override alert impossible to fire
 * for Days rows. Days now OMITS the field: `rechargeSchema` declares it
 * `.optional()` (a `null` would fail validation), and the repository stores
 * `?? null`, which HistoryModal already treats as "no alert".
 *
 * Rule 25: the `useApi()` mock returns ONE stable object.
 * Rule 17: written before the fix; the red run is recorded in the task report.
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
  KatchForm: () => null,
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
    }>;
    onRefreshHistory?: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <span data-testid="recharge-type">{rechargeType}</span>
      <button
        data-testid="tab-days"
        onClick={() => setRechargeType("DAYS")}
      />
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
          is_refunded={String(tx.is_refunded)} refunded_at=
          {String(tx.refunded_at)}
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

describe("Recharge page — telecom history + Days default price (LIRA-185 #6, #12)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllSettings.mockResolvedValue([
      { key_name: "alfa_credit_sell_rate_lbp", value: "100000" },
      { key_name: "alfa_credit_cost_lbp", value: "85000" },
    ]);
    mockProcessRecharge.mockResolvedValue({ success: true, id: 1 });
    // Shaped like RechargeRepository.getHistory's projection (LIRA-131).
    mockGetRechargeHistory.mockResolvedValue([
      {
        id: 1,
        carrier: "MTC",
        recharge_type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 255000,
        price: 300000,
        default_price_to_client: 300000,
        currency_code: "LBP",
        paid_by: "CASH",
        phone_number: "71111111",
        client_name: null,
        created_at: "2026-10-01 10:00:00",
        is_refunded: 1,
        refunded_at: "2026-10-01 11:00:00",
      },
      {
        id: 2,
        carrier: "MTC",
        recharge_type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 255000,
        price: 300000,
        default_price_to_client: 300000,
        currency_code: "LBP",
        paid_by: "CASH",
        phone_number: "71111112",
        client_name: null,
        created_at: "2026-10-01 09:00:00",
        is_refunded: 0,
        refunded_at: null,
      },
    ]);
  });

  it("#6: the MTC/Alfa history mapping keeps is_refunded/refunded_at", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("open-history"));
    await waitFor(() =>
      expect(mockGetRechargeHistory).toHaveBeenCalledWith("MTC"),
    );

    const refunded = await screen.findByTestId("history-1");
    expect(refunded.textContent).toContain("is_refunded=1");
    expect(refunded.textContent).toContain("refunded_at=2026-10-01 11:00:00");

    const live = await screen.findByTestId("history-2");
    expect(live.textContent).toContain("is_refunded=0");
    expect(live.textContent).toContain("refunded_at=null");
  });

  it("#12: a Days sale omits default_price_to_client instead of sending days x sell rate", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("tab-days"));
    await waitFor(() =>
      expect(screen.getByTestId("recharge-type").textContent).toBe("DAYS"),
    );
    fireEvent.change(screen.getByTestId("amount"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByTestId("price"), {
      target: { value: "200000" },
    });
    fireEvent.change(screen.getByTestId("days-cost"), {
      target: { value: "2" },
    });

    fireEvent.click(screen.getByTestId("confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.type).toBe("DAYS");
    expect(payload.amount).toBe(30);
    expect(payload.price).toBe(200000);
    expect(payload.default_price_to_client).toBeUndefined();
  });

  it("#12 control: a credit sale still sends amount x sell rate", async () => {
    await renderPage();
    fireEvent.change(screen.getByTestId("amount"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByTestId("price"), {
      target: { value: "300000" },
    });

    fireEvent.click(screen.getByTestId("confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.type).toBe("CREDIT_TRANSFER");
    expect(payload.default_price_to_client).toBe(300000);
  });
});
