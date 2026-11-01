/** @jest-environment jsdom */
/**
 * Owner 2026-11-01: the "1 USD = … LBP" box shows only when the payment
 * window actually mixes USD and LBP — in what is owed or in any line, on
 * either side. A USD payout against a customer paying EUR never converts
 * USD↔LBP, so the box is noise there.
 */
import { render, fireEvent, screen } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import MultiPaymentInput from "../MultiPaymentInput";

const USD_LBP = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const METHODS = [{ code: "CASH", label: "Cash" }];
const RATE = "payment-exchange-rate";

beforeAll(async () => {
  await loadLanguage("en");
  await i18n.changeLanguage("en");
});

describe("USD ↔ LBP rate box visibility", () => {
  it("hidden: USD owed, USD line, customer pays in EUR", () => {
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
          currencies: [{ code: "EUR", symbol: "€" }],
          seedLines: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
          onChange: () => {},
        }}
      />,
    );
    expect(screen.queryByTestId(RATE)).toBeNull();
  });

  it("hidden: USD owed and paid in USD only", () => {
    render(
      <MultiPaymentInput
        totals={[{ amount: 50, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={USD_LBP}
        showDiscount={false}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId(RATE)).toBeNull();
  });

  it("shown once a line switches to LBP against a USD total", () => {
    render(
      <MultiPaymentInput
        totals={[{ amount: 50, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={USD_LBP}
        showDiscount={false}
        onChange={() => {}}
      />,
    );
    const cur = document.querySelector<HTMLSelectElement>(
      '[data-testid^="payment-currency-"]',
    ) as HTMLSelectElement;
    fireEvent.change(cur, { target: { value: "LBP" } });
    expect(screen.getByTestId(RATE)).toBeTruthy();
  });

  it("shown: LBP owed, customer pays in USD", () => {
    render(
      <MultiPaymentInput
        payer="payout"
        totals={[{ amount: 8_900_000, currency: "LBP" }]}
        currency="LBP"
        totalAmountCurrency="LBP"
        paymentMethods={METHODS}
        currencies={USD_LBP}
        showDiscount={false}
        onChange={() => {}}
        counterFlow={{
          label: "Customer pays",
          totalAmount: 100,
          currency: "USD",
          lockCurrency: true,
          seedLines: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
          onChange: () => {},
        }}
      />,
    );
    expect(screen.getByTestId(RATE)).toBeTruthy();
  });
});
