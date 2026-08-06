/** @jest-environment jsdom */

/**
 * OmtWhishAppTransferForm — Phase D app-wallet fee modes
 * (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4, owner decision Q7 2026-08-06).
 *
 * The "Fee included in amount" checkbox is replaced by a three-way "Fee paid
 * by" choice for an OMT App / Whish App RECEIVE with a fee:
 *   - SENDER   (default, was unchecked)  — mode A, unchanged math.
 *   - DEDUCTED (was checked, WHISH_APP only) — mode B, unchanged math.
 *   - SEPARATE (NEW, both providers) — mode C: the wallet receives the BARE
 *     amount, the customer receives the FULL amount, and the fee is
 *     collected back from the customer via a counter-flow `feePayments[]`
 *     leg set instead of netting through the wallet-vs-payout spread.
 *
 * Bug 6 (§2): the form never sent `cashoutMethod` — a non-cash single-line
 * payout silently hit the General drawer via the repository's no-legs
 * fallback. It is now synced from the single payout line's method and sent
 * on every RECEIVE, all three modes alike.
 *
 * rule 17: this whole file is proven failing-first — pre-change, none of
 * the `fee-mode-*` radios exist (the form only had a WHISH_APP-only
 * checkbox), no `counterFlow` prop is threaded through PaymentSheet, and
 * `cashoutMethod` is never part of the payload. Every test in this file
 * either cannot render its target element or asserts a payload field the
 * pre-change form cannot produce — confirmed by running this file against
 * the pre-change source (see the task's failing-first proof).
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
                currencyCode: "USD",
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
  // eslint-disable-next-line no-var
  var __stubPayoutAmount: number;
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

describe("OmtWhishAppTransferForm — Phase D app-wallet fee modes", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockActiveSession = null;
    window.__stubPayoutAmount = 100;
  });

  // (a) mode A (Sender, default) — byte-identical fee-math payload to
  // before this feature (amount/whishFee/commission/includingFees/no
  // feePayments). cashoutMethod is Bug 6 — a separate, always-on addition
  // to every RECEIVE payload, asserted in the SAME test rather than
  // contradicting the "byte-identical" claim: the fee-math fields below are
  // exactly what pre-Phase-D code sent for this scenario, and cashoutMethod
  // is the one new key Bug 6 adds regardless of fee mode.
  it("mode A (Sender): unchanged wallet/fee math, no feePayments, cashoutMethod synced (bug 6)", async () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");

    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");

    expect(screen.getByTestId("fee-mode-sender")).toBeChecked();

    window.__stubPayoutAmount = 100; // mode A payout = entered amount
    fireEvent.click(screen.getByTestId("stub-inject-payout"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(payload.amount).toBeCloseTo(101, 2); // wallet = amount + fee
    expect(payload.whishFee).toBeCloseTo(1, 2);
    expect(payload.commission).toBeCloseTo(1, 2);
    expect(payload.includingFees).toBe(false);
    expect(payload.feePayments).toBeUndefined();
    expect(payload.cashoutMethod).toBe("OMT"); // bug 6: synced from the payout line
  });

  // (b) mode B (Deducted from payout, WHISH_APP only) — unchanged math.
  it("mode B (Deducted from payout): unchanged wallet/fee math, no feePayments", async () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");

    fireEvent.click(screen.getByTestId("fee-mode-deducted"));

    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");

    window.__stubPayoutAmount = 99; // mode B payout = amount - fee
    fireEvent.click(screen.getByTestId("stub-inject-payout"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(payload.amount).toBeCloseTo(100, 2); // wallet = bare entered amount
    expect(payload.whishFee).toBeCloseTo(1, 2);
    expect(payload.commission).toBeCloseTo(1, 2);
    expect(payload.includingFees).toBe(true);
    expect(payload.feePayments).toBeUndefined();
    expect(payload.cashoutMethod).toBe("OMT");
  });

  // (c) mode B is not offered on OMT App — mirrors the old checkbox's
  // reachability (it only ever rendered for WHISH_APP). Mode C IS offered
  // on both providers.
  it("mode B (Deducted from payout) is not offered on OMT App; mode C is", () => {
    renderForm("OMT_APP");
    switchToReceive();
    typeAmount("100");

    expect(screen.getByTestId("fee-mode-sender")).toBeInTheDocument();
    expect(screen.queryByTestId("fee-mode-deducted")).not.toBeInTheDocument();
    expect(screen.getByTestId("fee-mode-separate")).toBeInTheDocument();
  });

  // (d) mode C (Customer pays separately, NEW): the wallet receives the bare
  // amount, the payout is the FULL amount, and the fee is collected via a
  // separate feePayments leg — proven failing-first: pre-change there is no
  // `fee-mode-separate` testid to click and no `counterFlow` prop ever
  // reaches PaymentSheet, so this test cannot even drive the scenario on
  // the old form.
  it("mode C (Customer pays separately): wallet=bare, payout=full, feePayments=[{CASH,...,fee}], cashoutMethod synced", async () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");

    fireEvent.click(screen.getByTestId("fee-mode-separate"));

    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");

    // The counter-flow section is offered — seeded label + total.
    expect(screen.getByTestId("stub-counter-flow-label")).toHaveTextContent(
      "Customer pays — fee",
    );

    window.__stubPayoutAmount = 100; // mode C payout = the FULL entered amount
    fireEvent.click(screen.getByTestId("stub-inject-payout"));
    fireEvent.click(screen.getByTestId("stub-inject-fee"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(payload.amount).toBeCloseTo(100, 2); // wallet = bare amount (NOT 101 like mode A)
    expect(payload.whishFee).toBeCloseTo(1, 2);
    expect(payload.commission).toBeCloseTo(1, 2);
    expect(payload.includingFees).toBe(false);
    expect(payload.payments).toEqual([
      expect.objectContaining({
        method: "OMT",
        currencyCode: "USD",
        amount: 100, // payout = FULL amount (NOT 99 like mode B)
      }),
    ]);
    expect(payload.feePayments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "USD",
        amount: 1,
      }),
    ]);
    expect(payload.cashoutMethod).toBe("OMT"); // bug 6: synced from the payout line
  });

  // (e) For-Partner active: mode C is unavailable (and, since the toggle
  // routes to handleForPartnerSubmit which never reads feePayments/
  // cashoutMethod at all, no feePayments could ever be sent for a partner
  // transfer either way).
  it("For-Partner active: mode C option is hidden", () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");

    expect(screen.getByTestId("fee-mode-separate")).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("omt-whish-transfer-for-partner-toggle"),
    );

    expect(screen.queryByTestId("fee-mode-separate")).not.toBeInTheDocument();
    // Sender/Deducted remain available — only mode C is partner-gated.
    expect(screen.getByTestId("fee-mode-sender")).toBeInTheDocument();
  });

  // (e, session variant) mode C is also unavailable inside an active
  // session — the pooled basket doesn't collect fee legs yet (§2 bug 1's
  // territory).
  it("Active session: mode C option is hidden", () => {
    mockActiveSession = { id: 1 };
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");

    expect(screen.queryByTestId("fee-mode-separate")).not.toBeInTheDocument();
  });
});
