/** @jest-environment jsdom */

/**
 * PaymentSheet — BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase D.
 *
 * PaymentSheet is a thin wrapper around MultiPaymentInput (which already
 * owns the `counterFlow` opt-in section, shipped in Phase C —
 * MultiPaymentInput.test.tsx). This file proves ONLY the pass-through: a
 * `counterFlow` prop given to PaymentSheet reaches the real, unmocked
 * MultiPaymentInput and renders its counter-flow section — no `@liratek/ui`
 * mocking here, unlike the form-level tests, specifically so this exercises
 * the real component tree end to end.
 *
 * rule 17: proven failing-first — pre-change, `PaymentSheetProps` has no
 * `counterFlow` field and the prop is never forwarded to MultiPaymentInput,
 * so passing it is a silent no-op and `counter-flow-section` never renders.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { PaymentSheet, type PaymentSheetProps } from "../PaymentSheet";

const PAYMENT_METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];

function renderSheet(overrides: Partial<PaymentSheetProps> = {}) {
  return render(
    <PaymentSheet
      open
      onClose={jest.fn()}
      onConfirm={jest.fn()}
      totalAmount={100}
      totalAmountCurrency="USD"
      currency="USD"
      paymentMethods={PAYMENT_METHODS}
      onPaymentChange={jest.fn()}
      {...overrides}
    />,
  );
}

describe("PaymentSheet — counterFlow pass-through (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase D)", () => {
  it("does not render a counter-flow section when the prop is absent (regression)", () => {
    renderSheet();

    expect(
      screen.queryByTestId("counter-flow-section"),
    ).not.toBeInTheDocument();
  });

  it("renders the real MultiPaymentInput's counter-flow section, label, and seeded line when counterFlow is supplied", () => {
    const onChange = jest.fn();
    renderSheet({
      counterFlow: {
        label: "Customer pays — fee",
        totalAmount: 5,
        currency: "USD",
        onChange,
      },
    });

    expect(screen.getByTestId("counter-flow-section")).toBeInTheDocument();
    expect(screen.getByText("Customer pays — fee")).toBeInTheDocument();
    expect(screen.getByTestId("direction-chip-customer-pays")).toHaveTextContent(
      "Customer pays",
    );

    const amountInput = document.querySelector<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    );
    expect(amountInput?.value).toBe("5");

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ method: "CASH", currencyCode: "USD", amount: 5 }),
    ]);
  });

  it("forwards counterFlow.paymentMethods/requiresClient/hasClient to MultiPaymentInput", () => {
    const onChange = jest.fn();
    renderSheet({
      counterFlow: {
        label: "Customer pays — fee",
        totalAmount: 5,
        currency: "USD",
        onChange,
        paymentMethods: [{ code: "CASH", label: "Cash" }],
        requiresClient: true,
        hasClient: false,
      },
    });

    // CUSTOMER_ACCOUNT is excluded from the counter-flow method list because
    // requiresClient && !hasClient (mirrors canChargeToCustomerAccount-grade
    // gating — MultiPaymentInput.test.tsx covers the underlying behavior).
    const methodSelect = document.querySelector<HTMLSelectElement>(
      '[data-testid^="counter-flow-method-"]',
    );
    const optionValues = Array.from(methodSelect?.options ?? []).map(
      (o) => o.value,
    );
    expect(optionValues).toEqual(["CASH"]);
  });

  it("emits counter-flow edits through the SAME onChange only — the main payment section keeps working unaffected", () => {
    const mainOnChange = jest.fn();
    const counterFlowOnChange = jest.fn();
    renderSheet({
      onPaymentChange: mainOnChange,
      counterFlow: {
        label: "Customer pays — fee",
        totalAmount: 5,
        currency: "USD",
        onChange: counterFlowOnChange,
      },
    });

    const amountInput = document.querySelector<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    );
    fireEvent.change(amountInput as HTMLInputElement, {
      target: { value: "7" },
    });

    const lastCounterFlowLines = counterFlowOnChange.mock.calls.at(-1)?.[0];
    expect(lastCounterFlowLines).toEqual([
      expect.objectContaining({ amount: 7 }),
    ]);
    // The main section's own onChange never saw a "7" line — proves the two
    // are wired independently, exactly as MultiPaymentInput's own contract
    // promises.
    for (const call of mainOnChange.mock.calls) {
      expect(call[0]).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ amount: 7 })]),
      );
    }
  });
});
