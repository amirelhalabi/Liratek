/** @jest-environment jsdom */
/**
 * MultiPaymentInput — switching `payer` (or the `direction` alias) WITHOUT a
 * remount must not leak the previous mode's kept change.
 *
 * Before the fix, each kept-change effect only re-fired when its own key
 * changed. Both keys sit at "off" while their mode is inactive, so after a
 * switch the newly active effect never ran and the parent kept the OLD
 * mode's kept figure (a customer-mode profit carried into a payout, or a
 * payout shortfall carried into a customer sale). Consumers worked around it
 * with mode tags (Recharge); the component now resets on its own: the
 * change-return fields are re-seeded to the full change due and the active
 * mode re-reports (null when nothing is kept).
 */

import { render, fireEvent, screen } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

type Kept = {
  usd: number;
  lbp: number;
  exactUsd: number;
  exactLbp: number;
} | null;
type Payer = "customer" | "payout" | "shop";

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

function element(opts: {
  total: number;
  payer?: Payer;
  direction?: "payment" | "payout";
  onKeptChange: jest.Mock<void, [Kept]>;
  onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
}) {
  return (
    <MultiPaymentInput
      totals={[{ amount: opts.total, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={90_000}
      showDiscount={false}
      cashOnlyReturn={true}
      onChange={jest.fn()}
      onReturnChange={opts.onReturnChange ?? jest.fn()}
      onKeptChange={opts.onKeptChange}
      {...(opts.payer ? { payer: opts.payer } : {})}
      {...(opts.direction ? { direction: opts.direction } : {})}
    />
  );
}

function pay(value: string): void {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value } });
}

const lastKept = (m: jest.Mock<void, [Kept]>): Kept =>
  m.mock.calls.at(-1)?.[0] ?? null;

describe("MultiPaymentInput — payer switch without remount resets kept change", () => {
  it("customer → payout: the customer-mode kept profit is withdrawn (null)", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      element({ total: 7, payer: "customer", onKeptChange, onReturnChange }),
    );
    pay("10");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "2" },
    });
    expect(lastKept(onKeptChange)).toMatchObject({ usd: 1, lbp: 0 });

    rerender(
      element({ total: 7, payer: "payout", onKeptChange, onReturnChange }),
    );
    // $10 handed out against $7 owed: no shortfall → nothing kept.
    expect(lastKept(onKeptChange)).toBeNull();
    // Regression guard (not failing-first): the re-seed must not make a
    // payout emit change (OUT) legs — the server refuses those.
    expect(
      (onReturnChange.mock.calls.at(-1)?.[0] ?? []).filter(
        (l) => l.direction === "OUT",
      ),
    ).toEqual([]);
  });

  it("payout → customer: the payout shortfall kept is withdrawn (null)", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const { rerender } = render(
      element({ total: 10, payer: "payout", onKeptChange }),
    );
    pay("9.5");
    expect(lastKept(onKeptChange)).toMatchObject({ usd: 0.5, lbp: 0 });

    rerender(element({ total: 10, payer: "customer", onKeptChange }));
    // $9.50 against $10 due is an underpay — there is no change to keep.
    expect(lastKept(onKeptChange)).toBeNull();
  });

  it('direction alias "payout" → "payment" behaves the same', () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const { rerender } = render(
      element({ total: 10, direction: "payout", onKeptChange }),
    );
    pay("9.5");
    expect(lastKept(onKeptChange)).toMatchObject({ usd: 0.5 });

    rerender(element({ total: 10, direction: "payment", onKeptChange }));
    expect(lastKept(onKeptChange)).toBeNull();
  });

  it("customer → shop: an under-return typed as profit is not carried over as cost — the return is re-seeded to the full change", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      element({ total: 7, payer: "customer", onKeptChange, onReturnChange }),
    );
    pay("10");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "2" },
    });
    expect(lastKept(onKeptChange)).toMatchObject({ usd: 1 });

    rerender(
      element({ total: 7, payer: "shop", onKeptChange, onReturnChange }),
    );
    expect(lastKept(onKeptChange)).toBeNull();
    expect(onReturnChange.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 3, direction: "OUT" }),
    ]);
  });

  it("re-rendering with the SAME payer keeps the typed under-return (no spurious reset)", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const { rerender } = render(
      element({ total: 7, payer: "customer", onKeptChange }),
    );
    pay("10");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "2" },
    });
    rerender(element({ total: 7, payer: "customer", onKeptChange }));
    expect(lastKept(onKeptChange)).toMatchObject({ usd: 1 });
  });
});
