/** @jest-environment jsdom */

/**
 * PaymentSheet — Waive pass-through (LIRA-310, T011).
 *
 * PaymentSheet wraps the REAL MultiPaymentInput (no `@liratek/ui` mock), so
 * these cases exercise the actual Waive button:
 *  - `onWaiveRemaining`, `waiveRemainingThreshold` and `waiveRemainingMax`
 *    given to the sheet must reach MultiPaymentInput;
 *  - with no `onWaiveRemaining`, the six recharge forms get the built-in
 *    waive because they already pass `showDiscount` + `maxDiscount` +
 *    `onDiscountChange`.
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
      totalAmount={16.5}
      totalAmountCurrency="USD"
      currency="USD"
      exchangeRate={90_000}
      paymentMethods={PAYMENT_METHODS}
      onPaymentChange={jest.fn()}
      showDiscount={false}
      {...overrides}
    />,
  );
}

/** Type what the customer handed over on the single line. */
function pay(amount: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value: amount } });
}

const waive = () => screen.queryByTestId("waive-remaining");

describe("PaymentSheet — Waive pass-through (LIRA-310)", () => {
  it("forwards onWaiveRemaining: the click reaches the page with the gap", () => {
    const onWaiveRemaining = jest.fn();
    renderSheet({ onWaiveRemaining });
    pay("16");
    const button = waive();
    expect(button).toBeInTheDocument();
    fireEvent.click(button!);
    expect(onWaiveRemaining).toHaveBeenCalledWith(0.5, [
      { currency: "USD", amount: 0.5 },
    ]);
  });

  it("forwards waiveRemainingMax: hidden when the gap exceeds the room left", () => {
    renderSheet({ onWaiveRemaining: jest.fn(), waiveRemainingMax: 0.3 });
    pay("16");
    expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
    expect(waive()).not.toBeInTheDocument();
  });

  it("forwards waiveRemainingThreshold: hidden when the gap exceeds it", () => {
    renderSheet({ onWaiveRemaining: jest.fn(), waiveRemainingThreshold: 0.25 });
    pay("16");
    expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
    expect(waive()).not.toBeInTheDocument();
  });

  it("built-in waive shows with showDiscount + maxDiscount + onDiscountChange and fills the discount", () => {
    const onDiscountChange = jest.fn();
    renderSheet({ showDiscount: true, maxDiscount: 2, onDiscountChange });
    pay("16");
    fireEvent.click(waive()!);
    expect(onDiscountChange).toHaveBeenLastCalledWith(0.5);
    expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
  });

  it("built-in waive hides when the gap would go over maxDiscount", () => {
    renderSheet({
      showDiscount: true,
      maxDiscount: 0.3,
      onDiscountChange: jest.fn(),
    });
    pay("16");
    expect(waive()).not.toBeInTheDocument();
  });
});
