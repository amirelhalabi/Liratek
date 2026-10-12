/** @jest-environment jsdom */
/**
 * MultiPaymentInput — LIRA-308 owner answers (2026-10-11, binding).
 *
 * Answer 3 — a tick change (new `fillKey`) KEEPS the cashier's payment
 * lines: only the total changes, and the LAST line absorbs the difference.
 * A last line that would drop to zero or below is removed and the line
 * before it absorbs the rest (never below zero); with no line left, one
 * default line is created. Replaces the LIRA-308 first cut, which rebuilt
 * one line per currency and so lost a second method (Cash $50 + Whish $34).
 *
 * Answer 1 — "if the customer pays 85, and we didn't set $1 in the returned
 * amount, then $1 is account credit": with `unreturnedChangeTo=
 * "CUSTOMER_ACCOUNT"` what the cashier types in the return fields is handed
 * back (as cash), and whatever is NOT entered becomes a CUSTOMER_ACCOUNT
 * change leg (the existing path the server books as account credit).
 * Nothing is kept as profit.
 *
 * LIRA-313 (owner decisions 2026-10-12) changed ONE thing here: the return
 * fields now start FULL ("Return change" is the default) instead of empty,
 * and a "To account" button empties them so the whole change is credited.
 * Rule 24 — the cases below that relied on the empty start now press "To
 * account" first; the account-credit behaviour itself is unchanged.
 *
 * Both are opt-in props; other forms are unaffected.
 */

import { render, fireEvent, screen } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "WHISH", label: "Whish" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const RATE = 90_000;

type Money = { amount: number; currency: string };
type Lines = Array<{ method?: string; currencyCode: string; amount: number }>;

function sheet(o: {
  totals: Money[];
  fillTotals: Money[];
  fillKey: number;
  initialLines?: Lines;
  onChange: jest.Mock<void, [PaymentLine[]]>;
  onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
  onKeptChange?: jest.Mock;
  unreturned?: boolean;
}) {
  return (
    <MultiPaymentInput
      totals={o.totals}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={METHODS}
      currencies={CURRENCIES}
      exchangeRate={RATE}
      showDiscount={false}
      hasClient={true}
      onChange={o.onChange}
      onReturnChange={o.onReturnChange ?? jest.fn()}
      fillTotals={o.fillTotals}
      fillKey={o.fillKey}
      returnCurrencyFollowsTender={true}
      {...(o.initialLines ? { initialLines: o.initialLines } : {})}
      {...(o.onKeptChange ? { onKeptChange: o.onKeptChange } : {})}
      {...(o.unreturned ? { unreturnedChangeTo: "CUSTOMER_ACCOUNT" } : {})}
    />
  );
}

const amountInputs = (): HTMLInputElement[] =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    ),
  );

const last = <T,>(m: jest.Mock<void, [T]>): T | undefined =>
  m.mock.calls.at(-1)?.[0];

const usd = (amount: number): Money[] => [{ amount, currency: "USD" }];
const shape = (lines: PaymentLine[] | undefined) =>
  (lines ?? []).map((l) => ({
    method: l.method,
    currencyCode: l.currencyCode,
    amount: l.amount,
  }));

