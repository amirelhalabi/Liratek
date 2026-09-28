/** @jest-environment jsdom */

/**
 * OmtWhishAppTransferForm — LIRA-248 guard.
 *
 * Bug: `effectiveRate` (captured from the PaymentSheet's `onExchangeRateChange`
 * — see OmtWhishAppTransferForm.legsGate.test.tsx's "sends the
 * OPERATOR-EDITED sheet rate" test, which proves an edit reaches the
 * payload) is set once when the operator edits the sheet's header rate
 * field, but was never reset afterwards. A SECOND, unrelated transaction —
 * where the operator never touches the rate field at all — inherited the
 * FIRST transaction's edited rate as `tender_exchange_rate`, instead of the
 * current shop rate (`exchangeRate` = sellRate/buyRate from `useSellRate`).
 *
 * Fix under test (LIRA-248): the form resets its captured rate back to the
 * shop rate after a completed transaction, and again when a new transaction
 * starts (opening the payment sheet), so a stale edit can never leak into a
 * later, unrelated transaction.
 *
 * Harness copied from OmtWhishAppTransferForm.legsGate.test.tsx — same
 * PaymentSheet stub (exposes onPaymentChange/onExchangeRateChange/onConfirm)
 * and the same set of collaborator mocks.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onExchangeRateChange?: (rate: number) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-inject-single"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "L1",
                method: "CASH",
                currencyCode: "LBP",
                amount: 900000,
              },
            ])
          }
        />
        <button
          data-testid="stub-edit-rate"
          onClick={() => props.onExchangeRateChange?.(88000)}
        />
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

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
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

const formatAmount = (val: number, currency: string) =>
  currency === "USD"
    ? `$${val.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : `${val.toLocaleString()} ${currency}`;

function renderForm() {
  return render(
    <OmtWhishAppTransferForm
      activeProvider="WHISH_APP"
      transactions={[]}
      loadFinancialData={jest.fn()}
      formatAmount={formatAmount}
    />,
  );
}

function setAmount(value: string) {
  fireEvent.change(
    document.getElementById("transfer-amount") as HTMLInputElement,
    { target: { value } },
  );
}

describe("OmtWhishAppTransferForm — exchange rate does not carry over (LIRA-248)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("a SECOND transaction with no rate edit uses the shop rate, not the first transaction's edited rate", async () => {
    renderForm();

    // Transaction #1: operator edits the rate to 88000 and completes it.
    setAmount("10");
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    fireEvent.click(screen.getByTestId("stub-edit-rate"));
    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    expect(mockAddOMTTransaction.mock.calls[0][0].tender_exchange_rate).toBe(
      88000,
    );

    // Transaction #2: a brand-new transfer. The operator never touches the
    // rate field this time — the sheet's own onExchangeRateChange never
    // fires from a manual edit for this transaction (the stub only fires it
    // via the explicit "stub-edit-rate" button, which is NOT clicked here).
    setAmount("20");
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));

    const secondPayload = mockAddOMTTransaction.mock.calls[1][0];
    // Must be the current shop rate (mocked sellRate = 89500), never the
    // stale 88000 edit left over from transaction #1.
    expect(secondPayload.tender_exchange_rate).toBe(89500);
  });
});
