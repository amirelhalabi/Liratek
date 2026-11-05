/** @jest-environment jsdom */
/**
 * LIRA-372 (T035) — a two-currency settle box (`perCurrencyTotals`, one
 * seeded line per currency) follows the discount per currency. Owner answer
 * 2026-11-05 (option B): "the discount always wins" — when the page's
 * `fillKey` changes (it carries the discount), each currency whose
 * `fillTotals` changed re-fills its LAST line, even one the cashier typed by
 * hand. A currency whose total did not change keeps its lines.
 */
import { render, fireEvent } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

type Money = { amount: number; currency: string };

const SEED = [
  { method: "CASH", currencyCode: "USD", amount: 412.5 },
  { method: "CASH", currencyCode: "LBP", amount: 900_000 },
];

function box(
  fillTotals: Money[],
  fillKey: string,
  onChange: jest.Mock<void, [PaymentLine[]]>,
) {
  return (
    <MultiPaymentInput
      totals={fillTotals}
      perCurrencyTotals={true}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={METHODS}
      currencies={CURRENCIES}
      exchangeRate={90_000}
      showDiscount={false}
      hasClient={false}
      payer="shop"
      onChange={onChange}
      initialLines={SEED}
      fillTotals={fillTotals}
      fillKey={fillKey}
    />
  );
}

const amounts = (lines: PaymentLine[] | undefined) =>
  (lines ?? []).map((l) => [l.currencyCode, l.amount]);
const last = (m: jest.Mock<void, [PaymentLine[]]>) => m.mock.calls.at(-1)?.[0];

const GROSS: Money[] = [
  { amount: 412.5, currency: "USD" },
  { amount: 900_000, currency: "LBP" },
];
const NET_USD: Money[] = [
  { amount: 410, currency: "USD" },
  { amount: 900_000, currency: "LBP" },
];

describe("MultiPaymentInput — per-currency follow of the discount (LIRA-372)", () => {
  it("USD discount 2.50: the USD line reads 410.00, the LBP line stays", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender } = render(box(GROSS, "d:0", onChange));
    rerender(box(NET_USD, "d:2.5", onChange));
    expect(amounts(last(onChange))).toEqual([
      ["USD", 410],
      ["LBP", 900_000],
    ]);
  });

  it("a USD line typed by hand is lowered too (option B); a typed LBP line stays", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const { rerender, container } = render(box(GROSS, "d:0", onChange));
    const inputs = container.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    fireEvent.change(inputs[0], { target: { value: "412.5" } });
    fireEvent.change(inputs[1], { target: { value: "800000" } });
    rerender(box(NET_USD, "d:2.5", onChange));
    expect(amounts(last(onChange))).toEqual([
      ["USD", 410],
      ["LBP", 800_000],
    ]);
  });
});
