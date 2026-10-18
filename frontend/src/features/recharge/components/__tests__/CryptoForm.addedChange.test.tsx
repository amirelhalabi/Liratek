/** @jest-environment jsdom */
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
const onAddedChangeSpy = jest.fn();
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
