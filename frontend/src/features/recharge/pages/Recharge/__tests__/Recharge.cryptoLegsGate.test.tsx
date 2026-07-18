/** @jest-environment jsdom */

/**
 * Recharge page — Binance/crypto submit must forward payment legs whenever
 * ANY payment line exists, never gated on split (S1, PAYMENT_LEGS_INTEGRITY_
 * PLAN wave 6).
 *
 * Pre-fix, `useCryptoStructuredPayments` (handleCryptoSubmit, ~line 935) was
 * `isSplitPayment || cryptoReturnLegs.length > 0` — a SINGLE-line payment (no
 * split, no change) fell through to `payments: undefined`; only the bare
 * `paidByMethod` reached the backend, dropping the tender's own amount +
 * currency (the same bug class as the owner-reported Whish App LBP-as-USD
 * case, reproduced here on a Binance SEND).
 *
 * The page's own subcomponents (ProviderTabs / CryptoForm) are stubbed so the
 * test drives `handleCryptoSubmit` — the real closure under test — directly,
 * without needing the full real MultiPaymentInput/PaymentSheet tree.
 *
 * Proven failing-first (rule 17): reverting `useCryptoStructuredPayments` to
 * `isSplitPayment || cryptoReturnLegs.length > 0` makes this test's
 * `payments` assertion fail (payload falls back to `payments: undefined`).
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

// Stub the page's own subcomponents — this test drives handleCryptoSubmit
// (the real closure under test in Recharge/index.tsx) directly rather than
// rendering the full real MultiPaymentInput/PaymentSheet tree underneath
// CryptoForm (that plumbing is covered by MultiPaymentInput.test.tsx and the
// sibling forms' own legs-gate tests).
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
    handleCryptoSubmit,
    onPaymentLinesChange,
  }: {
    cryptoAmount: string;
    setCryptoAmount: (v: string) => void;
    handleCryptoSubmit: () => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
  }) => (
    <div data-testid="stub-crypto-form">
      <input
        data-testid="crypto-amount-input"
        value={cryptoAmount}
        onChange={(e) => setCryptoAmount(e.target.value)}
      />
      <button
        data-testid="crypto-inject-single"
        onClick={() =>
          onPaymentLinesChange([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "LBP",
              amount: 180000,
            } as PaymentLine,
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
}

describe("Recharge page — Binance crypto submit never gates legs on split (S1)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("forwards a SINGLE-line LBP cash payment as a real leg on a Binance SEND", async () => {
    await renderPage();

    // Switch to the Binance (crypto formMode) tab.
    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "2" },
    });

    // Inject ONE payment line (no split, no change) — the common case.
    fireEvent.click(screen.getByTestId("crypto-inject-single"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    // The bug: pre-fix, a single (non-split, no-change) payment fell through
    // to `payments: undefined` — the LBP tender's own amount/currency never
    // reached the backend.
    expect(payload.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 180000,
      }),
    ]);
  });
});
