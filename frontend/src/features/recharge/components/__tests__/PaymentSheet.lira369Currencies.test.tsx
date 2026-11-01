/** @jest-environment jsdom */

/**
 * LIRA-369 (T012/T020) — PaymentSheet passes `currencies` and `accountRate`
 * to the real MultiPaymentInput, so an Exchange paying out euros can list
 * EUR, book an Account line at "1 EUR = … USD", and its Confirm button
 * reads in euros. Without the props the sheet lists USD + LBP as before.
 *
 * Rule 17: seen failing before the props existed.
 */

import { render, screen, fireEvent, act } from "@testing-library/react";
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

const currencyOptions = (): string[] =>
  Array.from(
    document.querySelectorAll<HTMLOptionElement>(
      '[data-testid^="payment-currency-"] option',
    ),
  ).map((o) => o.value);

describe("PaymentSheet — LIRA-369 currencies + accountRate pass-through", () => {
  it("defaults to USD + LBP when no currencies are given (regression)", () => {
    renderSheet();
    expect(currencyOptions()).toEqual(["USD", "LBP"]);
    expect(screen.queryByTestId("payment-account-rate")).toBeNull();
  });

  it("an EUR sheet lists only EUR and the Confirm button reads in euros", () => {
    renderSheet({
      totalAmountCurrency: "EUR",
      currency: "EUR",
      currencies: [{ code: "EUR", symbol: "€" }],
    });
    expect(currencyOptions().every((c) => c === "EUR")).toBe(true);
    const confirm = screen
      .getAllByRole("button")
      .find((b) => /100\.00/.test(b.textContent ?? ""));
    expect(confirm?.textContent).toContain("€100.00");
    expect(confirm?.textContent).not.toContain("$");
  });

  it("an EUR Account line shows the account rate box; edits reach the page", () => {
    const onChange = jest.fn();
    renderSheet({
      totalAmountCurrency: "EUR",
      currency: "EUR",
      currencies: [{ code: "EUR", symbol: "€" }],
      hasClient: true,
      initialPaymentMethod: "CUSTOMER_ACCOUNT",
      accountRate: { currency: "EUR", value: 1.1, onChange },
    });
    const box = screen.getByTestId("payment-account-rate") as HTMLInputElement;
    expect(box.value).toBe("1.1");
    act(() => {
      fireEvent.change(box, { target: { value: "1.15" } });
    });
    expect(onChange).toHaveBeenLastCalledWith(1.15);
  });
});
