/**
 * LIRA-269 — Recharge page, Binance cash-out (crypto RECEIVE) with a
 * discount. The discount comes off the shop's fee: the payload books
 * `commission = fee − discount` (walletReceiveAmounts, the helper the
 * server pays out by) and the payout leg is the RAISED payout. Before the
 * fix the page never listened to the sheet's discount, so it booked the
 * full fee and the server expected the undiscounted payout.
 *
 * CryptoForm stubbed so the real submit closure is driven directly; the
 * payload is parsed through the core schema (rule 24); the useApi mock is
 * a stable reference (rule 25).
 */

/**
 * Recharge page — the two payouts it submits itself: Binance cash-out
 * (crypto RECEIVE) and the MTC/Alfa credit buy-back. Owner decisions
 * 2026-10-07 (FEATURE_GUIDE §4.1 "Kept change"): a payout never carries a
 * change (OUT) leg, and a small shortfall the shop keeps rides the SAME
 * payload as `kept_change_*` (the server verifies it). Change legs left in
 * page state by an earlier customer payment (a SEND / an ordinary credit
 * sale on the same tab) must never leak into a payout payload.
 *
 * Subcomponents are stubbed so the real submit closures are driven
 * directly. Payloads are parsed through the core schemas (rule 24); the
 * useApi mock returns a stable reference (rule 25).
 * Rule 17: run against the pre-change page first — see the task report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import { createFinancialServiceSchema } from "@liratek/core";
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
        data-testid="crypto-receive-100-fee-2"
        onClick={() => {
          setCryptoType("RECEIVE");
          setCryptoAmount("100");
          setCryptoFee("2");
        }}
      />
      <button
        data-testid="crypto-discount-0.5"
        onClick={() => onDiscountChange?.(0.5)}
      />
      <button
        data-testid="crypto-payout-100.5"
        onClick={() =>
          onPaymentLinesChange([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 100.5 },
          ])
        }
      />
      <button
        data-testid="crypto-payout-100-keep-0.5"
        onClick={() => {
          onPaymentLinesChange([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 100 },
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

describe("Recharge page — Binance cash-out with a discount", () => {
  it("books commission = fee − discount and pays out the raised amount", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("crypto-receive-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-discount-0.5"));
    fireEvent.click(screen.getByTestId("crypto-payout-100.5"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.serviceType).toBe("RECEIVE");
    // 100 USDT + $2 fee on top arrives in the wallet — unchanged by the discount.
    expect(parsed.amount).toBe(102);
    expect(parsed.commission).toBe(1.5);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 100.5 }),
    ]);
    expect(parsed.kept_change_usd ?? 0).toBe(0);
  });

  it("kept change rides on top of the discount", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("crypto-receive-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-discount-0.5"));
    fireEvent.click(screen.getByTestId("crypto-payout-100-keep-0.5"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.commission).toBe(1.5);
    expect(parsed.kept_change_usd).toBe(0.5);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 100 }),
    ]);
  });
});
