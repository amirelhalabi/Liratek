/** @jest-environment jsdom */

/**
 * Recharge page — Binance/crypto submit failures used to be invisible.
 * `handleCryptoSubmit` had TWO separate holes (LIRA-247):
 *
 *  1. A THROWN `addOMTTransaction` failure (web: `requestJson` throws a
 *     plain `{status,message,details}` object on a non-2xx response, e.g. a
 *     role refusal) reached only `logger.error(...)` in the catch block —
 *     nothing was ever shown to the operator.
 *  2. Worse: unlike `handleTelecomSubmit`/`handleAlfaGiftSubmit` in this
 *     same file, `handleCryptoSubmit` had NO `if (!result.success)` guard at
 *     all — a RESOLVED `{success:false, error}` (a business-rule refusal
 *     that resolves rather than throws) fell straight through to the
 *     "Crypto transaction recorded successfully" notification, silently
 *     resetting the form as if the transaction had gone through.
 *
 * Harness copied verbatim from the sibling
 * `Recharge.cryptoFeeCollectedSeparately.test.tsx` (same stubbed
 * `ProviderTabs`/`CryptoForm`, same `handleCryptoSubmit` closure under test).
 *
 * NOT proven failing-first (LIRA-247): the fix landed in the same pass as
 * this test (Recharge/index.tsx's `handleCryptoSubmit` was edited before
 * this file was written), and rule 17 forbids reverting/re-breaking finished
 * code afterward just to manufacture a red run. Reasoning for why it WOULD
 * have failed pre-fix: case 1's catch block called only `logger.error(...)`
 * with no `alert(...)` at all, so `window.alert` would never have been
 * called; case 2 had NO `if (!result.success)` guard at all, so execution
 * would have fallen straight through to the "recorded successfully"
 * `appEvents.emit(..., "success")` call instead of alerting.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import MobileRecharge from "../index";

const mockAddOMTTransaction = jest.fn();
const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetClients = jest.fn().mockResolvedValue([]);
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true });
const mockEmit = jest.fn();

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
  // Wrapped in a closure (not `emit: mockEmit` directly) — see the matching
  // comment in CheckoutModal.submitErrorSurfaced.test.tsx for why a bare
  // reference hits "Cannot access 'mockEmit' before initialization".
  appEvents: {
    emit: (...args: unknown[]) => mockEmit(...args),
    on: jest.fn(() => () => {}),
  },
}));

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  TelecomForm: () => null,
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
    cryptoAmount,
    setCryptoAmount,
    onPaymentLinesChange,
    handleCryptoSubmit,
  }: {
    cryptoAmount: string;
    setCryptoAmount: (v: string) => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
    handleCryptoSubmit: () => void;
  }) => (
    <div data-testid="stub-crypto-form">
      <input
        data-testid="crypto-amount-input"
        value={cryptoAmount}
        onChange={(e) => setCryptoAmount(e.target.value)}
      />
      <button
        data-testid="crypto-inject-payout"
        onClick={() =>
          onPaymentLinesChange([
            { id: "P1", method: "CASH", currencyCode: "USD", amount: 100 },
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

describe("Recharge page — a crypto submit failure is surfaced (LIRA-247)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockReset();
    mockEmit.mockReset();
    window.alert = jest.fn();
  });

  it("alerts the THROWN error's real message instead of failing silently", async () => {
    mockAddOMTTransaction.mockRejectedValue({
      status: 400,
      message: "Retail price below cost",
      details: {},
    });

    await renderPage();
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByTestId("crypto-inject-payout"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    const message = (window.alert as jest.Mock).mock.calls[0][0] as string;
    expect(message).toContain("Retail price below cost");

    // Never claims success when the call actually threw.
    const successCall = mockEmit.mock.calls.find(
      (c) => c[0] === "notification:show" && c[2] === "success",
    );
    expect(successCall).toBeUndefined();
  });

  it("alerts a RESOLVED {success:false} error instead of proceeding as if it succeeded", async () => {
    mockAddOMTTransaction.mockResolvedValue({
      success: false,
      error: "Insufficient wallet balance",
    });

    await renderPage();
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByTestId("crypto-inject-payout"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    const message = (window.alert as jest.Mock).mock.calls[0][0] as string;
    expect(message).toContain("Insufficient wallet balance");

    // Must NOT fall through to the "recorded successfully" notification.
    const successCall = mockEmit.mock.calls.find(
      (c) => c[0] === "notification:show" && c[2] === "success",
    );
    expect(successCall).toBeUndefined();
  });
});
