/** @jest-environment jsdom */
/**
 * MultiPaymentInput — Keep / Account never silently swap (LIRA-318 review,
 * owner 2026-10-13).
 *
 * With no client, "Keep" empties the change fields (the change is kept as
 * profit). If a client is then picked, the same empty fields would mean
 * "put the whole change on the account" — a different booking the cashier
 * never chose. The reverse (Account, then the client removed) would turn a
 * credit into kept profit. When the account option appears or disappears,
 * the change goes back to "hand it all back" so the cashier chooses again.
 *
 * Rule 17: written before the fix and run against the unfixed code first.
 */

import { render, fireEvent, screen } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

const amountInput = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>('[data-testid^="payment-amount-"]')!;

const shape = (lines: PaymentLine[] | undefined) =>
  (lines ?? [])
    .filter((l) => l.amount > 0)
    .map((l) => ({ method: l.method, amount: l.amount }));

function box(hasClient: boolean, onReturnChange: jest.Mock, onKeptChange: jest.Mock) {
  return (
    <MultiPaymentInput
      totals={[{ amount: 14, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={[
        { code: "CASH", label: "Cash" },
        { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
      ]}
      currencies={CURRENCIES}
      exchangeRate={90_000}
      showDiscount={false}
      hasClient={hasClient}
      unreturnedChangeTo="CUSTOMER_ACCOUNT"
      onChange={jest.fn()}
      onReturnChange={onReturnChange}
      onKeptChange={onKeptChange}
    />
  );
}

it("Keep with no client, then a client is picked → change goes back to 'hand it all back', not to the account", () => {
  const onReturn = jest.fn();
  const onKept = jest.fn();
  const { rerender } = render(box(false, onReturn, onKept));
  fireEvent.change(amountInput(), { target: { value: "30" } });
  fireEvent.click(screen.getByTestId("change-keep-all"));
  rerender(box(true, onReturn, onKept));
  expect(shape(onReturn.mock.calls.at(-1)?.[0])).toEqual([
    { method: "CASH", amount: 16 },
  ]);
  expect(
    screen.getByTestId("change-destination-account").getAttribute("aria-pressed"),
  ).toBe("false");
});

it("Account with a client, then the client is removed → change goes back to 'hand it all back', nothing kept", () => {
  const onReturn = jest.fn();
  const onKept = jest.fn();
  const { rerender } = render(box(true, onReturn, onKept));
  fireEvent.change(amountInput(), { target: { value: "30" } });
  fireEvent.click(screen.getByTestId("change-destination-account"));
  rerender(box(false, onReturn, onKept));
  expect(shape(onReturn.mock.calls.at(-1)?.[0])).toEqual([
    { method: "CASH", amount: 16 },
  ]);
  expect(onKept.mock.calls.at(-1)?.[0] ?? null).toBeNull();
});
