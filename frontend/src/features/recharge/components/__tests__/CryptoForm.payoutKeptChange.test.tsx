/** @jest-environment jsdom */

/**
 * Binance cash-out (CryptoForm RECEIVE) is a PAYOUT. Owner decisions
 * 2026-10-07 (FEATURE_GUIDE §4.1 "Kept change"): its payment sheet runs in
 * `payer="payout"` mode — no change (OUT) legs, a small shortfall kept as
 * profit via `onKeptChange`. A Binance SEND stays a customer payment.
 *
 * Real CryptoForm, PaymentSheet stubbed to record the props it receives.
 * Rule 17: run against the pre-change form first — see the task report.
 */

import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import { CryptoForm } from "../CryptoForm";

const mockSheetProps: { last?: Record<string, unknown> } = {};
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: Record<string, unknown>) => {
    mockSheetProps.last = props;
    return null;
  },
}));

const onReturnChangeSpy = jest.fn();
const onKeptChangeSpy = jest.fn();
import { PROVIDER_CONFIGS } from "../../types";

const BINANCE_CONFIG = PROVIDER_CONFIGS.find((p) => p.key === "BINANCE")!;

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
  const [, setFeePaymentLines] = useState<PaymentLine[]>([]);
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
      onFeePaymentLinesChange={setFeePaymentLines}
      feePaymentMethods={FEE_PAYMENT_METHODS}
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

  const lbpLine = () => screen.getByText(/≈/).textContent?.replace(/\s+/g, " ");

  it("shows the seeded rate until the sheet reports another one", () => {
    const pageSpy = jest.fn();
    render(<Harness initialCryptoType="RECEIVE" onExchangeRateChange={pageSpy} />);
    // payout = $100 (fee charged on top) → 100 × 89,000
    expect(lbpLine()).toContain((100 * 89000).toLocaleString());

    const report = mockSheetProps.last?.onExchangeRateChange as (r: number) => void;
    act(() => report(90000));

    expect(lbpLine()).toContain((100 * 90000).toLocaleString());
    // The page still receives the rate for the payload.
    expect(pageSpy).toHaveBeenCalledWith(90000);
  });
});
