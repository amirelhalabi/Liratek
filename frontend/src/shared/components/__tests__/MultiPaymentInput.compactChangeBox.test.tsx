/** @jest-environment jsdom */
/**
 * MultiPaymentInput — compact change box (owner decisions 2026-10-13).
 *
 *  1. With `unreturnedChangeTo="CUSTOMER_ACCOUNT"` and a client, the
 *     "Account" button empties the CASH return fields and the whole change
 *     becomes ONE CUSTOMER_ACCOUNT OUT leg; a partial cash return splits
 *     into a CASH OUT leg + a CUSTOMER_ACCOUNT OUT leg for the rest.
 *  2. Without an account to credit but with `onKeptChange`, the same slot is
 *     a "Keep" button: it empties the fields and the change is kept.
 *  3. Customer Account is never offered as a "Hand back by" method.
 *  4. Payout mode says "Change kept" once (the green remaining row) — the
 *     separate "Keeping X as profit." note is gone.
 *  5. A wallet fee is folded into ONE "Grand Total … wallet fee" row; the
 *     separate "Wallet Surcharge" row is gone.
 *
 * Rule 17: written AFTER the production change — not proven failing-first.
 * The production code was not re-broken to prove these.
 */

import { render, fireEvent, screen } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const RATE = 90_000;

type Kept = {
  usd: number;
  lbp: number;
  exactUsd: number;
  exactLbp: number;
} | null;

const amountInput = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>('[data-testid^="payment-amount-"]')!;

const last = <T,>(m: jest.Mock<void, [T]>): T | undefined =>
  m.mock.calls.at(-1)?.[0];

const shape = (lines: PaymentLine[] | undefined) =>
  (lines ?? [])
    .filter((l) => l.amount > 0)
    .map((l) => ({
      method: l.method,
      currencyCode: l.currencyCode,
      amount: l.amount,
      direction: l.direction,
    }));

function posSale(o: {
  hasClient: boolean;
  onReturnChange: jest.Mock<void, [PaymentLine[]]>;
  onKeptChange?: jest.Mock<void, [Kept]>;
}) {
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
      exchangeRate={RATE}
      showDiscount={false}
      hasClient={o.hasClient}
      unreturnedChangeTo="CUSTOMER_ACCOUNT"
      onChange={jest.fn()}
      onReturnChange={o.onReturnChange}
      {...(o.onKeptChange ? { onKeptChange: o.onKeptChange } : {})}
    />
  );
}

describe("compact change box — Account button (client selected)", () => {
  it("$30 paid on $14: Account empties the fields → ONE CUSTOMER_ACCOUNT OUT leg of $16, no CASH leg", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(posSale({ hasClient: true, onReturnChange }));
    fireEvent.change(amountInput(), { target: { value: "30" } });

    // Starts handed back in full, as cash.
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 16, direction: "OUT" },
    ]);
    expect(screen.queryByTestId("change-keep-all")).toBeNull();

    fireEvent.click(screen.getByTestId("change-destination-account"));
    expect(screen.getByTestId<HTMLInputElement>("return-usd").value).toBe("");
    expect(screen.getByTestId<HTMLInputElement>("return-lbp").value).toBe("");
    expect(shape(last(onReturnChange))).toEqual([
      {
        method: "CUSTOMER_ACCOUNT",
        currencyCode: "USD",
        amount: 16,
        direction: "OUT",
      },
    ]);
    // Raw legs (no zero filter): exactly one leg, and no CASH leg of any size.
    const raw = last(onReturnChange) ?? [];
    expect(raw).toHaveLength(1);
    expect(raw.some((l) => l.method === "CASH")).toBe(false);
    expect(screen.getByTestId("change-to-account-summary").textContent).toMatch(
      /\$16\.00 not returned goes to the customer's account/,
    );
  });

  it("typing $10 handed back after Account → CASH OUT $10 + CUSTOMER_ACCOUNT OUT $6", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(posSale({ hasClient: true, onReturnChange }));
    fireEvent.change(amountInput(), { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("change-destination-account"));
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "10" },
    });
    const legs = shape(last(onReturnChange));
    expect(legs).toHaveLength(2);
    expect(legs).toEqual(
      expect.arrayContaining([
        { method: "CASH", currencyCode: "USD", amount: 10, direction: "OUT" },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 6,
          direction: "OUT",
        },
      ]),
    );
  });
});

