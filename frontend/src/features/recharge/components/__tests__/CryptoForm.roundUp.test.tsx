/** @jest-environment jsdom */
/**
 * CryptoForm — payout round-up pass-through (LIRA-334, T023). The page hands
 * CryptoForm an `onRoundUpChange` for a Binance cash-out; CryptoForm must
 * forward it to its PaymentSheet (which forwards it to MultiPaymentInput).
 *
 * Real CryptoForm, PaymentSheet stubbed to record the props it receives
 * (same harness as CryptoForm.payoutKeptChange.test.tsx).
 * Rule 17: run against the pre-change form first — see the task report.
 */
import { useState } from "react";
import { render } from "@testing-library/react";
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
const onRoundUpChangeSpy = jest.fn();
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
