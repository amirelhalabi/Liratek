/** @jest-environment jsdom */
/**
 * MultiPaymentInput — the discount on a PAYOUT sheet (LIRA-269).
 *
 * On a payout (shop → customer) the discount is the shop giving up part of
 * its fee, so the customer receives MORE. The amount the customer receives
 * depends on the module's fee model, so the page computes it (one helper,
 * shared with the server — `walletReceiveAmounts` in @liratek/core) and
 * passes it as the total. The input therefore REPORTS the discount on a
 * payout but never subtracts it from the total itself; and with nobody
 * listening (`onDiscountChange` absent) it hides the field, since a discount
 * nobody books would only move the target.
 *
 * Customer-paid sheets are unchanged: the discount still lowers the total.
 */

import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

type Kept = { usd: number; lbp: number } | null;

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

function discountInput(): HTMLInputElement | null {
  const label = screen.queryByText("Discount");
  return label?.parentElement?.querySelector("input") ?? null;
}

function lineAmount(): number {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  return parseFloat(input.value.replace(/,/g, ""));
}

/** Mirrors a payout page: the total the page passes is base + discount. */
function PayoutHarness(props: {
  base: number;
  feedBack: boolean;
  onDiscount: jest.Mock<void, [number]>;
  onKept: jest.Mock<void, [Kept]>;
  onLines: jest.Mock<void, [PaymentLine[]]>;
}) {
  const [discount, setDiscount] = useState(0);
  const total = props.feedBack ? props.base + discount : props.base;
  return (
    <MultiPaymentInput
      totals={[{ amount: total, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={89_000}
      payer="payout"
      maxDiscount={2}
      onChange={props.onLines}
      onKeptChange={props.onKept}
      onDiscountChange={(d) => {
        props.onDiscount(d);
        setDiscount(d);
      }}
    />
  );
}

describe("MultiPaymentInput — discount on a payout sheet", () => {
  it("reports the discount but does not lower the payout target", () => {
    const onDiscount = jest.fn<void, [number]>();
    const onKept = jest.fn<void, [Kept]>();
    render(
      <PayoutHarness
        base={100}
        feedBack={false}
        onDiscount={onDiscount}
        onKept={onKept}
        onLines={jest.fn()}
      />,
    );
    expect(lineAmount()).toBe(100);
    fireEvent.change(discountInput()!, { target: { value: "0.5" } });
    expect(onDiscount).toHaveBeenLastCalledWith(0.5);
    // The line stays on the total the page passed — nothing short, nothing kept.
    expect(lineAmount()).toBe(100);
    expect(onKept).toHaveBeenLastCalledWith(null);
  });

  it("when the page raises the total by the discount, the untouched line follows and nothing is kept", () => {
    const onKept = jest.fn<void, [Kept]>();
    const onLines = jest.fn<void, [PaymentLine[]]>();
    render(
      <PayoutHarness
        base={100}
        feedBack={true}
        onDiscount={jest.fn()}
        onKept={onKept}
        onLines={onLines}
      />,
    );
    fireEvent.change(discountInput()!, { target: { value: "0.5" } });
    expect(lineAmount()).toBe(100.5);
    expect(onLines.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 100.5 }),
    ]);
    expect(onKept).toHaveBeenLastCalledWith(null);
  });

  it("hides the discount on a payout nobody books it for (no onDiscountChange)", () => {
    render(
      <MultiPaymentInput
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        payer="payout"
        onChange={jest.fn()}
      />,
    );
    expect(discountInput()).toBeNull();
  });

  it("customer-paid sheet: the discount still lowers the total (unchanged)", () => {
    render(
      <MultiPaymentInput
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        maxDiscount={10}
        onChange={jest.fn()}
        onDiscountChange={jest.fn()}
      />,
    );
    fireEvent.change(discountInput()!, { target: { value: "5" } });
    expect(lineAmount()).toBe(95);
  });
});