describe("compact change box — Keep button (no account to credit)", () => {
  it("no client + onKeptChange: Keep is shown (not Account); it clears the fields and keeps $16", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    render(posSale({ hasClient: false, onReturnChange, onKeptChange }));
    fireEvent.change(amountInput(), { target: { value: "30" } });

    expect(screen.queryByTestId("change-destination-account")).toBeNull();
    const keep = screen.getByTestId("change-keep-all");
    expect(keep.textContent).toBe("Keep");
    expect(last(onKeptChange)).toBeNull();

    fireEvent.click(keep);
    expect(screen.getByTestId<HTMLInputElement>("return-usd").value).toBe("");
    expect(last(onKeptChange)).toMatchObject({ usd: 16, lbp: 0 });
    expect(last(onReturnChange) ?? []).toEqual([]);
    expect(screen.getByTestId("keep-change-summary").textContent).toMatch(
      /Keeping \$16\.00.*as profit/,
    );
  });

  it("no client and no onKeptChange: neither Account nor Keep is offered", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(posSale({ hasClient: false, onReturnChange }));
    fireEvent.change(amountInput(), { target: { value: "30" } });
    expect(screen.queryByTestId("change-destination-account")).toBeNull();
    expect(screen.queryByTestId("change-keep-all")).toBeNull();
  });
});

describe("compact change box — Customer Account is not a return method", () => {
  it("the 'Hand back by' list never contains CUSTOMER_ACCOUNT, even when paymentMethods offers it", () => {
    render(
      <MultiPaymentInput
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={[
          { code: "CASH", label: "Cash" },
          { code: "OMT", label: "OMT" },
          { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
        ]}
        currencies={CURRENCIES}
        exchangeRate={RATE}
        showDiscount={false}
        hasClient={true}
        onChange={jest.fn()}
      />,
    );
    fireEvent.change(amountInput(), { target: { value: "150" } });
    const select = screen.getByTestId<HTMLSelectElement>("return-method");
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["CASH", "OMT"]);
  });

  it("with only Cash + Customer Account there is no 'Hand back by' select at all", () => {
    render(
      <MultiPaymentInput
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={[
          { code: "CASH", label: "Cash" },
          { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
        ]}
        currencies={CURRENCIES}
        exchangeRate={RATE}
        showDiscount={false}
        hasClient={true}
        onChange={jest.fn()}
      />,
    );
    fireEvent.change(amountInput(), { target: { value: "150" } });
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
    expect(screen.queryByTestId("return-method")).toBeNull();
  });
});

describe("compact change box — payout keep is said once", () => {
  it("$101 paid out on $101.12: exactly one 'Change kept' and no keep-change-summary note", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    render(
      <MultiPaymentInput
        totals={[{ amount: 101.12, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={[{ code: "CASH", label: "Cash" }]}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        showDiscount={false}
        cashOnlyReturn={true}
        payer="payout"
        onChange={jest.fn()}
        onKeptChange={onKeptChange}
      />,
    );
    fireEvent.change(amountInput(), { target: { value: "101" } });
    expect(last(onKeptChange)).toMatchObject({ usd: 0.12 });
    expect(screen.getAllByText(/Change kept/)).toHaveLength(1);
    expect(screen.queryByTestId("keep-change-summary")).toBeNull();
    expect(screen.queryByText(/Keeping .*as profit/)).toBeNull();
  });
});

describe("compact change box — wallet fee in the Grand Total row", () => {
  it("one Grand Total row that names the wallet fee; no 'Wallet Surcharge' row", () => {
    render(
      <MultiPaymentInput
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={[
          { code: "CASH", label: "Cash" },
          { code: "WHISH", label: "Whish" },
        ]}
        currencies={CURRENCIES}
        exchangeRate={RATE}
        showDiscount={false}
        showPmFee={true}
        pmFeeRate={0.01}
        initialLines={[{ method: "WHISH", currencyCode: "USD", amount: 100 }]}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByText(/Wallet Surcharge/)).toBeNull();
    const grand = screen.getAllByText("Grand Total");
    expect(grand).toHaveLength(1);
    const row = grand[0].parentElement!;
    expect(row.textContent).toMatch(/wallet fee/);
    expect(row.textContent).toMatch(/101/);
    expect(row.textContent).toMatch(/incl\..*1\.00.*wallet fee/);
  });
});
