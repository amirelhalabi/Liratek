/** @jest-environment jsdom */

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
import {
  createFinancialServiceSchema,
  createRechargeSchema,
} from "@liratek/core";
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

const STALE_OUT: PaymentLine = {
  id: "R1",
  method: "CASH",
  currencyCode: "USD",
  amount: 5,
  direction: "OUT",
} as PaymentLine;

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatshForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
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
    onReturnChange,
    onKeptChange,
  }: {
    setCryptoAmount: (v: string) => void;
    setCryptoFee: (v: string) => void;
    setCryptoType: (t: "SEND" | "RECEIVE") => void;
    handleCryptoSubmit: () => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
    onReturnChange?: (legs: PaymentLine[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
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
      {/* Change left over from an earlier SEND on the same sheet. */}
      <button
        data-testid="crypto-stale-change"
        onClick={() => onReturnChange?.([STALE_OUT])}
      />
      <button
        data-testid="crypto-payout-short"
        onClick={() => {
          onPaymentLinesChange([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "USD",
              amount: 97.5,
            } as PaymentLine,
          ]);
          onKeptChange?.({ usd: 0.5, lbp: 0 });
        }}
      />
      {/* SEND under-return on the same sheet: customer-mode kept change. */}
      <button
        data-testid="crypto-send-kept"
        onClick={() => onKeptChange?.({ usd: 4, lbp: 0 })}
      />
      <button
        data-testid="crypto-payout-exact"
        onClick={() =>
          onPaymentLinesChange([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "USD",
              amount: 98,
            } as PaymentLine,
          ])
        }
      />
      <button data-testid="crypto-confirm" onClick={handleCryptoSubmit} />
    </div>
  ),
  TelecomForm: ({
    setPhoneNumber,
    setTelecomAmount,
    setTelecomPrice,
    isShopLineMatch,
    setPaymentLines,
    onReturnChange,
    onKeptChange,
    handleTelecomSubmit,
  }: {
    setPhoneNumber: (v: string) => void;
    setTelecomAmount: (v: string) => void;
    setTelecomPrice: (v: string) => void;
    isShopLineMatch: boolean;
    setPaymentLines: (lines: PaymentLine[]) => void;
    onReturnChange?: (legs: PaymentLine[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
    handleTelecomSubmit: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <div data-testid="is-shop-line-match">{String(isShopLineMatch)}</div>
      <button
        data-testid="buyback-fill"
        onClick={() => {
          setPhoneNumber("70123456");
          setTelecomAmount("10");
          setTelecomPrice("750000");
        }}
      />
      {/* Change left over from an ordinary credit sale on the same tab. */}
      <button
        data-testid="telecom-stale-change"
        onClick={() => onReturnChange?.([STALE_OUT])}
      />
      <button
        data-testid="buyback-payout-short"
        onClick={() => {
          setPaymentLines([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "LBP",
              amount: 700000,
            } as PaymentLine,
          ]);
          onKeptChange?.({ usd: 0, lbp: 50000 });
        }}
      />
      {/* Ordinary credit sale under-return: customer-mode kept change. */}
      <button
        data-testid="telecom-sale-kept"
        onClick={() => onKeptChange?.({ usd: 0, lbp: 20000 })}
      />
      <button
        data-testid="buyback-payout-exact"
        onClick={() =>
          setPaymentLines([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "LBP",
              amount: 750000,
            } as PaymentLine,
          ])
        }
      />
      <button data-testid="telecom-confirm" onClick={handleTelecomSubmit} />
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
}

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
  mockProcessRecharge.mockClear();
});

describe("Recharge page — payouts carry kept change, never change legs", () => {
  it("Binance cash-out: kept_change_usd rides the payload; a stale change leg does not", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    fireEvent.click(screen.getByTestId("crypto-stale-change"));
    fireEvent.click(screen.getByTestId("crypto-receive-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-payout-short"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.serviceType).toBe("RECEIVE");
    expect(parsed.kept_change_usd).toBe(0.5);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 97.5 }),
    ]);
    expect(
      (parsed.payments ?? []).some((l) => l.direction === "OUT"),
    ).toBe(false);
  });

  it("credit buy-back: kept_change_lbp rides the payload; a stale change leg does not", async () => {
    await renderPage();
    await screen.findByTestId("stub-telecom-form");

    fireEvent.click(screen.getByTestId("telecom-stale-change"));
    fireEvent.click(screen.getByTestId("buyback-fill"));
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "true",
      ),
    );
    fireEvent.click(screen.getByTestId("buyback-payout-short"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const parsed = createRechargeSchema.parse(
      mockProcessRecharge.mock.calls[0][0],
    );
    expect(parsed.type).toBe("CREDIT_BUYBACK");
    expect(parsed.kept_change_lbp).toBe(50000);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "LBP", amount: 700000 }),
    ]);
    expect(
      (parsed.payments ?? []).some((l) => l.direction === "OUT"),
    ).toBe(false);
  });

  it("Binance cash-out after a SEND under-return: the SEND's kept change is not sent on an exact payout", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    fireEvent.click(screen.getByTestId("crypto-send-kept"));
    fireEvent.click(screen.getByTestId("crypto-receive-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-payout-exact"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.kept_change_usd ?? 0).toBe(0);
    expect(parsed.kept_change_lbp ?? 0).toBe(0);
  });

  it("credit buy-back after a sale under-return: the sale's kept change is not sent on an exact payout", async () => {
    await renderPage();
    await screen.findByTestId("stub-telecom-form");

    fireEvent.click(screen.getByTestId("telecom-sale-kept"));
    fireEvent.click(screen.getByTestId("buyback-fill"));
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "true",
      ),
    );
    fireEvent.click(screen.getByTestId("buyback-payout-exact"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const parsed = createRechargeSchema.parse(
      mockProcessRecharge.mock.calls[0][0],
    );
    expect(parsed.type).toBe("CREDIT_BUYBACK");
    expect(parsed.kept_change_usd ?? 0).toBe(0);
    expect(parsed.kept_change_lbp ?? 0).toBe(0);
  });
});
