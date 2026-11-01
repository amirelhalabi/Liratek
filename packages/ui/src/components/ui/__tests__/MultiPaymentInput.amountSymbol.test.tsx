/** @jest-environment jsdom */
/**
 * Owner 2026-11-01: the "$" inside a payment line's amount field shows only
 * when that line is in USD. LBP, EUR and every other currency show no sign
 * (the currency is already named next to it) — an EUR "Customer pays" line
 * used to read "$ 100".
 */
import { render } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import MultiPaymentInput from "../MultiPaymentInput";

const USD_LBP = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const METHODS = [{ code: "CASH", label: "Cash" }];

beforeAll(async () => {
  await loadLanguage("en");
  await i18n.changeLanguage("en");
});

/** The sign drawn inside a line's amount field, or null. */
function signOf(prefix: "payment" | "counter-flow"): string | null {
  const input = document.querySelector<HTMLInputElement>(
    `[data-testid^="${prefix}-amount-"]`,
  );
  const sign = input?.parentElement?.querySelector("span");
  return sign ? (sign.textContent ?? "").trim() : null;
}

describe("amount field sign", () => {
  it("USD payout line shows $, EUR Customer pays line shows no sign", () => {
    render(
      <MultiPaymentInput
        payer="payout"
        totals={[{ amount: 114, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={USD_LBP}
        showDiscount={false}
        onChange={() => {}}
        counterFlow={{
          label: "Customer pays",
          totalAmount: 100,
          currency: "EUR",
          lockCurrency: true,
          seedLines: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
          onChange: () => {},
        }}
      />,
    );
    expect(signOf("payment")).toBe("$");
    expect(signOf("counter-flow")).toBeNull();
  });

  it("an EUR payout line shows no sign, even with € in the currency list", () => {
    render(
      <MultiPaymentInput
        payer="payout"
        totals={[{ amount: 100, currency: "EUR" }]}
        currency="EUR"
        totalAmountCurrency="EUR"
        paymentMethods={METHODS}
        currencies={[{ code: "EUR", symbol: "€" }]}
        showDiscount={false}
        onChange={() => {}}
      />,
    );
    expect(signOf("payment")).toBeNull();
  });
});
