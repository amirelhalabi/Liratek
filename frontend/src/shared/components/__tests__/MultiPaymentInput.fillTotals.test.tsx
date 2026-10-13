/** @jest-environment jsdom */
/**
 * MultiPaymentInput — LIRA-308 (owner decisions 2026-10-11): the Debts
 * repayment sheet pre-fills the amount with the TICKED items' sum while
 * `totals` stays the whole debt, so an amount above the ticked sum is a
 * normal payment (it pays more items), not an overpay to hand back.
 *
 *  - `fillTotals`: what the amount fills to (defaults to `totals`);
 *  - `fillKey`: changing it resets the amount to `fillTotals` even after the
 *    cashier typed one (decision 2: a tick change always resets the amount),
 *    keeping the cashier's lines (owner answer 3 — the last line absorbs);
 *  - `defaultReturnMethod`: an amount above the whole debt goes to the
 *    customer's account by default (decision 6), through the existing
 *    CUSTOMER_ACCOUNT change leg.
 *
 * Consumers that pass none of these are unchanged (every other MPI test).
 *
 * 2026-10-13 (owner, compact change box): Customer Account is no longer a
 * return METHOD, so `defaultReturnMethod="CUSTOMER_ACCOUNT"` now falls back
 * to Cash (the guard below). Change goes to the account through
 * `unreturnedChangeTo="CUSTOMER_ACCOUNT"` + the change box's "Account"
 * button instead; the two account-credit cases were rewritten to that path
 * (not proven failing-first — rule 17).
 */

import { render, fireEvent, screen } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

type Money = { amount: number; currency: string };

function element(o: {
  totals: Money[];
  fillTotals?: Money[];
  fillKey?: number;
  onChange: jest.Mock<void, [PaymentLine[]]>;
  onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
  defaultReturnMethod?: string;
  unreturnedToAccount?: boolean;
}) {
  return (
    <MultiPaymentInput
      totals={o.totals}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={METHODS}
      currencies={CURRENCIES}
      exchangeRate={90_000}
      showDiscount={false}
      hasClient={true}
      onChange={o.onChange}
      onReturnChange={o.onReturnChange ?? jest.fn()}
      {...(o.fillTotals ? { fillTotals: o.fillTotals } : {})}
      {...(o.fillKey !== undefined ? { fillKey: o.fillKey } : {})}
      {...(o.defaultReturnMethod
        ? { defaultReturnMethod: o.defaultReturnMethod }
        : {})}
      {...(o.unreturnedToAccount
        ? { unreturnedChangeTo: "CUSTOMER_ACCOUNT" as const }
        : {})}
    />
  );
}

const amountInputs = (): HTMLInputElement[] =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    ),
  );

const lastLines = (m: jest.Mock<void, [PaymentLine[]]>): PaymentLine[] =>
  m.mock.calls.at(-1)?.[0] ?? [];

const usd = (amount: number): Money[] => [{ amount, currency: "USD" }];

