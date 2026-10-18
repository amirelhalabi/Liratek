/** @jest-environment jsdom */

/**
 * PaymentSheet — payout round-up pass-through (LIRA-334, T023).
 *
 * PaymentSheet wraps the REAL MultiPaymentInput (no `@liratek/ui` mock). On a
 * payout sheet it must forward `onRoundUpChange`, so handing out $103 on
 * $102.90 owed reports a $0.10 round-up to the page. Without the prop the
 * sheet reports nothing (today's sheet, unchanged).
 *
 * Rule 17: run against the pre-change sheet first — see the task report.
 */

import { render, fireEvent } from "@testing-library/react";
import { PaymentSheet, type PaymentSheetProps } from "../PaymentSheet";

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];

function renderSheet(overrides: Partial<PaymentSheetProps> = {}) {
  return render(
    <PaymentSheet
      open
      onClose={jest.fn()}
      onConfirm={jest.fn()}
      totalAmount={102.9}
      totalAmountCurrency="USD"
      currency="USD"
      exchangeRate={89_000}
      paymentMethods={PAYMENT_METHODS}
      onPaymentChange={jest.fn()}
      showDiscount={false}
      payer="payout"
      {...overrides}
    />,
  );
}

function typeAmount(value: string): void {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value } });
}

describe("PaymentSheet — payout round-up pass-through (LIRA-334)", () => {
  it("forwards onRoundUpChange: $103 on $102.90 reports {usd: 0.1, lbp: 0}", () => {
    const onRoundUpChange = jest.fn();
    renderSheet({ onRoundUpChange });
    typeAmount("103");
    expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
  });

  it("without onRoundUpChange an overpaid payout is not a round-up", () => {
    renderSheet();
    typeAmount("103");
    expect(
      document.querySelector('[data-testid="payout-roundup-summary"]'),
    ).toBeNull();
  });
});
