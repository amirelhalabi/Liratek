/** @jest-environment jsdom */

/**
 * Recharge page — payout round-up on the two payouts it submits itself
 * (LIRA-334, T024): Binance cash-out (crypto RECEIVE) and the MTC/Alfa
 * credit buy-back. Handing out a little MORE than owed is a round-up the
 * shop books as change rounding; it rides the SAME payload as
 * `rounding_given_*` (rule 22), only when reported in payout mode for the
 * payout being submitted — never on a SEND or an ordinary credit sale.
 *
 * Subcomponents are stubbed so the real submit closures are driven
 * directly (harness from Recharge.payoutKeptChange.test.tsx). Payloads are
 * parsed through the core schemas (rule 24); the useApi mock returns a
 * stable reference (rule 25).
 * Rule 17: run against the unwired page first — see the task report.
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
    onKeptChange,
    onRoundUpChange,
  }: {
    setCryptoAmount: (v: string) => void;
    setCryptoFee: (v: string) => void;
    setCryptoType: (t: "SEND" | "RECEIVE") => void;
    handleCryptoSubmit: () => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
    onRoundUpChange?: (r: { usd: number; lbp: number } | null) => void;
  }) => (
    <div data-testid="stub-crypto-form">
      <div data-testid="crypto-roundup-wired">
        {String(typeof onRoundUpChange === "function")}
      </div>
      {/* Cash-out of 100 USDT, fee 2 → $98 owed. */}
      <button
        data-testid="crypto-receive-100-fee-2"
        onClick={() => {
          setCryptoType("RECEIVE");
          setCryptoAmount("100");
          setCryptoFee("2");
        }}
      />
      <button
        data-testid="crypto-send-100-fee-2"
        onClick={() => {
          setCryptoType("SEND");
          setCryptoAmount("100");
          setCryptoFee("2");
        }}
      />
      {/* $98 owed, $98.50 handed out → $0.50 rounded up. */}
      <button
        data-testid="crypto-payout-roundup"
        onClick={() => {
          onPaymentLinesChange([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "USD",
              amount: 98.5,
            } as PaymentLine,
          ]);
          onKeptChange?.(null);
          onRoundUpChange?.({ usd: 0.5, lbp: 0 });
        }}
      />
      <button
        data-testid="crypto-payout-exact"
        onClick={() => {
          onPaymentLinesChange([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "USD",
              amount: 98,
            } as PaymentLine,
          ]);
          onRoundUpChange?.(null);
        }}
      />
      {/* Lines only (a SEND customer payment of $102). */}
      <button
        data-testid="crypto-send-pay"
        onClick={() =>
          onPaymentLinesChange([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "USD",
              amount: 102,
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
    onKeptChange,
    onRoundUpChange,
    handleTelecomSubmit,
  }: {
    setPhoneNumber: (v: string) => void;
    setTelecomAmount: (v: string) => void;
    setTelecomPrice: (v: string) => void;
    isShopLineMatch: boolean;
    setPaymentLines: (lines: PaymentLine[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
    onRoundUpChange?: (r: { usd: number; lbp: number } | null) => void;
    handleTelecomSubmit: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <div data-testid="is-shop-line-match">{String(isShopLineMatch)}</div>
      {/* The shop's own line → a credit buy-back (750,000 LBP owed). */}
      <button
        data-testid="buyback-fill"
        onClick={() => {
          setPhoneNumber("70123456");
          setTelecomAmount("10");
          setTelecomPrice("750000");
        }}
      />
      {/* A customer's number → an ordinary credit sale. */}
      <button
        data-testid="sale-fill"
        onClick={() => {
          setPhoneNumber("70999999");
          setTelecomAmount("10");
          setTelecomPrice("750000");
        }}
      />
      {/* 750,000 owed, 800,000 handed out → 50,000 rounded up. */}
      <button
        data-testid="buyback-payout-roundup"
        onClick={() => {
          setPaymentLines([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "LBP",
              amount: 800000,
            } as PaymentLine,
          ]);
          onKeptChange?.(null);
          onRoundUpChange?.({ usd: 0, lbp: 50000 });
        }}
      />
      <button
        data-testid="buyback-payout-exact"
        onClick={() => {
          setPaymentLines([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "LBP",
              amount: 750000,
            } as PaymentLine,
          ]);
          onRoundUpChange?.(null);
        }}
      />
      <button
        data-testid="sale-pay"
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

async function openBinance() {
  await renderPage();
  fireEvent.click(screen.getByTestId("select-binance"));
  await screen.findByTestId("stub-crypto-form");
}

async function fillBuyback() {
  await renderPage();
  await screen.findByTestId("stub-telecom-form");
  fireEvent.click(screen.getByTestId("buyback-fill"));
  await waitFor(() =>
    expect(screen.getByTestId("is-shop-line-match").textContent).toBe("true"),
  );
}

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
  mockProcessRecharge.mockClear();
});

describe("Recharge page — payout round-up (LIRA-334)", () => {
  it("Binance cash-out: $98.50 on $98 sends rounding_given_usd 0.5 and no kept change", async () => {
    await openBinance();
    fireEvent.click(screen.getByTestId("crypto-receive-100-fee-2"));
    await waitFor(() =>
      expect(screen.getByTestId("crypto-roundup-wired").textContent).toBe(
        "true",
      ),
    );
    fireEvent.click(screen.getByTestId("crypto-payout-roundup"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.serviceType).toBe("RECEIVE");
    expect(parsed.rounding_given_usd).toBe(0.5);
    expect(parsed.rounding_given_lbp ?? 0).toBe(0);
    expect(parsed.kept_change_usd).toBeUndefined();
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 98.5 }),
    ]);
  });

  it("Binance cash-out exact: no rounding_given_* is sent", async () => {
    await openBinance();
    fireEvent.click(screen.getByTestId("crypto-receive-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-payout-roundup"));
    fireEvent.click(screen.getByTestId("crypto-payout-exact"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });

  it("Binance SEND after a cash-out round-up: not wired on a SEND, and the stale round-up is not sent", async () => {
    await openBinance();
    fireEvent.click(screen.getByTestId("crypto-receive-100-fee-2"));
    fireEvent.click(screen.getByTestId("crypto-payout-roundup"));
    fireEvent.click(screen.getByTestId("crypto-send-100-fee-2"));
    await waitFor(() =>
      expect(screen.getByTestId("crypto-roundup-wired").textContent).toBe(
        "false",
      ),
    );
    fireEvent.click(screen.getByTestId("crypto-send-pay"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.serviceType).toBe("SEND");
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });

  it("credit buy-back: 800,000 on 750,000 sends rounding_given_lbp 50,000 and no kept change", async () => {
    await fillBuyback();
    fireEvent.click(screen.getByTestId("buyback-payout-roundup"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const parsed = createRechargeSchema.parse(
      mockProcessRecharge.mock.calls[0][0],
    );
    expect(parsed.type).toBe("CREDIT_BUYBACK");
    expect(parsed.rounding_given_lbp).toBe(50000);
    expect(parsed.rounding_given_usd ?? 0).toBe(0);
    expect(parsed.kept_change_lbp).toBeUndefined();
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "LBP", amount: 800000 }),
    ]);
  });

  it("credit buy-back exact: no rounding_given_* is sent", async () => {
    await fillBuyback();
    fireEvent.click(screen.getByTestId("buyback-payout-roundup"));
    fireEvent.click(screen.getByTestId("buyback-payout-exact"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const parsed = createRechargeSchema.parse(
      mockProcessRecharge.mock.calls[0][0],
    );
    expect(parsed.type).toBe("CREDIT_BUYBACK");
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });

  it("ordinary credit sale after a buy-back round-up: the stale round-up is not sent", async () => {
    await fillBuyback();
    fireEvent.click(screen.getByTestId("buyback-payout-roundup"));
    fireEvent.click(screen.getByTestId("sale-fill"));
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "false",
      ),
    );
    fireEvent.click(screen.getByTestId("sale-pay"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const parsed = createRechargeSchema.parse(
      mockProcessRecharge.mock.calls[0][0],
    );
    expect(parsed.type).not.toBe("CREDIT_BUYBACK");
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });
});
