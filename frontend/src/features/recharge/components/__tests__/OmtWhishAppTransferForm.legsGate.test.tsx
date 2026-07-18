/** @jest-environment jsdom */

/**
 * OmtWhishAppTransferForm — payment legs must be forwarded whenever ANY
 * payment line exists, never gated on split (S1, PAYMENT_LEGS_INTEGRITY_PLAN
 * wave 6 — the owner-reported Whish App LBP-as-USD bug).
 *
 * Pre-fix, `useStructuredPayments` was `isSplitPayment || returnLegs.length >
 * 0` — a SINGLE-line payment (no split, no change) fell through to
 * `payments: undefined`, so only `paidByMethod` (a bare method name) reached
 * the backend; the tender's own amount + currency were dropped, and the
 * repository's fallback assumed tender currency == service currency.
 *
 * Proven failing-first (rule 17): reverting `useStructuredPayments` to
 * `isSplitPayment || returnLegs.length > 0` makes this test's `payments`
 * assertion fail (payload falls back to `payments: undefined`).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

// PaymentSheet stub: exposes onPaymentChange/onConfirm so the test can inject
// a single (non-split) leg and confirm — mirrors FinancialForm.legsCarrier's
// stub pattern.
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
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

describe("OmtWhishAppTransferForm — payment legs never gated on split (S1)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("forwards a SINGLE-line LBP cash payment as a real leg on a Whish App SEND", async () => {
    renderForm();

    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "10" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");

    // Inject ONE payment line (no split, no change) — the common case.
    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    // The bug: pre-fix, a single (non-split, no-change) payment fell through
    // to `payments: undefined` — the LBP tender's own amount/currency never
    // reached the backend, which then assumed tender == service currency.
    expect(payload.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 900000,
      }),
    ]);
  });

  // Payment-Legs Integrity plan (wave 9, lira-108 + lira-095): the
  // repository's wallet-transfer SEND branch no longer GUESSES the
  // customer-owed total as amount+fee (wrong whenever the fee is carved OUT
  // of the entered amount instead of added on top) — it reconciles against
  // `checkoutTotal`, this form's own `totalAmount` (what the PaymentSheet
  // actually charges). `tender_exchange_rate` is the rate this form's own
  // PaymentSheet/MultiPaymentInput converted tender at (SEND uses sellRate
  // per this form's `exchangeRate = serviceType === "RECEIVE" ? buyRate :
  // sellRate`), so the repository reconciles at the SAME rate the till used.
  it("attaches checkoutTotal + tender_exchange_rate on a SEND with legs", async () => {
    renderForm();

    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "10" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");

    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    // WHISH_APP SEND, currency defaults USD, no fee (autoFee only applies to
    // RECEIVE) — totalAmount = parsedAmount + providerFee = 10 + 0 = 10.
    expect(payload.checkoutTotal).toEqual({ usd: 10, lbp: 0 });
    // sellRate from the mocked useSellRate above.
    expect(payload.tender_exchange_rate).toBe(89500);
  });
});
