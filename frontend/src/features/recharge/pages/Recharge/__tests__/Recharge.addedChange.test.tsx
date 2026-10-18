/** @jest-environment jsdom */

/**
 * Recharge page — the customer adds change on the two payouts it submits
 * itself (LIRA-336, T017/T018): Binance cash-out (crypto RECEIVE, existing
 * "Customer pays" section + `allowAddedChange`) and the MTC/Alfa credit
 * buy-back (optional "Customer gives change" section on the buy-back sheet).
 *
 * The box reports the added change in the PAYOUT currency (`onAddedChange`);
 * the page sends it as `added_change_*` with the customer's non-zero lines
 * as `customerPayments`, in the ONE payload (rule 22), only when reported in
 * payout mode for the payout being submitted.
 *
 * Subcomponents are stubbed so the real submit closures are driven
 * directly (harness from Recharge.roundUp.test.tsx). Payloads are parsed
 * through the core schemas (rule 24); the useApi mock returns a stable
 * reference (rule 25).
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

type Added = { usd: number; lbp: number } | null;
const line = (
  id: string,
  method: string,
  currencyCode: string,
  amount: number,
): PaymentLine => ({ id, method, currencyCode, amount }) as PaymentLine;

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
    onCustomerLinesChange,
    onAddedChange,
  }: {
    setCryptoAmount: (v: string) => void;
    setCryptoFee: (v: string) => void;
    setCryptoType: (t: "SEND" | "RECEIVE") => void;
    handleCryptoSubmit: () => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
    onCustomerLinesChange: (lines: PaymentLine[]) => void;
    onAddedChange?: (a: Added) => void;
  }) => (
    <div data-testid="stub-crypto-form">
      <div data-testid="crypto-added-wired">
        {String(typeof onAddedChange === "function")}
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
      {/* Customer sends 100 USDT and hands $3 cash; shop pays $101. */}
      <button
        data-testid="crypto-customer-adds-3"
        onClick={() => {
          onCustomerLinesChange([
            line("C1", "BINANCE", "USDT", 100),
            line("C2", "CASH", "USD", 3),
          ]);
          onPaymentLinesChange([line("L1", "CASH", "USD", 101)]);
          onAddedChange?.({ usd: 3, lbp: 0 });
        }}
      />
      {/* No added change: USDT 100 only, $98 out (a 0 cash line left). */}
      <button
        data-testid="crypto-exact"
        onClick={() => {
          onCustomerLinesChange([
            line("C1", "BINANCE", "USDT", 100),
            line("C2", "CASH", "USD", 0),
          ]);
          onPaymentLinesChange([line("L1", "CASH", "USD", 98)]);
          onAddedChange?.(null);
        }}
      />
      {/* The payout credited to the customer's account. */}
      <button
        data-testid="crypto-payout-account"
        onClick={() =>
          onPaymentLinesChange([line("L1", "CUSTOMER_ACCOUNT", "USD", 98)])
        }
      />
      <button
        data-testid="crypto-send-pay"
        onClick={() => onPaymentLinesChange([line("L1", "CASH", "USD", 102)])}
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
    onAddedChange,
    onBuybackCustomerLinesChange,
    handleTelecomSubmit,
  }: {
    setPhoneNumber: (v: string) => void;
    setTelecomAmount: (v: string) => void;
    setTelecomPrice: (v: string) => void;
    isShopLineMatch: boolean;
    setPaymentLines: (lines: PaymentLine[]) => void;
    onAddedChange?: (a: Added) => void;
    onBuybackCustomerLinesChange?: (lines: PaymentLine[]) => void;
    handleTelecomSubmit: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <div data-testid="is-shop-line-match">{String(isShopLineMatch)}</div>
      <div data-testid="telecom-added-wired">
        {String(
          typeof onAddedChange === "function" &&
            typeof onBuybackCustomerLinesChange === "function",
        )}
      </div>
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
      {/* Customer gives 50,000 LBP; shop pays 800,000. */}
      <button
        data-testid="buyback-customer-adds-lbp"
        onClick={() => {
          onBuybackCustomerLinesChange?.([line("C1", "CASH", "LBP", 50000)]);
          setPaymentLines([line("L1", "CASH", "LBP", 800000)]);
          onAddedChange?.({ usd: 0, lbp: 50000 });
        }}
      />
      {/* Customer gives $1 (= 89,500 LBP at the sheet's rate). */}
      <button
        data-testid="buyback-customer-adds-usd"
        onClick={() => {
          onBuybackCustomerLinesChange?.([line("C1", "CASH", "USD", 1)]);
          setPaymentLines([line("L1", "CASH", "LBP", 839500)]);
          onAddedChange?.({ usd: 0, lbp: 89500 });
        }}
      />
      {/* Section opened and left at 0. */}
      <button
        data-testid="buyback-exact"
        onClick={() => {
          onBuybackCustomerLinesChange?.([line("C1", "CASH", "LBP", 0)]);
          setPaymentLines([line("L1", "CASH", "LBP", 750000)]);
          onAddedChange?.(null);
        }}
      />
      <button
        data-testid="sale-pay"
        onClick={() => setPaymentLines([line("L1", "CASH", "LBP", 750000)])}
      />
      <button data-testid="telecom-confirm" onClick={handleTelecomSubmit} />
    </div>
  ),
}));

