/**
 * CryptoForm — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { useState } from "react";
import { render, act, screen } from "@testing-library/react";
import { type PaymentLine } from "@liratek/ui";
import { CryptoForm } from "../CryptoForm";
import { PROVIDER_CONFIGS } from "../../types";

const mockSheetProps: { last?: Record<string, unknown> } = {};

jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: Record<string, unknown>) => {
    mockSheetProps.last = props;
    return null;
  },
}));

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

const mockApi = { addOMTTransaction: mockAddOMTTransaction };

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  DecimalInput: ({
    id,
    value,
    onChange,
    placeholder,
    className,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={value === 0 ? "" : String(value)}
      placeholder={placeholder}
      className={className}
      onChange={(e) =>
        onChange(parseFloat(e.target.value.replace(/,/g, "")) || 0)
      }
    />
  ),
}));

let mockActiveSession: unknown = null;

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: mockActiveSession }),
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("../HistoryModal", () => ({
  HistoryModal: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  mockActiveSession = null;
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("CryptoForm.addedChange (LIRA-336)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * CryptoForm — customer adds change, pass-through (LIRA-336, T017). The page
   * hands CryptoForm an `onAddedChange` for a walk-in Binance cash-out;
   * CryptoForm forwards it to its PaymentSheet and turns on
   * `allowAddedChange` on the "Customer pays" section. Without the callback
   * (session, account payout — the page decides), or on a SEND, neither.
   *
   * Real CryptoForm, PaymentSheet stubbed to record the props it receives
   * (same harness as CryptoForm.roundUp.test.tsx).
   * Rule 17: NOT proven failing-first — written after the CryptoForm change
   * (the page-level payload test Recharge.addedChange.test.tsx was).
   */

  const onReturnChangeSpy = jest.fn();
  const onKeptChangeSpy = jest.fn();
  const onRoundUpChangeSpy = jest.fn();
  const onAddedChangeSpy = jest.fn();

  const BINANCE_CONFIG = PROVIDER_CONFIGS.find((p) => p.key === "BINANCE")!;

  const PAYOUT_PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];
  const FEE_PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "OMT", label: "OMT Wallet" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];

  /** Reproduces the props-down wiring Recharge/index.tsx owns for real —
   *  CryptoForm itself holds none of this state. */
  function Harness({
    initialCryptoType = "RECEIVE",
    withAddedChange = true,
  }: {
    initialCryptoType?: "SEND" | "RECEIVE";
    withAddedChange?: boolean;
  }) {
    const [cryptoType, setCryptoType] = useState<"SEND" | "RECEIVE">(
      initialCryptoType,
    );
    const [cryptoAmount, setCryptoAmount] = useState("100");
    const [cryptoFee, setCryptoFee] = useState("1");
    const [feeIncluded, setFeeIncluded] = useState(false);
    const [feeCollectedSeparately, setFeeCollectedSeparately] = useState(false);
    const [, setCustomerLines] = useState<PaymentLine[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    return (
      <CryptoForm
        activeConfig={BINANCE_CONFIG}
        cryptoType={cryptoType}
        setCryptoType={setCryptoType}
        cryptoAmount={cryptoAmount}
        setCryptoAmount={setCryptoAmount}
        cryptoClientName=""
        setCryptoClientName={jest.fn()}
        cryptoClientPhone=""
        setCryptoClientPhone={jest.fn()}
        cryptoClientId={null}
        setCryptoClientId={jest.fn()}
        cryptoDescription=""
        setCryptoDescription={jest.fn()}
        cryptoFee={cryptoFee}
        setCryptoFee={setCryptoFee}
        feeIncluded={feeIncluded}
        setFeeIncluded={setFeeIncluded}
        feeCollectedSeparately={feeCollectedSeparately}
        setFeeCollectedSeparately={setFeeCollectedSeparately}
        onCustomerLinesChange={setCustomerLines}
        onCustomerForgivenChange={jest.fn()}
        customerPaymentMethods={FEE_PAYMENT_METHODS}
        handleCryptoSubmit={jest.fn()}
        isSubmitting={false}
        binanceTransactions={[]}
        loadCryptoData={jest.fn()}
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        paymentMethods={PAYOUT_PAYMENT_METHODS}
        onPaymentLinesChange={jest.fn()}
        onReturnChange={onReturnChangeSpy}
        onKeptChange={onKeptChangeSpy}
        onRoundUpChange={onRoundUpChangeSpy}
        {...(withAddedChange ? { onAddedChange: onAddedChangeSpy } : {})}
        exchangeRate={89000}
      />
    );
  }

  type SheetCounterFlow = { allowAddedChange?: boolean } | undefined;
  const sheetCounterFlow = (): SheetCounterFlow =>
    mockSheetProps.last?.counterFlow as SheetCounterFlow;

  describe("CryptoForm — customer adds change pass-through (LIRA-336)", () => {
    beforeEach(() => {
      delete mockSheetProps.last;
      mockActiveSession = null;
    });

    it("cash-out: forwards onAddedChange and allows added change on the customer section", () => {
      render(<Harness initialCryptoType="RECEIVE" />);
      expect(mockSheetProps.last?.onAddedChange).toBe(onAddedChangeSpy);
      expect(sheetCounterFlow()?.allowAddedChange).toBe(true);
    });

    it("cash-out without the page's callback: no added change", () => {
      render(<Harness initialCryptoType="RECEIVE" withAddedChange={false} />);
      expect(mockSheetProps.last?.onAddedChange).toBeUndefined();
      expect(sheetCounterFlow()?.allowAddedChange).toBeUndefined();
    });

    it("SEND: neither the callback nor a customer section", () => {
      render(<Harness initialCryptoType="SEND" />);
      expect(mockSheetProps.last?.onAddedChange).toBeUndefined();
      expect(sheetCounterFlow()).toBeUndefined();
    });

    it("inside a session: no customer section, no callback", () => {
      mockActiveSession = { id: 1 };
      render(<Harness initialCryptoType="RECEIVE" />);
      expect(mockSheetProps.last?.onAddedChange).toBeUndefined();
      expect(sheetCounterFlow()).toBeUndefined();
    });
  });
});

