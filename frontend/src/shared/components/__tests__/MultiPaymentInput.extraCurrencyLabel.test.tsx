/** @jest-environment jsdom */
/**
 * MultiPaymentInput — the currency picker beside the Extra amount is named
 * "Extra currency" for screen readers (shop-day test 2026-10-16).
 *
 * In the session checkout (an extra-only line, split payment) the picker
 * next to the Extra amount was announced as "Discount currency", although
 * the line is the Extra. It is named after the side that is showing.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput } from "@liratek/ui";

const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

function renderSplitBox(showDiscount: boolean) {
  render(
    <MultiPaymentInput
      totals={[{ amount: 35, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={[{ code: "CASH", label: "Cash" }]}
      currencies={CURRENCIES}
      exchangeRate={89_000}
      initialLines={[
        { method: "CASH", currencyCode: "USD", amount: 26 },
        { method: "CASH", currencyCode: "LBP", amount: 801_000 },
      ]}
      onChange={jest.fn()}
      onDiscountChange={jest.fn()}
      onExtraChange={jest.fn()}
      showDiscount={showDiscount}
    />,
  );
}

describe("MultiPaymentInput — Extra currency label", () => {
  it("extra-only line (session checkout): the picker is 'Extra currency'", () => {
    renderSplitBox(false);
    expect(screen.getByLabelText("Extra", { selector: "input" })).toBeTruthy();
    expect(screen.getByLabelText("Extra currency")).toBeTruthy();
    expect(screen.queryByLabelText("Discount currency")).toBeNull();
  });

  it("Discount side stays 'Discount currency'; switching to Extra renames it", () => {
    renderSplitBox(true);
    expect(screen.getByLabelText("Discount currency")).toBeTruthy();
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    expect(screen.getByLabelText("Extra currency")).toBeTruthy();
    expect(screen.queryByLabelText("Discount currency")).toBeNull();
  });
});