let mockActiveSession: { id: number } | null = null;
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession,
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

async function openBinanceReceive() {
  await renderPage();
  fireEvent.click(screen.getByTestId("select-binance"));
  await screen.findByTestId("stub-crypto-form");
  fireEvent.click(screen.getByTestId("crypto-receive-100-fee-2"));
}

async function fillBuyback() {
  await renderPage();
  await screen.findByTestId("stub-telecom-form");
  fireEvent.click(screen.getByTestId("buyback-fill"));
  await waitFor(() =>
    expect(screen.getByTestId("is-shop-line-match").textContent).toBe("true"),
  );
}

async function sentCrypto() {
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return createFinancialServiceSchema.parse(
    mockAddOMTTransaction.mock.calls[0][0],
  );
}

async function sentRecharge() {
  await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
  return createRechargeSchema.parse(mockProcessRecharge.mock.calls[0][0]);
}

beforeEach(() => {
  mockActiveSession = null;
  mockAddOMTTransaction.mockClear();
  mockProcessRecharge.mockClear();
});

describe("Recharge page — customer adds change (LIRA-336)", () => {
  it("Binance cash-out: USDT 100 + Cash $3 in, $101 out → customerPayments both lines + added_change_usd 3", async () => {
    await openBinanceReceive();
    await waitFor(() =>
      expect(screen.getByTestId("crypto-added-wired").textContent).toBe("true"),
    );
    fireEvent.click(screen.getByTestId("crypto-customer-adds-3"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    const parsed = await sentCrypto();
    expect(parsed.serviceType).toBe("RECEIVE");
    expect(parsed.customerPayments).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: 100 },
      { method: "CASH", currencyCode: "USD", amount: 3 },
    ]);
    expect(parsed.added_change_usd).toBe(3);
    expect(parsed.added_change_lbp ?? 0).toBe(0);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 101 }),
    ]);
    expect(parsed.rounding_given_usd).toBeUndefined();
  });

  it("Binance cash-out with no added change: no added_change_*, and the 0 cash line is dropped", async () => {
    await openBinanceReceive();
    fireEvent.click(screen.getByTestId("crypto-customer-adds-3"));
    fireEvent.click(screen.getByTestId("crypto-exact"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    const parsed = await sentCrypto();
    expect(parsed.added_change_usd).toBeUndefined();
    expect(parsed.added_change_lbp).toBeUndefined();
    expect(parsed.customerPayments).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: 100 },
    ]);
  });

  it("Binance cash-out to the customer's account: not wired, no claim", async () => {
    await openBinanceReceive();
    fireEvent.click(screen.getByTestId("crypto-customer-adds-3"));
    fireEvent.click(screen.getByTestId("crypto-payout-account"));
    await waitFor(() =>
      expect(screen.getByTestId("crypto-added-wired").textContent).toBe(
        "false",
      ),
    );
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    // Raw payload: the harness has no client, so the schema would refuse
    // the account payout itself — the point here is only the claim.
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const raw = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(raw).not.toHaveProperty("added_change_usd");
    expect(raw).not.toHaveProperty("added_change_lbp");
  });

  it("Binance SEND after a cash-out with added change: not wired, nothing stale sent", async () => {
    await openBinanceReceive();
    fireEvent.click(screen.getByTestId("crypto-customer-adds-3"));
    fireEvent.click(screen.getByTestId("crypto-send-100-fee-2"));
    await waitFor(() =>
      expect(screen.getByTestId("crypto-added-wired").textContent).toBe(
        "false",
      ),
    );
    fireEvent.click(screen.getByTestId("crypto-send-pay"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    const parsed = await sentCrypto();
    expect(parsed.serviceType).toBe("SEND");
    expect(parsed.added_change_usd).toBeUndefined();
    expect(mockAddOMTTransaction.mock.calls[0][0]).not.toHaveProperty(
      "customerPayments",
    );
  });

  it("Binance cash-out inside a session: not wired", async () => {
    mockActiveSession = { id: 1 };
    await openBinanceReceive();
    await waitFor(() =>
      expect(screen.getByTestId("crypto-added-wired").textContent).toBe(
        "false",
      ),
    );
  });

  it("credit buy-back: customer gives 50,000 LBP, shop pays 800,000 → customerPayments [Cash LBP 50,000] + added_change_lbp 50,000", async () => {
    await fillBuyback();
    await waitFor(() =>
      expect(screen.getByTestId("telecom-added-wired").textContent).toBe(
        "true",
      ),
    );
    fireEvent.click(screen.getByTestId("buyback-customer-adds-lbp"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    const parsed = await sentRecharge();
    expect(parsed.type).toBe("CREDIT_BUYBACK");
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 50000 },
    ]);
    expect(parsed.added_change_lbp).toBe(50000);
    expect(parsed.added_change_usd ?? 0).toBe(0);
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });

  it("credit buy-back: customer gives $1 → customerPayments [Cash USD 1] + added_change_lbp 89,500 (payout currency)", async () => {
    await fillBuyback();
    fireEvent.click(screen.getByTestId("buyback-customer-adds-usd"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    const parsed = await sentRecharge();
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 1 },
    ]);
    expect(parsed.added_change_lbp).toBe(89500);
  });

  it("credit buy-back with the section left at 0: no customerPayments, no claim", async () => {
    await fillBuyback();
    fireEvent.click(screen.getByTestId("buyback-exact"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    const parsed = await sentRecharge();
    expect(parsed.added_change_lbp).toBeUndefined();
    expect(parsed.added_change_usd).toBeUndefined();
    expect(mockProcessRecharge.mock.calls[0][0]).not.toHaveProperty(
      "customerPayments",
    );
  });

  it("an ordinary credit sale never carries a stale buy-back added change", async () => {
    await fillBuyback();
    fireEvent.click(screen.getByTestId("buyback-customer-adds-lbp"));
    fireEvent.click(screen.getByTestId("sale-fill"));
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "false",
      ),
    );
    fireEvent.click(screen.getByTestId("sale-pay"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    const parsed = await sentRecharge();
    expect(parsed.type).not.toBe("CREDIT_BUYBACK");
    expect(parsed.added_change_lbp).toBeUndefined();
    expect(parsed.added_change_usd).toBeUndefined();
    expect(mockProcessRecharge.mock.calls[0][0]).not.toHaveProperty(
      "customerPayments",
    );
  });
});