describe("CryptoForm.payoutKeptChange", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Binance cash-out (CryptoForm RECEIVE) is a PAYOUT. Owner decisions
   * 2026-10-07 (FEATURE_GUIDE §4.1 "Kept change"): its payment sheet runs in
   * `payer="payout"` mode — no change (OUT) legs, a small shortfall kept as
   * profit via `onKeptChange`. A Binance SEND stays a customer payment.
   *
   * Real CryptoForm, PaymentSheet stubbed to record the props it receives.
   * Rule 17: run against the pre-change form first — see the task report.
   */

  const onReturnChangeSpy = jest.fn();
  const onKeptChangeSpy = jest.fn();

  const BINANCE_CONFIG = PROVIDER_CONFIGS.find((p) => p.key === "BINANCE")!;

  const PAYOUT_PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];
  const FEE_PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "OMT", label: "OMT Wallet" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];

  /** Reproduces the props-down wiring Recharge/index.tsx owns for real —
   *  CryptoForm itself holds none of this state. */
  function Harness({
    initialCryptoType = "RECEIVE",
    onExchangeRateChange,
  }: {
    initialCryptoType?: "SEND" | "RECEIVE";
    onExchangeRateChange?: (rate: number) => void;
  }) {
    const [cryptoType, setCryptoType] = useState<"SEND" | "RECEIVE">(
      initialCryptoType,
    );
    const [cryptoAmount, setCryptoAmount] = useState("100");
    const [cryptoFee, setCryptoFee] = useState("1");
    const [feeIncluded, setFeeIncluded] = useState(false);
    const [feeCollectedSeparately, setFeeCollectedSeparately] = useState(false);
    const [, setCustomerLines] = useState<PaymentLine[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    return (
      <CryptoForm
        activeConfig={BINANCE_CONFIG}
        cryptoType={cryptoType}
        setCryptoType={setCryptoType}
        cryptoAmount={cryptoAmount}
        setCryptoAmount={setCryptoAmount}
        cryptoClientName=""
        setCryptoClientName={jest.fn()}
        cryptoClientPhone=""
        setCryptoClientPhone={jest.fn()}
        cryptoClientId={null}
        setCryptoClientId={jest.fn()}
        cryptoDescription=""
        setCryptoDescription={jest.fn()}
        cryptoFee={cryptoFee}
        setCryptoFee={setCryptoFee}
        feeIncluded={feeIncluded}
        setFeeIncluded={setFeeIncluded}
        feeCollectedSeparately={feeCollectedSeparately}
        setFeeCollectedSeparately={setFeeCollectedSeparately}
        onCustomerLinesChange={setCustomerLines}
        onCustomerForgivenChange={jest.fn()}
        customerPaymentMethods={FEE_PAYMENT_METHODS}
        handleCryptoSubmit={jest.fn()}
        isSubmitting={false}
        binanceTransactions={[]}
        loadCryptoData={jest.fn()}
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        paymentMethods={PAYOUT_PAYMENT_METHODS}
        onPaymentLinesChange={jest.fn()}
        onReturnChange={onReturnChangeSpy}
        onKeptChange={onKeptChangeSpy}
        exchangeRate={89000}
        {...(onExchangeRateChange ? { onExchangeRateChange } : {})}
      />
    );
  }

  describe("CryptoForm — the cash-out sheet is a payout", () => {
    beforeEach(() => {
      delete mockSheetProps.last;
      mockActiveSession = null;
    });

    it("RECEIVE: payer is payout, no change legs wired, kept change wired", () => {
      render(<Harness initialCryptoType="RECEIVE" />);
      expect(mockSheetProps.last?.payer).toBe("payout");
      expect(mockSheetProps.last?.onReturnChange).toBeUndefined();
      expect(mockSheetProps.last?.onKeptChange).toBe(onKeptChangeSpy);
    });

    it("SEND: stays a customer payment with change legs wired", () => {
      render(<Harness initialCryptoType="SEND" />);
      expect(mockSheetProps.last?.payer).not.toBe("payout");
      expect(mockSheetProps.last?.onReturnChange).toBe(onReturnChangeSpy);
    });
  });

  /**
   * The "≈ X LBP" line under the total must convert at the rate the sale will
   * be booked at — the sheet's rate (`tender_exchange_rate`, which the page
   * takes from `onExchangeRateChange`), not the seeded default once the
   * cashier has typed a different one in the sheet's "1 USD =" field.
   */
  describe("CryptoForm — LBP equivalent follows the sheet's rate", () => {
    beforeEach(() => {
      delete mockSheetProps.last;
      mockActiveSession = null;
    });

    const lbpLine = () =>
      screen.getByText(/≈/).textContent?.replace(/\s+/g, " ");

    it("shows the seeded rate until the sheet reports another one", () => {
      const pageSpy = jest.fn();
      render(
        <Harness initialCryptoType="RECEIVE" onExchangeRateChange={pageSpy} />,
      );
      // payout = $100 (fee charged on top) → 100 × 89,000
      expect(lbpLine()).toContain((100 * 89000).toLocaleString());

      const report = mockSheetProps.last?.onExchangeRateChange as (
        r: number,
      ) => void;
      act(() => report(90000));

      expect(lbpLine()).toContain((100 * 90000).toLocaleString());
      // The page still receives the rate for the payload.
      expect(pageSpy).toHaveBeenCalledWith(90000);
    });
  });
});

