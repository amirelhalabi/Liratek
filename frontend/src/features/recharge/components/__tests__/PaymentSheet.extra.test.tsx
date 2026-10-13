/** @jest-environment jsdom */

/**
 * PaymentSheet — extra-charge pass-through (LIRA-319, T044).
 *
 * PaymentSheet wraps the REAL MultiPaymentInput (no `@liratek/ui` mock). The
 * sheet must forward `onExtraChange` / `maxExtra` so the recharge forms (and
 * the other forms that use this sheet) get the "− Discount | + Extra" switch:
 *  - with `onExtraChange` the switch shows; an extra of 20,000 on a 300,000
 *    LBP sale is reported and the payment line follows 320,000;
 *  - `maxExtra` caps it ("Capped to max");
 *  - without `onExtraChange` there is no switch (today's sheet, unchanged).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { PaymentSheet, type PaymentSheetProps } from "../PaymentSheet";

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];

function renderSheet(overrides: Partial<PaymentSheetProps> = {}) {
  return render(
    <PaymentSheet
      open
      onClose={jest.fn()}
      onConfirm={jest.fn()}
      totalAmount={300_000}
      totalAmountCurrency="LBP"
      currency="LBP"
      exchangeRate={90_000}
      paymentMethods={PAYMENT_METHODS}
      onPaymentChange={jest.fn()}
      onDiscountChange={jest.fn()}
      {...overrides}
    />,
  );
}

function lineAmount(): number {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  return parseFloat(input.value.replace(/,/g, ""));
}

const extraField = () =>
  screen.getByLabelText("Extra", { selector: "input" }) as HTMLInputElement;

describe("PaymentSheet — extra pass-through (LIRA-319)", () => {
  it("forwards onExtraChange: the switch shows and the extra reaches the page", () => {
    const onExtraChange = jest.fn();
    renderSheet({ onExtraChange });
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    fireEvent.change(extraField(), { target: { value: "20000" } });
    expect(onExtraChange).toHaveBeenLastCalledWith(20_000);
    expect(lineAmount()).toBe(320_000);
  });

  it("forwards maxExtra: an extra above it is capped", () => {
    const onExtraChange = jest.fn();
    renderSheet({ onExtraChange, maxExtra: 10_000 });
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    fireEvent.change(extraField(), { target: { value: "20000" } });
    expect(onExtraChange).toHaveBeenLastCalledWith(10_000);
    expect(screen.getByTestId("discount-cap-note")).toHaveTextContent(
      "Capped to max",
    );
  });

  it("without onExtraChange the sheet offers no extra", () => {
    renderSheet();
    expect(screen.queryByTestId("discount-mode-extra")).not.toBeInTheDocument();
  });
});