describe("MultiPaymentInput — fillTotals / fillKey (LIRA-308)", () => {
  it("fills the amount to fillTotals, not to totals", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    render(
      element({ totals: usd(115), fillTotals: usd(50), fillKey: 1, onChange }),
    );
    expect(lastLines(onChange)).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 50 }),
    ]);
  });

  it("an amount above fillTotals but within totals is no overpay (no change block)", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    render(
      element({ totals: usd(115), fillTotals: usd(50), fillKey: 1, onChange }),
    );
    fireEvent.change(amountInputs()[0], { target: { value: "80" } });
    expect(lastLines(onChange)[0].amount).toBe(80);
    expect(screen.queryByTestId("change-due")).toBeNull();
  });

  it("a new fillKey resets a typed amount to the new fillTotals", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      element({ totals: usd(115), fillTotals: usd(50), fillKey: 1, onChange }),
    );
    fireEvent.change(amountInputs()[0], { target: { value: "80" } });
    rerender(
      element({ totals: usd(115), fillTotals: usd(30), fillKey: 2, onChange }),
    );
    expect(lastLines(onChange)).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 30 }),
    ]);
    // Same fill again with a new key still resets a typed amount.
    fireEvent.change(amountInputs()[0], { target: { value: "70" } });
    rerender(
      element({ totals: usd(115), fillTotals: usd(30), fillKey: 3, onChange }),
    );
    expect(lastLines(onChange)[0].amount).toBe(30);
  });

  it("the same fillKey keeps a typed amount", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      element({ totals: usd(115), fillTotals: usd(50), fillKey: 1, onChange }),
    );
    fireEvent.change(amountInputs()[0], { target: { value: "80" } });
    rerender(
      element({ totals: usd(115), fillTotals: usd(50), fillKey: 1, onChange }),
    );
    expect(lastLines(onChange)[0].amount).toBe(80);
  });

  // Owner answer 3 (2026-10-11) replaced "one line per currency": a tick
  // change keeps the cashier's lines and the last one absorbs the
  // difference — here the single USD line takes the LBP item at the rate.
  // (Line-keeping cases: MultiPaymentInput.lira308OwnerAnswers.test.tsx.)
  it("a mixed fill keeps the single line; it absorbs the LBP part at the rate (answer 3)", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      element({ totals: usd(115), fillTotals: usd(50), fillKey: 1, onChange }),
    );
    rerender(
      element({
        totals: [
          { amount: 115, currency: "USD" },
          { amount: 900_000, currency: "LBP" },
        ],
        fillTotals: [
          { amount: 14, currency: "USD" },
          { amount: 900_000, currency: "LBP" },
        ],
        fillKey: 2,
        onChange,
      }),
    );
    const lines = lastLines(onChange);
    expect(lines).toHaveLength(1);
    expect(lines).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 24 }),
    ]);
  });

  it("an empty fill (nothing ticked) sets the amount to 0", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      element({ totals: usd(115), fillTotals: usd(50), fillKey: 1, onChange }),
    );
    rerender(
      element({ totals: usd(115), fillTotals: [], fillKey: 2, onChange }),
    );
    expect(lastLines(onChange)[0].amount).toBe(0);
  });

  it("guard: defaultReturnMethod CUSTOMER_ACCOUNT is no longer a return method — the extra defaults to a CASH change leg", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(
      element({
        totals: usd(115),
        fillTotals: usd(115),
        fillKey: 1,
        onChange,
        onReturnChange,
        defaultReturnMethod: "CUSTOMER_ACCOUNT",
      }),
    );
    fireEvent.change(amountInputs()[0], { target: { value: "131" } });
    expect(lastLines(onReturnChange)).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "USD",
        amount: 16,
        direction: "OUT",
      }),
    ]);
    expect(
      lastLines(onReturnChange).some((l) => l.method === "CUSTOMER_ACCOUNT"),
    ).toBe(false);
  });

  it("above the whole debt with unreturnedChangeTo + Account: the extra is a CUSTOMER_ACCOUNT change leg", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(
      element({
        totals: usd(115),
        fillTotals: usd(115),
        fillKey: 1,
        onChange,
        onReturnChange,
        unreturnedToAccount: true,
      }),
    );
    fireEvent.change(amountInputs()[0], { target: { value: "131" } });
    fireEvent.click(screen.getByTestId("change-destination-account"));
    expect(lastLines(onReturnChange)).toEqual([
      expect.objectContaining({
        method: "CUSTOMER_ACCOUNT",
        currencyCode: "USD",
        amount: 16,
        direction: "OUT",
      }),
    ]);
  });

  it("returnCurrencyFollowsTender: an LBP overpay goes to the account in LBP", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(
      <MultiPaymentInput
        totals={[{ amount: 600_000, currency: "LBP" }]}
        initialLines={[{ currencyCode: "LBP", amount: 600_000 }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        showDiscount={false}
        hasClient={true}
        unreturnedChangeTo="CUSTOMER_ACCOUNT"
        returnCurrencyFollowsTender={true}
        onChange={onChange}
        onReturnChange={onReturnChange}
      />,
    );
    fireEvent.change(amountInputs()[0], { target: { value: "700000" } });
    fireEvent.click(screen.getByTestId("change-destination-account"));
    expect(lastLines(onReturnChange)).toEqual([
      expect.objectContaining({
        method: "CUSTOMER_ACCOUNT",
        currencyCode: "LBP",
        amount: 100_000,
        direction: "OUT",
      }),
    ]);
  });
});
