/** @jest-environment jsdom */

/**
 * Recharge page — Binance/crypto submit, mode C ("Customer pays
 * separately", BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §10.2). The core/
 * repository side of this feature (feePayments[] on a fee-on-top BINANCE
 * RECEIVE) shipped in commit 5d35983; this covers ONLY the frontend
 * payload assembly in `handleCryptoSubmit` (Recharge/index.tsx).
 *
 * Mirrors Recharge.cryptoLegsGate.test.tsx's harness: the page's own
 * subcomponents are stubbed so the test drives `handleCryptoSubmit` — the
 * real closure under test — directly. The CryptoForm stub here additionally
 * exposes `setFeeCollectedSeparately`/`onFeePaymentLinesChange` (additive
 * props; the sibling gate-test file's narrower stub keeps compiling
 * unchanged).
 *
 * rule 17: proven failing-first — pre-change, `handleCryptoSubmit`'s amount
 * branch is `cryptoType === "RECEIVE" && !cryptoFeeIncluded` (no
 * `cryptoFeeCollectedSeparately` term), so mode C's "bare amount" test below
 * would see `payload.amount === 102` (fee wrongly added on top) instead of
 * `100`; and there is no `feePayments` spread in the payload at all, so
 * `payload.feePayments` would read `undefined` instead of the injected leg.
 * Confirmed by stashing the Recharge/index.tsx changes and re-running this
 * file.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import MobileRecharge from "../index";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetClients = jest.fn().mockResolvedValue([]);
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true });

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getAllSettings: mockGetAllSettings,
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getClients: mockGetClients,
    processRecharge: mockProcessRecharge,
    addOMTTransaction: mockAddOMTTransaction,
  }),
}));

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  TelecomForm: () => null,
  OmtWhishAppTransferForm: () => null,
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
    cryptoAmount,
    setCryptoAmount,
    cryptoFee,
    setCryptoFee,
    setCryptoType,
    setFeeCollectedSeparately,
    onPaymentLinesChange,
    onFeePaymentLinesChange,
    handleCryptoSubmit,
  }: {
    cryptoAmount: string;
    setCryptoAmount: (v: string) => void;
    cryptoFee: string;
    setCryptoFee: (v: string) => void;
    setCryptoType: (t: "SEND" | "RECEIVE") => void;
    setFeeCollectedSeparately: (v: boolean) => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
    onFeePaymentLinesChange: (lines: PaymentLine[]) => void;
    handleCryptoSubmit: () => void;
  }) => (
    <div data-testid="stub-crypto-form">
      <input
        data-testid="crypto-amount-input"
        value={cryptoAmount}
        onChange={(e) => setCryptoAmount(e.target.value)}
      />
      <input
        data-testid="crypto-fee-input"
        value={cryptoFee}
        onChange={(e) => setCryptoFee(e.target.value)}
      />
      <button
        data-testid="crypto-switch-receive"
        onClick={() => setCryptoType("RECEIVE")}
      />
      <button
        data-testid="crypto-toggle-fee-collected-separately"
        onClick={() => setFeeCollectedSeparately(true)}
      />
      <button
        data-testid="crypto-inject-payout"
        onClick={() =>
          onPaymentLinesChange([
            { id: "P1", method: "CASH", currencyCode: "USD", amount: 100 },
          ] as PaymentLine[])
        }
      />
      <button
        data-testid="crypto-inject-fee-payment"
        onClick={() =>
          onFeePaymentLinesChange([
            { id: "F1", method: "OMT", currencyCode: "USD", amount: 2 },
          ] as PaymentLine[])
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
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
    ],
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

describe("Recharge page — Binance mode C (Customer pays separately)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("sends the BARE amount (no fee added) and feePayments from the fee counter-flow lines", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    fireEvent.click(screen.getByTestId("crypto-switch-receive"));
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByTestId("crypto-fee-input"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByTestId("crypto-toggle-fee-collected-separately"),
    );
    fireEvent.click(screen.getByTestId("crypto-inject-payout"));
    fireEvent.click(screen.getByTestId("crypto-inject-fee-payment"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(payload.serviceType).toBe("RECEIVE");
    // Wallet receives the BARE amount — NOT 102 (mode A's fee-on-top).
    expect(payload.amount).toBe(100);
    expect(payload.commission).toBe(2);
    expect(payload.feePayments).toEqual([
      expect.objectContaining({
        method: "OMT",
        currencyCode: "USD",
        amount: 2,
      }),
    ]);
  });

  it("modes A/B (feeCollectedSeparately=false) never send feePayments — regression, byte-identical to before this feature", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    fireEvent.click(screen.getByTestId("crypto-switch-receive"));
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByTestId("crypto-fee-input"), {
      target: { value: "2" },
    });
    // Mode A (default): feeCollectedSeparately is never toggled on.
    fireEvent.click(screen.getByTestId("crypto-inject-payout"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    // Mode A: wallet = amount + fee (unchanged pre-feature math).
    expect(payload.amount).toBe(102);
    expect(payload.commission).toBe(2);
    expect(payload.feePayments).toBeUndefined();
  });

  it("feeCollectedSeparately=true with a zero fee never sends feePayments (S2-style guard mirrors the repository's own reject-on-zero-fee rule)", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    fireEvent.click(screen.getByTestId("crypto-switch-receive"));
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "100" },
    });
    // No fee typed — cryptoFee stays "".
    fireEvent.click(
      screen.getByTestId("crypto-toggle-fee-collected-separately"),
    );
    fireEvent.click(screen.getByTestId("crypto-inject-payout"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(payload.amount).toBe(100);
    expect(payload.feePayments).toBeUndefined();
  });
});
