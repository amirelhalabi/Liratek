/** @jest-environment jsdom */

/**
 * CryptoForm (Binance) — BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §10.2, mode C
 * ("Customer pays separately"): a Binance Cash Out (RECEIVE) fee-on-top can
 * now be collected from the customer via a dedicated counter-flow, mirroring
 * the OMT App / Whish App Phase D radio group (see
 * OmtWhishAppTransferForm.appWalletFeeModes.test.tsx for the equivalent
 * coverage on the app-wallet forms).
 *
 * CryptoForm is a PURE presentational component — every piece of state
 * (cryptoType, feeIncluded, feeCollectedSeparately, ...) is owned by the
 * PARENT (Recharge/index.tsx) and passed down as props + setters. This test
 * renders the REAL CryptoForm (not a stub) wrapped in a small stateful
 * `Harness` that reproduces the parent's props-down wiring, so clicking a
 * radio actually flips the prop that flows back in — exactly how the real
 * page behaves. The real `PaymentSheet` (and, inside it, the real
 * `MultiPaymentInput`) is left UNMOCKED so the `counterFlow` prop is proven
 * to reach all the way to a rendered `counter-flow-section`, not just to
 * stop at a stub boundary.
 *
 * rule 17: proven failing-first — pre-change, CryptoForm has no
 * `feeCollectedSeparately`/`setFeeCollectedSeparately`/
 * `onFeePaymentLinesChange`/`feePaymentMethods` props, no
 * `crypto-fee-mode-*` radios (only the old "Fee included in amount"
 * checkbox for both SEND and RECEIVE), and never threads a `counterFlow`
 * prop through `PaymentSheet` — every test below either cannot find its
 * target element or asserts behavior the pre-change component cannot
 * produce (confirmed by stashing this feature's CryptoForm.tsx changes and
 * re-running this file: TypeScript compile fails on the harness's unknown
 * props, and with the harness relaxed to only known props, every
 * `crypto-fee-mode-*`/`counter-flow-section` assertion fails to find its
 * element).
 */

import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import { CryptoForm } from "../CryptoForm";
import { PROVIDER_CONFIGS } from "../../types";

const BINANCE_CONFIG = PROVIDER_CONFIGS.find((p) => p.key === "BINANCE")!;

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({ addOMTTransaction: mockAddOMTTransaction }),
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
}: {
  initialCryptoType?: "SEND" | "RECEIVE";
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
      exchangeRate={89000}
    />
  );
}

function openPaymentSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Confirm Cash Out/i }));
}

describe("CryptoForm — Binance mode C (Customer pays separately)", () => {
  beforeEach(() => {
    mockActiveSession = null;
    mockAddOMTTransaction.mockClear();
  });

  it("SEND keeps the plain checkbox — no fee-mode radios at all", () => {
    render(<Harness initialCryptoType="SEND" />);

    expect(screen.getByText("Fee included in amount")).toBeInTheDocument();
    expect(
      screen.queryByTestId("crypto-fee-mode-sender"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("crypto-fee-mode-deducted"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("crypto-fee-mode-separate"),
    ).not.toBeInTheDocument();
  });

  it("RECEIVE renders the 3-way radio group instead of the checkbox", () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    expect(
      screen.queryByText("Fee included in amount"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("crypto-fee-mode-sender")).toBeChecked();
    expect(screen.getByTestId("crypto-fee-mode-deducted")).not.toBeChecked();
    expect(screen.getByTestId("crypto-fee-mode-separate")).toBeInTheDocument();
  });

  it("hides 'Customer pays separately' once For Partner is checked", () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    expect(screen.getByTestId("crypto-fee-mode-separate")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("crypto-for-partner-toggle"));

    expect(
      screen.queryByTestId("crypto-fee-mode-separate"),
    ).not.toBeInTheDocument();
    // Sender/Deducted remain available — only mode C is partner-gated.
    expect(screen.getByTestId("crypto-fee-mode-sender")).toBeInTheDocument();
    expect(screen.getByTestId("crypto-fee-mode-deducted")).toBeInTheDocument();
  });

  it("hides 'Customer pays separately' while a session is active", () => {
    mockActiveSession = { id: 1 };
    render(<Harness initialCryptoType="RECEIVE" />);

    expect(
      screen.queryByTestId("crypto-fee-mode-separate"),
    ).not.toBeInTheDocument();
  });

  it("defensive reset: selecting mode C then toggling For Partner resets the selection back to Sender", () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-separate"));
    expect(screen.getByTestId("crypto-fee-mode-separate")).toBeChecked();

    // Toggle For Partner on, then off — the option (and its testid) drops
    // out of the DOM entirely while checked, so we can only re-observe the
    // underlying value once the radio group re-mounts.
    fireEvent.click(screen.getByTestId("crypto-for-partner-toggle"));
    fireEvent.click(screen.getByTestId("crypto-for-partner-toggle"));

    expect(screen.getByTestId("crypto-fee-mode-sender")).toBeChecked();
    expect(screen.getByTestId("crypto-fee-mode-separate")).not.toBeChecked();
  });

  it("selecting mode C threads a counterFlow through to the real PaymentSheet/MultiPaymentInput, seeded with the fee", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-separate"));
    openPaymentSheet();

    await screen.findByTestId("counter-flow-section");
    expect(screen.getByText("Customer pays — Binance fee")).toBeInTheDocument();

    const feeAmountInput = document.querySelector<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    );
    expect(feeAmountInput?.value).toBe("1");
  });

  it("mode A (Sender, default) never renders a counter-flow section", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    openPaymentSheet();
    await screen.findByRole("heading", { name: /Confirm Cash Out/i });

    expect(
      screen.queryByTestId("counter-flow-section"),
    ).not.toBeInTheDocument();
  });

  it("mode B (Deducted from payout) never renders a counter-flow section", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-deducted"));
    openPaymentSheet();
    await screen.findByRole("heading", { name: /Confirm Cash Out/i });

    expect(
      screen.queryByTestId("counter-flow-section"),
    ).not.toBeInTheDocument();
  });

  it("For Partner active: mode C option is hidden and the notice replaces the payment sheet", () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    fireEvent.click(screen.getByTestId("crypto-for-partner-toggle"));

    expect(
      screen.queryByTestId("crypto-fee-mode-separate"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("crypto-partner-no-payment-notice"),
    ).toBeInTheDocument();
  });

  // Guard against a false pass via a permanently-visible counter-flow
  // section — waitFor would time out here if `findByTestId` above were
  // matching on rendered content rather than the real conditional prop.
  it("counter-flow section disappears again once mode C is switched back to Sender", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-separate"));
    openPaymentSheet();
    await screen.findByTestId("counter-flow-section");

    fireEvent.click(screen.getByTestId("crypto-fee-mode-sender"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("counter-flow-section"),
      ).not.toBeInTheDocument(),
    );
  });
});
