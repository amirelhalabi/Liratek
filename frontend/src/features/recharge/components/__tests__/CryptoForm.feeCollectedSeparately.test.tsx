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
  { code: "BINANCE", label: "Binance" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];

/** Reproduces the props-down wiring Recharge/index.tsx owns for real —
 *  CryptoForm itself holds none of this state. */
function Harness({
  initialCryptoType = "RECEIVE",
  clientId = null,
}: {
  initialCryptoType?: "SEND" | "RECEIVE";
  clientId?: number | null;
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
      cryptoClientId={clientId}
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
      exchangeRate={89000}
    />
  );
}

function openPaymentSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Confirm Cash Out/i }));
}

/** The "Customer pays" lines as rendered: method, currency, amount. */
function customerLines() {
  const section = screen.getByTestId("counter-flow-section");
  return Array.from(
    section.querySelectorAll<HTMLElement>(
      '[data-testid^="counter-flow-line-"]',
    ),
  ).map((row) => ({
    method: row.querySelector<HTMLSelectElement>(
      '[data-testid^="counter-flow-method-"]',
    )!.value,
    currencyCode: row.querySelector<HTMLSelectElement>(
      '[data-testid^="counter-flow-currency-"]',
    )!.value,
    amount: row.querySelector<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    )!.value,
  }));
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

  // LIRA-321 (US4): the section now carries the USDT line too, so mode C
  // seeds TWO lines (100 USDT Binance + the $1 Cash fee) in split mode.
  it("selecting mode C threads a counterFlow through to the real PaymentSheet/MultiPaymentInput: 100 USDT Binance + $1 Cash fee", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-separate"));
    openPaymentSheet();

    const section = await screen.findByTestId("counter-flow-section");
    // LIRA-321: a cash-out is a payout screen — the section title is the
    // plain "Customer pays" (the page's label is not shown there).
    expect(section).toHaveTextContent("Customer pays");
    expect(
      screen.getByTestId("direction-chip-customer-pays"),
    ).toHaveTextContent("IN");

    expect(customerLines()).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: "100" },
      { method: "CASH", currencyCode: "USD", amount: "1" },
    ]);
  });

  // Rewritten guard (rule 24): modes A and B used to render no section at
  // all. From LIRA-321 every walk-in cash-out shows "Customer pays" with ONE
  // Binance line — and never a separate fee line.
  it("mode A (Sender, default): one Binance line for USDT amount + fee, no fee line", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    openPaymentSheet();
    await screen.findByTestId("counter-flow-section");

    expect(customerLines()).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: "101" },
    ]);
  });

  it("mode B (Deducted from payout): one Binance line for the USDT amount, no fee line", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-deducted"));
    openPaymentSheet();
    await screen.findByTestId("counter-flow-section");

    expect(customerLines()).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: "100" },
    ]);
  });

  it("the USDT line offers USDT, while the shop's payout lines stay USD/LBP", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    openPaymentSheet();
    const section = await screen.findByTestId("counter-flow-section");
    const cfCurrency = section.querySelector<HTMLSelectElement>(
      '[data-testid^="counter-flow-currency-"]',
    )!;
    expect(Array.from(cfCurrency.options).map((o) => o.value)).toEqual([
      "USDT",
      "USD",
      "LBP",
    ]);
    // Nothing outside the "Customer pays" section offers USDT.
    const outside = Array.from(
      document.querySelectorAll<HTMLOptionElement>("option[value='USDT']"),
    ).filter((o) => !section.contains(o));
    expect(outside).toHaveLength(0);
  });

  it("US4.4: with a linked client, typing 80 on the USDT line adds a $20 Customer Account line (1 USDT = $1)", async () => {
    render(<Harness initialCryptoType="RECEIVE" clientId={7} />);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-deducted"));
    openPaymentSheet();
    const section = await screen.findByTestId("counter-flow-section");
    const usdtAmount = section.querySelector<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    )!;
    fireEvent.change(usdtAmount, { target: { value: "80" } });

    await waitFor(() =>
      expect(customerLines()).toEqual([
        { method: "BINANCE", currencyCode: "USDT", amount: "80" },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: "20" },
      ]),
    );
  });

  // Guard: with no client NO auto line is added (never a Cash line for
  // money not handed over) — the section stays single and asks for a client.
  it("with no client, typing 80 on the USDT line adds no line and shows $20 still to settle", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-deducted"));
    openPaymentSheet();
    const section = await screen.findByTestId("counter-flow-section");
    fireEvent.change(
      section.querySelector<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      )!,
      { target: { value: "80" } },
    );

    const hint = await screen.findByTestId("counter-flow-unaccounted");
    expect(hint).toHaveTextContent("Still to settle: 20 USD");
    expect(hint).toHaveTextContent("pick a client");
    expect(customerLines()).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: "80" },
    ]);
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

  // Rewritten guard (rule 24): switching back from mode C used to remove
  // the whole section; now it removes the fee line and returns to the one
  // Binance line (USDT amount + fee in mode A).
  it("the fee line disappears again once mode C is switched back to Sender", async () => {
    render(<Harness initialCryptoType="RECEIVE" />);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-separate"));
    openPaymentSheet();
    await screen.findByTestId("counter-flow-section");
    expect(customerLines()).toHaveLength(2);

    fireEvent.click(screen.getByTestId("crypto-fee-mode-sender"));

    await waitFor(() =>
      expect(customerLines()).toEqual([
        { method: "BINANCE", currencyCode: "USDT", amount: "101" },
      ]),
    );
  });
});
