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
    expect(
      screen.getByTestId("direction-chip-customer-pays"),
    ).toHaveTextContent("Customer pays");

    const amountInput = document.querySelector<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    );
    expect(amountInput?.value).toBe("5");

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "USD",
        amount: 5,
      }),
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

  // LIRA-321 (T009): the sheet gates Confirm on the page's verdict and
  // forwards the new "Customer pays" fields to the real MultiPaymentInput.
  describe("LIRA-321 — confirmDisabled and the new counterFlow fields", () => {
    it("confirmDisabled disables the Confirm button; without it Confirm stays enabled", () => {
      const { rerender } = renderSheet({ confirmLabel: "Confirm" });
      expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
      rerender(
        <PaymentSheet
          open
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          totalAmount={100}
          totalAmountCurrency="USD"
          currency="USD"
          paymentMethods={PAYMENT_METHODS}
          onPaymentChange={jest.fn()}
          confirmLabel="Confirm"
          confirmDisabled
        />,
      );
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });

    it("forwards seedLines, lockCurrency and onStateChange to MultiPaymentInput", () => {
      const onStateChange = jest.fn();
      renderSheet({
        payer: "payout",
        counterFlow: {
          label: "Customer pays — fee",
          totalAmount: 105,
          currency: "USD",
          onChange: jest.fn(),
          seedLines: [
            { method: "CASH", currencyCode: "USD", amount: 100 },
            { method: "CASH", currencyCode: "USD", amount: 5 },
          ],
          lockCurrency: true,
          onStateChange,
        },
      });

      expect(
        document.querySelectorAll('[data-testid^="counter-flow-line-"]'),
      ).toHaveLength(2);
      for (const sel of Array.from(
        document.querySelectorAll<HTMLSelectElement>(
          '[data-testid^="counter-flow-currency-"]',
        ),
      )) {
        expect(sel).toBeDisabled();
      }
      expect(onStateChange.mock.calls.at(-1)?.[0]).toMatchObject({
        paid: 105,
        balanced: true,
      });
      // Payout labels (contracts/payment-box.md).
      expect(screen.getByTestId("direction-chip-you-pay")).toHaveTextContent(
        "OUT",
      );
      expect(
        screen.getByTestId("direction-chip-customer-pays"),
      ).toHaveTextContent("IN");
      expect(screen.getByText("Customer pays — USD")).toBeInTheDocument();
    });

    it("forwards maxForgive — a small shortfall can be forgiven", () => {
      const onStateChange = jest.fn();
      renderSheet({
        counterFlow: {
          label: "Customer pays — fee",
          totalAmount: 5,
          currency: "USD",
          onChange: jest.fn(),
          maxForgive: 5,
          onStateChange,
        },
      });
      const amount = document.querySelector<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      ) as HTMLInputElement;
      fireEvent.change(amount, { target: { value: "3" } });
      const section = screen.getByTestId("counter-flow-section");
      const removes = section.querySelectorAll<HTMLButtonElement>(
        'button[title="Remove"]',
      );
      fireEvent.click(removes[removes.length - 1]);
      fireEvent.click(screen.getByTestId("counter-flow-forgive"));
      expect(onStateChange.mock.calls.at(-1)?.[0]).toMatchObject({
        forgiven: 2,
        balanced: true,
      });
    });
  });

  // LIRA-321 follow-up (seen live): the disabled Confirm read as an empty
  // bar. index.css repaints the pair `bg-slate-600 text-slate-400` to the
  // SAME colour in dark mode (--s-600 and --t-600 are both #3e4d7d), so the
  // label vanished. Written before the fix (rule 17).
  it("a disabled Confirm keeps its label readable (not the same colour as its background)", () => {
    renderSheet({ confirmDisabled: true });
    const btn = screen.getByRole("button", { name: "Pay $100.00" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Pay $100.00");
    const classes = btn.className.split(/\s+/);
    expect(classes).not.toContain("text-transparent");
    expect(
      classes.includes("bg-slate-600") && classes.includes("text-slate-400"),
    ).toBe(false);
    // A visible, readable text colour on the disabled fill.
    expect(classes).toContain("text-slate-300");
  });
});
