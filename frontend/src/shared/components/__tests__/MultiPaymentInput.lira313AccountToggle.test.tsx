/** @jest-environment jsdom */
/**
 * MultiPaymentInput — LIRA-313 (owner decisions 2026-10-12).
 *
 * "In any mode, the extra amount paid goes into the account", plus a
 * "return remaining" control: the change is either handed back or put on the
 * account, and "Return change" is the default.
 *
 * - `unreturnedChangeTo="ACCOUNT_BALANCE"` (Suppliers, Partners): change NOT
 *   handed back emits NO leg — the server books the net, so it stays on the
 *   counterparty's balance by itself. Only real cash change is an OUT leg.
 *   Works for the shop payer too, with no `hasClient`.
 * - "Return change" / "To account" toggle; the fields start full.
 * - `returnCurrencies` limits the cash return fields (a partner settlement's
 *   legs must all be in its currency).
 * - `payoutExcessToAccount` (Debts → Cash Out): paying out more than the
 *   total is not flagged as a problem; a note says it becomes debt.
 *
 * Rule 17: written after the fix — not proven failing-first. Not run yet
 * (owner asked for write-only on 2026-10-12).
 */

import { render, fireEvent, screen } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT" },
];
const BOTH = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const RATE = 90_000;

const amountInput = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>('[data-testid^="payment-amount-"]')!;

const last = <T,>(m: jest.Mock<void, [T]>): T | undefined =>
  m.mock.calls.at(-1)?.[0];

const shape = (lines: PaymentLine[] | undefined) =>
  (lines ?? []).map((l) => ({
    method: l.method,
    currencyCode: l.currencyCode,
    amount: l.amount,
    direction: l.direction,
  }));

describe("LIRA-313 — ACCOUNT_BALANCE (supplier / partner pages)", () => {
  function supplierPay(onReturnChange: jest.Mock<void, [PaymentLine[]]>) {
    return (
      <MultiPaymentInput
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={BOTH}
        exchangeRate={RATE}
        showDiscount={false}
        onChange={jest.fn()}
        onReturnChange={onReturnChange}
        unreturnedChangeTo="ACCOUNT_BALANCE"
        accountLabel="the supplier's account"
        cashOnlyReturn={true}
        payer="shop"
      />
    );
  }

  it("default is 'Return change': the full $50 is a cash OUT leg", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(supplierPay(onReturnChange));
    fireEvent.change(amountInput(), { target: { value: "150" } });
    expect(
      screen
        .getByTestId("change-destination-return")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 50, direction: "OUT" },
    ]);
  });

  it("'To account' emits NO leg at all and says the $50 stays on the supplier's account", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(supplierPay(onReturnChange));
    fireEvent.change(amountInput(), { target: { value: "150" } });
    fireEvent.click(screen.getByTestId("change-destination-account"));
    expect(shape(last(onReturnChange))).toEqual([]);
    expect(screen.getByTestId("change-to-account-summary").textContent).toMatch(
      /\$50\.00 not given back stays on the supplier's account/,
    );
    expect(screen.queryByTestId("return-mismatch-warning")).toBeNull();
    expect(screen.queryByTestId("keep-change-summary")).toBeNull();
  });

  it("a partial return: $20 cash back, the other $30 stays on the account with no leg", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(supplierPay(onReturnChange));
    fireEvent.change(amountInput(), { target: { value: "150" } });
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "20" },
    });
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 20, direction: "OUT" },
    ]);
    expect(screen.getByTestId("change-to-account-summary").textContent).toMatch(
      /\$30\.00/,
    );
  });

  it("'Return change' after 'To account' refills the full change", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(supplierPay(onReturnChange));
    fireEvent.change(amountInput(), { target: { value: "150" } });
    fireEvent.click(screen.getByTestId("change-destination-account"));
    fireEvent.click(screen.getByTestId("change-destination-return"));
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 50, direction: "OUT" },
    ]);
  });

  it("nothing owed in this direction (total 0): the whole payment is extra", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(
      <MultiPaymentInput
        totals={[{ amount: 0, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={BOTH}
        exchangeRate={RATE}
        showDiscount={false}
        onChange={jest.fn()}
        onReturnChange={onReturnChange}
        unreturnedChangeTo="ACCOUNT_BALANCE"
        accountLabel="the supplier's account"
        cashOnlyReturn={true}
        payer="shop"
      />,
    );
    fireEvent.change(amountInput(), { target: { value: "80" } });
    fireEvent.click(screen.getByTestId("change-destination-account"));
    expect(shape(last(onReturnChange))).toEqual([]);
    expect(screen.getByTestId("change-to-account-summary").textContent).toMatch(
      /\$80\.00/,
    );
  });
});

describe("LIRA-313 — returnCurrencies", () => {
  it("a USD-only settlement shows no LBP return field and returns the change in USD", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    render(
      <MultiPaymentInput
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={[{ code: "USD", symbol: "$" }]}
        exchangeRate={RATE}
        showDiscount={false}
        onChange={jest.fn()}
        onReturnChange={onReturnChange}
        unreturnedChangeTo="ACCOUNT_BALANCE"
        cashOnlyReturn={true}
        returnCurrencies={["USD"]}
        smartSplitOverpay={true}
      />,
    );
    fireEvent.change(amountInput(), { target: { value: "150.50" } });
    expect(screen.queryByTestId("return-lbp")).toBeNull();
    expect(screen.queryByTestId("return-all-lbp")).toBeNull();
    expect(shape(last(onReturnChange))).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 50.5, direction: "OUT" },
    ]);
  });
});

describe("LIRA-313 — payoutExcessToAccount (Debts → Cash Out)", () => {
  function cashOut(excess: boolean) {
    return (
      <MultiPaymentInput
        totals={[{ amount: 50, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={BOTH}
        exchangeRate={RATE}
        showDiscount={false}
        onChange={jest.fn()}
        payer="payout"
        payoutExcessToAccount={excess}
        accountLabel="the client's credit"
      />
    );
  }

  it("paying out $80 on $50 credit is not red and says $30 becomes debt", () => {
    render(cashOut(true));
    fireEvent.change(amountInput(), { target: { value: "80" } });
    expect(screen.getByTestId("payout-excess-summary").textContent).toMatch(
      /\$30\.00.* more than the client's credit/,
    );
  });

  it("without the prop an over-payout shows no debt note (unchanged)", () => {
    render(cashOut(false));
    fireEvent.change(amountInput(), { target: { value: "80" } });
    expect(screen.queryByTestId("payout-excess-summary")).toBeNull();
  });
});