describe("answer 3 — a tick change keeps the payment lines; the last one absorbs the difference", () => {
  const SPLIT: Lines = [
    { method: "CASH", currencyCode: "USD", amount: 50 },
    { method: "WHISH", currencyCode: "USD", amount: 34 },
  ];

  it("Cash $50 + Whish $34, ticked sum 84 → 100: Whish becomes $50, Cash stays $50", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      sheet({
        totals: usd(150),
        fillTotals: usd(84),
        fillKey: 1,
        initialLines: SPLIT,
        onChange,
      }),
    );
    rerender(
      sheet({
        totals: usd(150),
        fillTotals: usd(100),
        fillKey: 2,
        initialLines: SPLIT,
        onChange,
      }),
    );
    expect(shape(last(onChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 50 },
      { method: "WHISH", currencyCode: "USD", amount: 50 },
    ]);
  });

  it("ticked sum 84 → 60: Whish shrinks to $10", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      sheet({
        totals: usd(150),
        fillTotals: usd(84),
        fillKey: 1,
        initialLines: SPLIT,
        onChange,
      }),
    );
    rerender(
      sheet({
        totals: usd(150),
        fillTotals: usd(60),
        fillKey: 2,
        initialLines: SPLIT,
        onChange,
      }),
    );
    expect(shape(last(onChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 50 },
      { method: "WHISH", currencyCode: "USD", amount: 10 },
    ]);
  });

  it("ticked sum 84 → 40: the Whish line goes, Cash shrinks to $40 (never below zero)", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      sheet({
        totals: usd(150),
        fillTotals: usd(84),
        fillKey: 1,
        initialLines: SPLIT,
        onChange,
      }),
    );
    rerender(
      sheet({
        totals: usd(150),
        fillTotals: usd(40),
        fillKey: 2,
        initialLines: SPLIT,
        onChange,
      }),
    );
    expect(shape(last(onChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 40 },
    ]);
  });

  it("nothing ticked (fill 0): one line of 0 is left, keeping the first line's method", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      sheet({
        totals: usd(150),
        fillTotals: usd(84),
        fillKey: 1,
        initialLines: SPLIT,
        onChange,
      }),
    );
    rerender(
      sheet({
        totals: usd(150),
        fillTotals: [],
        fillKey: 2,
        initialLines: SPLIT,
        onChange,
      }),
    );
    expect(shape(last(onChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 0 },
    ]);
  });

  it("a typed amount on the last line is reset by the tick change (decision 2), the other line kept", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(
      sheet({
        totals: usd(150),
        fillTotals: usd(84),
        fillKey: 1,
        initialLines: SPLIT,
        onChange,
      }),
    );
    fireEvent.change(amountInputs()[1], { target: { value: "70" } });
    rerender(
      sheet({
        totals: usd(150),
        fillTotals: usd(90),
        fillKey: 2,
        initialLines: SPLIT,
        onChange,
      }),
    );
    expect(shape(last(onChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 50 },
      { method: "WHISH", currencyCode: "USD", amount: 40 },
    ]);
  });
});

describe("answer 1 — change the cashier does not enter as returned is account credit", () => {
  it('$84 due, $85 paid: the $1 starts as change to return; "To account" makes it a $1 CUSTOMER_ACCOUNT change leg', () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(
      sheet({
        totals: usd(84),
        fillTotals: usd(84),
        fillKey: 1,
        onChange,
        onReturnChange,
        unreturned: true,
      }),
    );
    fireEvent.change(amountInputs()[0], { target: { value: "85" } });
    // LIRA-313 — default "Return change": the field starts with the full $1.
    expect((screen.getByTestId("return-usd") as HTMLInputElement).value).toBe(
      "1.00",
    );
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 1 },
    ]);
    fireEvent.click(screen.getByTestId("change-destination-account"));
    expect(screen.queryByTestId("return-usd")).toBeNull();
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 1 },
    ]);
    expect(screen.getByTestId("change-to-account-summary").textContent).toMatch(
      /\$1(\.00)? .*account/i,
    );
  });

  it("$10 over, $4 typed as returned → $4 cash back and $6 account credit; nothing kept as profit", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn();
    render(
      sheet({
        totals: usd(84),
        fillTotals: usd(84),
        fillKey: 1,
        onChange,
        onReturnChange,
        onKeptChange,
        unreturned: true,
      }),
    );
    fireEvent.change(amountInputs()[0], { target: { value: "94" } });
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "4" },
    });
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 4 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 6 },
    ]);
    expect(screen.queryByTestId("keep-change-summary")).toBeNull();
    expect(screen.queryByTestId("return-mismatch-warning")).toBeNull();
    for (const [kept] of onKeptChange.mock.calls) expect(kept).toBeNull();
  });

  it("the whole change typed as returned → cash only, no credit", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(
      sheet({
        totals: usd(84),
        fillTotals: usd(84),
        fillKey: 1,
        onChange,
        onReturnChange,
        unreturned: true,
      }),
    );
    fireEvent.change(amountInputs()[0], { target: { value: "94" } });
    fireEvent.click(screen.getByTestId("return-all-usd"));
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 10 },
    ]);
  });

  it("a small rounding overpay ($10 due paid with 910,000 LBP) is LBP account credit", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(
      sheet({
        totals: usd(10),
        fillTotals: usd(10),
        fillKey: 1,
        initialLines: [
          { method: "CASH", currencyCode: "LBP", amount: 910_000 },
        ],
        onChange,
        onReturnChange,
        unreturned: true,
      }),
    );
    fireEvent.change(amountInputs()[0], { target: { value: "910000" } });
    // LIRA-313 — the change starts as cash to return; "To account" credits it.
    fireEvent.click(screen.getByTestId("change-destination-account"));
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 10_000 },
    ]);
  });
});