describe("CryptoForm.roundUp (LIRA-334)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * CryptoForm — payout round-up pass-through (LIRA-334, T023). The page hands
   * CryptoForm an `onRoundUpChange` for a Binance cash-out; CryptoForm must
   * forward it to its PaymentSheet (which forwards it to MultiPaymentInput).
   *
   * Real CryptoForm, PaymentSheet stubbed to record the props it receives
   * (same harness as CryptoForm.payoutKeptChange.test.tsx).
   * Rule 17: run against the pre-change form first — see the task report.
   */

  const onReturnChangeSpy = jest.fn();
  const onKeptChangeSpy = jest.fn();
  const onRoundUpChangeSpy = jest.fn();

  const BINANCE_CONFIG = PROVIDER_CONFIGS.find((p) => p.key === "BINANCE")!;

  const PAYOUT_PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];
  const FEE_PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "OMT", label: "OMT Wallet" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];

  /** Reproduces the props-down wiring Recharge/index.tsx owns for real —
   *  CryptoForm itself holds none of this state. */
  function Harness({
    initialCryptoType = "RECEIVE",
    onExchangeRateChange,
  }: {
    initialCryptoType?: "SEND" | "RECEIVE";
    onExchangeRateChange?: (rate: number) => void;
  }) {
    const [cryptoType, setCryptoType] = useState<"SEND" | "RECEIVE">(
      initialCryptoType,
    );
    const [cryptoAmount, setCryptoAmount] = useState("100");
    const [cryptoFee, setCryptoFee] = useState("1");
    const [feeIncluded, setFeeIncluded] = useState(false);
    const [feeCollectedSeparately, setFeeCollectedSeparately] = useState(false);
    const [, setCustomerLines] = useState<PaymentLine[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    return (
      <CryptoForm
        activeConfig={BINANCE_CONFIG}
        cryptoType={cryptoType}
        setCryptoType={setCryptoType}
        cryptoAmount={cryptoAmount}
        setCryptoAmount={setCryptoAmount}
        cryptoClientName=""
        setCryptoClientName={jest.fn()}
        cryptoClientPhone=""
        setCryptoClientPhone={jest.fn()}
        cryptoClientId={null}
        setCryptoClientId={jest.fn()}
        cryptoDescription=""
        setCryptoDescription={jest.fn()}
        cryptoFee={cryptoFee}
        setCryptoFee={setCryptoFee}
        feeIncluded={feeIncluded}
        setFeeIncluded={setFeeIncluded}
        feeCollectedSeparately={feeCollectedSeparately}
        setFeeCollectedSeparately={setFeeCollectedSeparately}
        onCustomerLinesChange={setCustomerLines}
        onCustomerForgivenChange={jest.fn()}
        customerPaymentMethods={FEE_PAYMENT_METHODS}
        handleCryptoSubmit={jest.fn()}
        isSubmitting={false}
        binanceTransactions={[]}
        loadCryptoData={jest.fn()}
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        paymentMethods={PAYOUT_PAYMENT_METHODS}
        onPaymentLinesChange={jest.fn()}
        onReturnChange={onReturnChangeSpy}
        onKeptChange={onKeptChangeSpy}
        onRoundUpChange={onRoundUpChangeSpy}
        exchangeRate={89000}
        {...(onExchangeRateChange ? { onExchangeRateChange } : {})}
      />
    );
  }

  describe("CryptoForm — payout round-up pass-through (LIRA-334)", () => {
    beforeEach(() => {
      delete mockSheetProps.last;
      mockActiveSession = null;
    });

    it("forwards onRoundUpChange to the cash-out sheet", () => {
      render(<Harness initialCryptoType="RECEIVE" />);
      expect(mockSheetProps.last?.onRoundUpChange).toBe(onRoundUpChangeSpy);
    });
  });
});
