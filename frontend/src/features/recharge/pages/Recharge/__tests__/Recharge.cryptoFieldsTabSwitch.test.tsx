/** @jest-environment jsdom */

/**
 * Recharge page — LIRA-106: the `[activeProvider]` reset effect
 * (Recharge/index.tsx, ~line 317) resets several provider-specific fields on
 * a provider-tab switch (`whishAppMode`, `rechargeType`, `telecomDaysCostUsd`,
 * `finAnalytics`, `finTransactions`) but, pre-fix, touched none of the 13
 * `crypto*` fields that only a *successful submit* used to clear
 * (`cryptoAmount`, `cryptoFeeIncluded`, `cryptoFeeCollectedSeparately`,
 * `cryptoFeePaymentLines`, `cryptoPaymentLines`, `cryptoReturnLegs`,
 * `cryptoKeptChange`, `cryptoClientId`, `cryptoClientName`,
 * `cryptoClientPhone`, `cryptoFee`, `cryptoDescription`,
 * `cryptoTransactionTime` — see the submit-path resets at ~1242-1254 and the
 * earlier mode-C early-return branch at ~1148-1161). A stale Binance
 * selection (e.g. mode C's "fee collected separately" toggle plus its
 * counter-flow fee legs, a stale payment/return leg, or a stale client
 * attribution) could therefore survive a switch away from Binance and back,
 * or a SEND<->RECEIVE flip, until the next successful submit — the
 * `cryptoClientId`/leg cases are money-relevant: a leftover client could
 * attribute the next crypto transaction to the wrong customer, and leftover
 * legs are money state. `cryptoType`/`cryptoPaidBy`/`cryptoTenderRate` are
 * deliberately NOT covered — the submit paths leave those alone too, so
 * they're intentionally sticky. BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md
 * adversarial-review finding, current_sprint.md LIRA-106.
 *
 * Harness mirrors Recharge.cryptoFeeCollectedSeparately.test.tsx /
 * Recharge.cryptoLegsGate.test.tsx: the page's own subcomponents are stubbed
 * so this test drives the REAL `[activeProvider]` reset effect and
 * `handleCryptoSubmit` closures defined in Recharge/index.tsx, rather than
 * re-implementing their logic here.
 *
 * `cryptoAmount`/`feeIncluded`/`feeCollectedSeparately`/`cryptoClientId` are
 * real props CryptoForm receives from the parent (index.tsx ~1646-1698) — the
 * stub below just renders them so the test can assert on them directly.
 * `cryptoFeePaymentLines`/`cryptoPaymentLines`/`cryptoReturnLegs` are never
 * handed back down to CryptoForm as values (only their setters are, via
 * `onFeePaymentLinesChange`/`onPaymentLinesChange`/`onReturnChange`), so
 * their resets are proven indirectly through `handleCryptoSubmit`'s
 * assembled payload: mode C only forwards `feePayments` when
 * `cryptoFeeCollectedSeparately && fee > 0` (index.tsx ~1201-1207), so
 * re-arming that toggle after the round-trip WITHOUT re-injecting fee lines
 * must produce an EMPTY `feePayments`, not the stale OMT leg injected before
 * switching away. Likewise `payments` is only sent when
 * `useCryptoStructuredPayments` (`cryptoPaymentLines.length > 0 ||
 * cryptoReturnLegs.length > 0`, index.tsx ~1093-1094) is true, so re-
 * submitting WITHOUT re-injecting any leg must produce an UNDEFINED
 * `payments`, not the stale leg injected before switching away.
 *
 * Rule 17 — proven failing-first: with the fix reverted (the extra 9
 * `setCrypto*` calls removed from the `[activeProvider]` effect, leaving only
 * the original 4), the 3 new tests below fail — see the task report for the
 * captured pre-fix failure output. The original 2 tests below (covering the
 * original 4 fields) still fail if ALL 13 `setCrypto*` calls are removed.
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

// Stub the page's own subcomponents — this test drives the REAL
// `[activeProvider]` reset effect and `handleCryptoSubmit` closure (the fix
// under test), without needing the full real form trees underneath
// CryptoForm/TelecomForm (that plumbing is covered elsewhere).
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
    <div data-testid="stub-provider-tabs">
      <button
        data-testid="select-binance"
        onClick={() => onSelectProvider("BINANCE")}
      />
      <button
        data-testid="select-mtc"
        onClick={() => onSelectProvider("MTC")}
      />
    </div>
  ),
  CryptoForm: ({
    cryptoAmount,
    setCryptoAmount,
    cryptoFee,
    setCryptoFee,
    setCryptoType,
    feeIncluded,
    setFeeIncluded,
    feeCollectedSeparately,
    setFeeCollectedSeparately,
    cryptoClientId,
    setCryptoClientId,
    onPaymentLinesChange,
    onReturnChange,
    onFeePaymentLinesChange,
    handleCryptoSubmit,
  }: {
    cryptoAmount: string;
    setCryptoAmount: (v: string) => void;
    cryptoFee: string;
    setCryptoFee: (v: string) => void;
    setCryptoType: (t: "SEND" | "RECEIVE") => void;
    feeIncluded: boolean;
    setFeeIncluded: (v: boolean) => void;
    feeCollectedSeparately: boolean;
    setFeeCollectedSeparately: (v: boolean) => void;
    cryptoClientId: number | null;
    setCryptoClientId: (v: number | null) => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
    onReturnChange: (lines: PaymentLine[]) => void;
    onFeePaymentLinesChange: (lines: PaymentLine[]) => void;
    handleCryptoSubmit: () => void;
  }) => (
    <div data-testid="stub-crypto-form">
      <div data-testid="crypto-amount-value">{cryptoAmount}</div>
      <div data-testid="crypto-fee-included-value">{String(feeIncluded)}</div>
      <div data-testid="crypto-fee-collected-separately-value">
        {String(feeCollectedSeparately)}
      </div>
      <div data-testid="crypto-client-id-value">{String(cryptoClientId)}</div>
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
        data-testid="crypto-toggle-fee-included"
        onClick={() => setFeeIncluded(true)}
      />
      <button
        data-testid="crypto-toggle-fee-collected-separately"
        onClick={() => setFeeCollectedSeparately(true)}
      />
      <button
        data-testid="crypto-set-client-id"
        onClick={() => setCryptoClientId(42)}
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
        data-testid="crypto-inject-return-leg"
        onClick={() =>
          onReturnChange([
            {
              id: "R1",
              method: "CASH",
              currencyCode: "USD",
              amount: 5,
              direction: "OUT",
            },
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

describe("Recharge page — [activeProvider] reset effect clears stale crypto* fields (LIRA-106)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("switching away from Binance and back resets cryptoAmount/feeIncluded/feeCollectedSeparately", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    // Dirty the 3 directly-observable crypto* fields — no submit.
    fireEvent.click(screen.getByTestId("crypto-switch-receive"));
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByTestId("crypto-toggle-fee-included"));
    fireEvent.click(
      screen.getByTestId("crypto-toggle-fee-collected-separately"),
    );

    await waitFor(() =>
      expect(screen.getByTestId("crypto-amount-value").textContent).toBe(
        "123",
      ),
    );
    expect(screen.getByTestId("crypto-fee-included-value").textContent).toBe(
      "true",
    );
    expect(
      screen.getByTestId("crypto-fee-collected-separately-value").textContent,
    ).toBe("true");

    // Switch away — CryptoForm unmounts (MTC's formMode is "telecom").
    fireEvent.click(screen.getByTestId("select-mtc"));
    await waitFor(() =>
      expect(screen.queryByTestId("stub-crypto-form")).toBeNull(),
    );

    // Switch back — the fix under test: all 3 must already be reset.
    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    expect(screen.getByTestId("crypto-amount-value").textContent).toBe("");
    expect(screen.getByTestId("crypto-fee-included-value").textContent).toBe(
      "false",
    );
    expect(
      screen.getByTestId("crypto-fee-collected-separately-value").textContent,
    ).toBe("false");
  });

  it("switching away and back also clears the stale cryptoFeePaymentLines — proven via handleCryptoSubmit's feePayments", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    // Arm mode C and dirty cryptoFeePaymentLines — deliberately no submit,
    // so this isolates the tab-switch reset from the (already-correct)
    // submit-path reset.
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
    fireEvent.click(screen.getByTestId("crypto-inject-fee-payment"));

    // Round-trip away and back.
    fireEvent.click(screen.getByTestId("select-mtc"));
    await waitFor(() =>
      expect(screen.queryByTestId("stub-crypto-form")).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    // feeCollectedSeparately came back reset (covered by the sibling test
    // too) — re-arm it for a fresh mode-C submit, WITHOUT re-injecting a fee
    // payment line this time.
    expect(
      screen.getByTestId("crypto-fee-collected-separately-value").textContent,
    ).toBe("false");
    fireEvent.click(screen.getByTestId("crypto-switch-receive"));
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByTestId("crypto-fee-input"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByTestId("crypto-toggle-fee-collected-separately"),
    );
    fireEvent.click(screen.getByTestId("crypto-inject-payout"));
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() =>
      expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1),
    );
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Pre-fix: cryptoFeePaymentLines still held the OMT leg injected before
    // switching away, so feePayments would carry that stale leg here.
    expect(payload.feePayments).toEqual([]);
  });

  it("switching away from Binance and back resets cryptoClientId", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    // Dirty cryptoClientId — no submit.
    fireEvent.click(screen.getByTestId("crypto-set-client-id"));
    await waitFor(() =>
      expect(screen.getByTestId("crypto-client-id-value").textContent).toBe(
        "42",
      ),
    );

    // Switch away — CryptoForm unmounts (MTC's formMode is "telecom").
    fireEvent.click(screen.getByTestId("select-mtc"));
    await waitFor(() =>
      expect(screen.queryByTestId("stub-crypto-form")).toBeNull(),
    );

    // Switch back — the fix under test: cryptoClientId must already be null,
    // not the stale client id set before switching away.
    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    expect(screen.getByTestId("crypto-client-id-value").textContent).toBe(
      "null",
    );
  });

  it("switching away and back also clears the stale cryptoPaymentLines — proven via handleCryptoSubmit's payments", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    // Dirty ONLY cryptoPaymentLines — deliberately no return leg and no
    // submit, so this isolates the tab-switch reset of cryptoPaymentLines
    // from cryptoReturnLegs and from the (already-correct) submit-path reset.
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByTestId("crypto-inject-payout"));

    // Round-trip away and back.
    fireEvent.click(screen.getByTestId("select-mtc"));
    await waitFor(() =>
      expect(screen.queryByTestId("stub-crypto-form")).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    // Submit WITHOUT re-injecting any payment or return leg.
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() =>
      expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1),
    );
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Pre-fix: cryptoPaymentLines still held the stale CASH leg injected
    // before switching away, so `useCryptoStructuredPayments` would be true
    // and `payments` would carry that stale leg here instead of undefined.
    expect(payload.payments).toBeUndefined();
  });

  it("switching away and back also clears the stale cryptoReturnLegs — proven via handleCryptoSubmit's payments", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    // Dirty ONLY cryptoReturnLegs — deliberately no payment line and no
    // submit, so this isolates the tab-switch reset of cryptoReturnLegs from
    // cryptoPaymentLines and from the (already-correct) submit-path reset.
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByTestId("crypto-inject-return-leg"));

    // Round-trip away and back.
    fireEvent.click(screen.getByTestId("select-mtc"));
    await waitFor(() =>
      expect(screen.queryByTestId("stub-crypto-form")).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("select-binance"));
    await screen.findByTestId("stub-crypto-form");

    // Submit WITHOUT re-injecting any payment or return leg.
    fireEvent.change(screen.getByTestId("crypto-amount-input"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByTestId("crypto-confirm"));

    await waitFor(() =>
      expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1),
    );
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Pre-fix: cryptoReturnLegs still held the stale OUT leg injected before
    // switching away, so `useCryptoStructuredPayments` would be true and
    // `payments` would carry that stale leg here instead of undefined.
    expect(payload.payments).toBeUndefined();
  });
});
