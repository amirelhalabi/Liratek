/**
 * LIRA-269 follow-up — Recharge page, Binance SEND with a discount.
 *
 * The discount comes off the shop's fee: the payload books `commission =
 * fee − discount` and sends `checkoutTotal = amount + commission`
 * (walletSendAmounts — the helper the server checks the total against), so
 * the server reconciles the cash legs against what the customer really
 * paid. Before the fix the page booked the full fee as the commission while
 * the cash taken in was short by the discount, and sent no total at all, so
 * nothing caught the gap.
 *
 * CryptoForm is stubbed so the real submit closure is driven directly;
 * payloads are parsed through the core schema (rule 24); the useApi mock
 * is a stable reference (rule 25).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import { createFinancialServiceSchema, walletSendAmounts } from "@liratek/core";
import MobileRecharge from "../index";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true });
const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockApi = {
  getAllSettings: mockGetAllSettings,
  getOMTHistory: jest.fn().mockResolvedValue([]),
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getClients: jest.fn().mockResolvedValue([]),
  processRecharge: mockProcessRecharge,
  addOMTTransaction: mockAddOMTTransaction,
  getActiveCarrierLines: jest.fn().mockResolvedValue([
    {
      id: 1,
      carrier: "mtc",
      phone_number: "70123456",
      credits: 0,
      validity_expires_at: null,
      is_active: 1,
      is_primary: 1,
    },
  ]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

(globalThis as unknown as { window: { api: unknown } }).window = {
  ...(globalThis as unknown as { window: Record<string, unknown> }).window,
  api: {
    recharge: {
      getStock: jest.fn().mockResolvedValue({ mtc: 0, alfa: 0 }),
      getHistory: jest.fn().mockResolvedValue([]),
      getDrawerBalances: jest.fn().mockResolvedValue({}),
    },
  },
};


jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatshForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  TelecomForm: () => null,
  ProviderTabs: ({
    onSelectProvider,
  }: {
    onSelectProvider: (p: string) => void;
  }) => (
    <button
      data-testid="select-binance"
      onClick={() => onSelectProvider("BINANCE")}
    />
  ),
  CryptoForm: ({
    setCryptoAmount,
    setCryptoFee,
    setCryptoType,
    handleCryptoSubmit,
    onPaymentLinesChange,
    onKeptChange,
    onDiscountChange,
  }: {
    setCryptoAmount: (v: string) => void;
    setCryptoFee: (v: string) => void;
    setCryptoType: (t: "SEND" | "RECEIVE") => void;
    handleCryptoSubmit: () => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
    onDiscountChange?: (d: number) => void;
  }) => (
    <div data-testid="stub-crypto-form">
      <button
        data-testid="crypto-send-100-fee-2"
        onClick={() => {
          setCryptoType("SEND");
          setCryptoAmount("100");
          setCryptoFee("2");
        }}
      />
      <button
        data-testid="crypto-discount-0.5"
        onClick={() => onDiscountChange?.(0.5)}
      />
      <button
        data-testid="crypto-pay-101.5"
        onClick={() =>
          onPaymentLinesChange([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 101.5 },
          ])
        }
      />
      <button
        data-testid="crypto-pay-102"
        onClick={() =>
          onPaymentLinesChange([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 102 },
          ])
        }
      />
      <button
        data-testid="crypto-pay-102-keep-0.5"
        onClick={() => {
          onPaymentLinesChange([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 102 },
          ]);
          onKeptChange?.({ usd: 0.5, lbp: 0 });
        }}
      />
      <button data-testid="crypto-confirm" onClick={handleCryptoSubmit} />
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
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
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
  fireEvent.click(screen.getByTestId("select-binance"));
  await screen.findByTestId("stub-crypto-form");
}

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
});

describe("Recharge page — Binance SEND with a discount", () => {
  it("books commission = fee − discount and sends the discounted checkoutTotal", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("crypto-send-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-discount-0.5"));
    fireEvent.click(screen.getByTestId("crypto-pay-101.5"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    const expected = walletSendAmounts({
      walletOutflow: 100,
      fee: 2,
      discount: 0.5,
    });
    expect(parsed.serviceType).toBe("SEND");
    // The wallet still sends the full 100 USDT.
    expect(parsed.amount).toBe(100);
    expect(parsed.commission).toBe(expected.commission);
    expect(parsed.checkoutTotal).toEqual({
      usd: expected.customerPays,
      lbp: 0,
    });
  });

  it("no discount: the full fee is booked and the total is amount + fee", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("crypto-send-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-pay-102"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.commission).toBe(2);
    expect(parsed.checkoutTotal).toEqual({ usd: 102, lbp: 0 });
  });

  it("kept change rides on top of the discount", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("crypto-send-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-discount-0.5"));
    fireEvent.click(screen.getByTestId("crypto-pay-102-keep-0.5"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.commission).toBe(1.5);
    expect(parsed.kept_change_usd).toBe(0.5);
    expect(parsed.checkoutTotal).toEqual({ usd: 101.5, lbp: 0 });
  });
});
