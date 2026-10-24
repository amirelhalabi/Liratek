/** @jest-environment jsdom */
/**
 * MultiPaymentInput — "Keep" beside "Account" (owner 2026-10-24).
 *
 * On a page that books unreturned change to the customer's account
 * (`unreturnedChangeTo`) AND can book kept change (`onKeptChange`), the
 * cashier chooses where change the customer leaves goes:
 * - "Account" (the default): one CUSTOMER_ACCOUNT OUT leg, nothing kept.
 * - "Keep": no account leg; the change is reported as kept (shop profit).
 * A page without `onKeptChange` shows no Keep button.
 *
 * Rule 17: written after the fix — not proven failing-first.
 */

import { render, fireEvent, screen } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];
const BOTH = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

type Kept = { usd: number; lbp: number } | null;

function sheet(o: {
  onReturnChange: jest.Mock<void, [PaymentLine[]]>;
  onKeptChange?: jest.Mock<void, [Kept]>;
}) {
  return (
    <MultiPaymentInput
      totals={[{ amount: 31.96, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={METHODS}
      currencies={BOTH}
      exchangeRate={89_000}
      showDiscount={false}
      hasClient={true}
      onChange={jest.fn()}
      onReturnChange={o.onReturnChange}
      returnCurrencyFollowsTender={true}
      unreturnedChangeTo="CUSTOMER_ACCOUNT"
      {...(o.onKeptChange ? { onKeptChange: o.onKeptChange } : {})}
    />
  );
}

const pay = (v: string) =>
  fireEvent.change(
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    )!,
    { target: { value: v } },
  );

const accountLegs = (m: jest.Mock<void, [PaymentLine[]]>) =>
  (m.mock.calls.at(-1)?.[0] ?? []).filter(
    (l) => l.method === "CUSTOMER_ACCOUNT",
  );

describe("Keep or Account for change the customer leaves", () => {
  it("Keep reports the $1.04 as kept and emits no account leg", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    render(sheet({ onReturnChange, onKeptChange }));
    pay("33");

    fireEvent.click(screen.getByTestId("change-keep-all"));

    expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBeCloseTo(1.04, 2);
    expect(accountLegs(onReturnChange)).toEqual([]);
    expect(screen.getByTestId("change-keep-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Account after Keep books the $1.04 to the account and keeps nothing", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    render(sheet({ onReturnChange, onKeptChange }));
    pay("33");

    fireEvent.click(screen.getByTestId("change-keep-all"));
    fireEvent.click(screen.getByTestId("change-destination-account"));

    expect(onKeptChange.mock.calls.at(-1)?.[0]).toBeNull();
    const legs = accountLegs(onReturnChange);
    expect(legs).toHaveLength(1);
    expect(legs[0].amount).toBeCloseTo(1.04, 2);
    expect(legs[0].direction).toBe("OUT");
  });

  it("no Keep button on a page that cannot book kept change", () => {
    render(sheet({ onReturnChange: jest.fn() }));
    pay("33");
    expect(screen.getByTestId("change-destination-account")).toBeTruthy();
    expect(screen.queryByTestId("change-keep-all")).toBeNull();
  });
});
