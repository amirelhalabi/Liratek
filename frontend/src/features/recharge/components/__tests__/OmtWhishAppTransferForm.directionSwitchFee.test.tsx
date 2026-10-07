/** @jest-environment jsdom */

/**
 * OmtWhishAppTransferForm — a fee typed in one direction must not survive a
 * switch to the other (production testing 2026-10-07).
 *
 * Reported: a fee typed on Whish App RECEIVE survived the switch to SEND and
 * was charged and booked as commission, although Whish App SEND shows no fee
 * input at all. Two fixes, each guarded here: switching Send/Receive resets
 * the fee field and the "fee paid by" choice, and Whish App SEND never
 * carries a fee (forced in calculateOmtWhishAppFees).
 *
 * The PaymentSheet stub and module mocks are the ones
 * OmtWhishAppTransferForm.appWalletFeeModes.test.tsx uses.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

// PaymentSheet stub: exposes onPaymentChange (the shop's payout lines) and,
// when the form threads a `counterFlow` prop through, a second injection
// button for the customer's fee-repayment lines — mirrors the real
// MultiPaymentInput's counter-flow section without rendering it for real.
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    counterFlow?: {
      label: string;
      totalAmount: number;
      currency: string;
      onChange: (lines: unknown[]) => void;
    };
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-inject-payout"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "P1",
                method: "OMT",
                currencyCode: window.__stubPayoutCurrency ?? "USD",
                amount: window.__stubPayoutAmount,
              },
            ])
          }
        />
        {props.counterFlow && (
          <div data-testid="stub-counter-flow">
            <span data-testid="stub-counter-flow-label">
              {props.counterFlow.label}
            </span>
            <button
              data-testid="stub-inject-fee"
              onClick={() =>
                props.counterFlow!.onChange([
                  {
                    id: "F1",
                    method: "CASH",
                    currencyCode: props.counterFlow!.currency,
                    amount: props.counterFlow!.totalAmount,
                  },
                ])
              }
            />
          </div>
        )}
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    addOMTTransaction: mockAddOMTTransaction,
  }),
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
  useSession: () => ({
    activeSession: mockActiveSession,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
      { code: "WHISH", label: "Whish Wallet" },
    ],
    drawerAffectingMethods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
    ],
  }),
}));

jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
}));

jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: false,
    setSaveAsClient: jest.fn(),
    showCheckbox: false,
    trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
    resetSaveAsClient: jest.fn(),
  }),
}));

jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
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

declare global {
  var __stubPayoutAmount: number;
  var __stubPayoutCurrency: string | undefined;
}

const formatAmount = (val: number, currency: string) =>
  currency === "USD"
    ? `$${val.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : `${val.toLocaleString()} ${currency}`;

function renderForm(activeProvider: "OMT_APP" | "WHISH_APP") {
  return render(
    <OmtWhishAppTransferForm
      activeProvider={activeProvider}
      transactions={[]}
      loadFinancialData={jest.fn()}
      formatAmount={formatAmount}
    />,
  );
}

function switchToReceive() {
  fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
}

function typeAmount(value: string) {
  fireEvent.change(
    document.getElementById("transfer-amount") as HTMLInputElement,
    { target: { value } },
  );
}

function switchToSend() {
  fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
}

function typeFee(value: string) {
  fireEvent.change(
    document.getElementById("transfer-fee") as HTMLInputElement,
    { target: { value } },
  );
}

describe("OmtWhishAppTransferForm — fee does not carry over a direction switch", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockActiveSession = null;
    window.__stubPayoutAmount = 100;
    window.__stubPayoutCurrency = undefined;
  });

  it("Whish App: a fee typed on RECEIVE is not charged or booked on SEND", async () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");
    typeFee("5");

    switchToSend();
    expect(document.getElementById("transfer-fee")).toBeNull(); // no fee input on Whish App SEND

    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    fireEvent.click(screen.getByTestId("stub-inject-payout"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.serviceType).toBe("SEND");
    expect(payload.amount).toBeCloseTo(100, 2);
    expect(payload.commission ?? 0).toBe(0);
    expect(payload.whishFee ?? 0).toBe(0);
  });

  it("Whish App: RECEIVE -> SEND -> RECEIVE clears the typed fee and the 'fee paid by' choice", () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");
    typeFee("5");
    fireEvent.click(screen.getByTestId("fee-mode-deducted"));
    expect(screen.getByTestId("fee-mode-deducted")).toBeChecked();

    switchToSend();
    switchToReceive();

    expect(
      (document.getElementById("transfer-fee") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByTestId("fee-mode-sender")).toBeChecked();
  });

  it("OMT App: a fee typed on SEND is cleared after RECEIVE -> SEND", () => {
    renderForm("OMT_APP");
    typeAmount("100");
    typeFee("3");
    expect(
      (document.getElementById("transfer-fee") as HTMLInputElement).value,
    ).toBe("3");

    switchToReceive();
    switchToSend();

    expect(
      (document.getElementById("transfer-fee") as HTMLInputElement).value,
    ).toBe("");
  });

  // Rule 17: both currency-switch cases below ran red before the fix
  // (2026-10-07): the LBP payload's amount Expected 1000000, Received
  // 1000005; the OMT App fee field Expected "", Received "3".
  it("Whish App: a fee typed in USD is not charged or booked after switching to LBP (fee field hidden there)", async () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");
    typeFee("5");

    fireEvent.click(screen.getByRole("button", { name: "LBP" }));
    expect(document.getElementById("transfer-fee")).toBeNull(); // no fee input on Whish App LBP RECEIVE
    typeAmount("1000000");

    window.__stubPayoutAmount = 1_000_000;
    window.__stubPayoutCurrency = "LBP";
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    fireEvent.click(screen.getByTestId("stub-inject-payout"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.serviceType).toBe("RECEIVE");
    expect(payload.currency).toBe("LBP");
    expect(payload.amount).toBe(1_000_000);
    expect(payload.commission ?? 0).toBe(0);
    expect(payload.whishFee ?? 0).toBe(0);
  });

  it("OMT App: switching USD -> LBP -> USD clears a typed fee", () => {
    renderForm("OMT_APP");
    typeAmount("100");
    typeFee("3");

    fireEvent.click(screen.getByRole("button", { name: "LBP" }));
    fireEvent.click(screen.getByRole("button", { name: "USD" }));

    expect(
      (document.getElementById("transfer-fee") as HTMLInputElement).value,
    ).toBe("");
  });
});
