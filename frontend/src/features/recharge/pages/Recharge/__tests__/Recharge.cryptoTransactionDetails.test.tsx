/**
 * LIRA-329 T019 — a Binance transfer sends what the transaction keeps in
 * its details: the discount exactly as typed, who pays the fee, and the
 * wallet / reference. Harness copied from Recharge.cryptoSendDiscount
 * (CryptoForm stubbed so the page's real submit closure runs; stable
 * useApi object, rule 25).
 *
 * Field names come from the core schema (rule 24).
 *
 * Rule 17: run against the unchanged page first and seen failing (typed
 * discount and fee payer absent); the reference assertion passed — it was
 * already sent.
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
    setFeeIncluded,
    setCryptoDescription,
  }: {
    setCryptoAmount: (v: string) => void;
    setCryptoFee: (v: string) => void;
    setCryptoType: (t: "SEND" | "RECEIVE") => void;
    handleCryptoSubmit: () => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
    onDiscountChange?: (d: number) => void;
    setFeeIncluded: (v: boolean) => void;
    setCryptoDescription: (v: string) => void;
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
      <button
        data-testid="crypto-fee-included"
        onClick={() => setFeeIncluded(true)}
      />
      <button
        data-testid="crypto-reference"
        onClick={() => setCryptoDescription("TRX-0x99")}
      />
      <button
        data-testid="crypto-pay-100"
        onClick={() =>
          onPaymentLinesChange([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 100 },
          ])
        }
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

describe("Recharge page — LIRA-329 Binance details fields", () => {
  it("a discounted send: discount as typed, fee on top paid by the sender, the reference", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("crypto-send-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-reference"));
    fireEvent.click(screen.getByTestId("crypto-discount-0.5"));
    fireEvent.click(screen.getByTestId("crypto-pay-101.5"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.typedDiscount).toEqual({ amount: 0.5, currency: "USD" });
    expect(parsed.feePaidBy).toBe("SENDER");
    expect(parsed.referenceNumber).toBe("TRX-0x99");
  });

  it("fee included in the amount: the fee is deducted", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("crypto-send-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-fee-included"));
    fireEvent.click(screen.getByTestId("crypto-pay-100"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.feePaidBy).toBe("DEDUCTED");
    expect(parsed.typedDiscount).toBeUndefined();
  });
});
