/**
 * LIRA-269 — the Binance cash-out (CryptoForm RECEIVE) sheet's discount.
 *
 * A discount comes off the shop's fee, so the customer receives MORE: the
 * sheet's payout target must be `walletReceiveAmounts(...).payout` (the
 * helper the server pays out by), not the payout minus the discount. When
 * the customer pays the fee separately, the payout is unchanged and the fee
 * to collect shrinks instead. The discount still reaches the page
 * (`onDiscountChange`) so the payload books `commission = fee − discount`.
 *
 * Real CryptoForm; PaymentSheet stubbed to record its props.
 */

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
import { render, act } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import { CryptoForm } from "../CryptoForm";

interface SheetProps {
  totalAmount?: number;
  showDiscount?: boolean;
  maxDiscount?: number;
  onDiscountChange?: (d: number) => void;
  counterFlow?: { totalAmount: number };
}
const mockSheetProps: { last?: SheetProps } = {};
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: SheetProps) => {
    mockSheetProps.last = props;
    return null;
  },
}));

const onDiscountChangeSpy = jest.fn();
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
  separately = false,
}: {
  initialCryptoType?: "SEND" | "RECEIVE";
  separately?: boolean;
}) {
  const [cryptoType, setCryptoType] = useState<"SEND" | "RECEIVE">(
    initialCryptoType,
  );
  const [cryptoAmount, setCryptoAmount] = useState("100");
  const [cryptoFee, setCryptoFee] = useState("2");
  const [feeIncluded, setFeeIncluded] = useState(false);
  const [feeCollectedSeparately, setFeeCollectedSeparately] =
    useState(separately);
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
      onDiscountChange={onDiscountChangeSpy}
      exchangeRate={89000}
    />
  );
}

describe("CryptoForm — a discount on the cash-out raises what the customer receives", () => {
  beforeEach(() => {
    delete mockSheetProps.last;
    mockActiveSession = null;
    onDiscountChangeSpy.mockClear();
  });

  it("fee on top: 100 USDT + $2 fee, $0.50 off → the sheet pays out $100.50", () => {
    render(<Harness />);
    expect(mockSheetProps.last?.totalAmount).toBe(100);
    expect(mockSheetProps.last?.maxDiscount).toBe(2);
    act(() => mockSheetProps.last?.onDiscountChange?.(0.5));
    expect(mockSheetProps.last?.totalAmount).toBe(100.5);
    expect(onDiscountChangeSpy).toHaveBeenLastCalledWith(0.5);
  });

  it("customer pays the fee separately: payout stays $100, the fee to collect drops to $1.50", () => {
    render(<Harness separately />);
    expect(mockSheetProps.last?.counterFlow?.totalAmount).toBe(2);
    act(() => mockSheetProps.last?.onDiscountChange?.(0.5));
    expect(mockSheetProps.last?.totalAmount).toBe(100);
    expect(mockSheetProps.last?.counterFlow?.totalAmount).toBe(1.5);
  });

  it("inside a customer session the cash-out sheet offers no discount (the basket books none)", () => {
    mockActiveSession = { id: 1 };
    render(<Harness />);
    expect(mockSheetProps.last?.showDiscount).toBe(false);
  });
});
