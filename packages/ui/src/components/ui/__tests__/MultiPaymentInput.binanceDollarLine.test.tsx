/** @jest-environment jsdom */
/**
 * Cornertech 2026-11-06: a Binance payment line is paid in dollars and the
 * server books it into the Binance drawer as USDT (1 USDT = $1); LBP is
 * refused there. So a Binance line's currency is locked to USD, and picking
 * Binance on an LBP line switches it to USD.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import MultiPaymentInput from "../MultiPaymentInput";

const USD_LBP = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "BINANCE", label: "Binance" },
];

beforeAll(async () => {
  await loadLanguage("en");
  await i18n.changeLanguage("en");
});

function currencyField(): HTMLInputElement | HTMLSelectElement {
  return document.querySelector<HTMLInputElement | HTMLSelectElement>(
    '[data-testid^="payment-currency-"]',
  )!;
}

describe("Binance payment line", () => {
  it("picking Binance on an LBP line locks it to USD with the USDT hint", () => {
    const onChange = jest.fn();
    render(
      <MultiPaymentInput
        totals={[{ amount: 27_000_000, currency: "LBP" }]}
        currency="LBP"
        totalAmountCurrency="LBP"
        paymentMethods={METHODS}
        currencies={USD_LBP}
        showDiscount={false}
        onChange={onChange}
      />,
    );
    expect(currencyField().tagName).toBe("SELECT");

    const method = document.querySelector<HTMLSelectElement>(
      '[data-testid^="payment-method-"]',
    )!;
    fireEvent.change(method, { target: { value: "BINANCE" } });

    const field = currencyField();
    expect(field.tagName).toBe("INPUT");
    expect(field.value).toBe("USD");
    expect(
      screen.getByTitle("Binance takes dollars — booked into Binance as USDT"),
    ).toBeTruthy();
    const lastLines = onChange.mock.calls.at(-1)?.[0] as Array<{
      method: string;
      currencyCode: string;
    }>;
    expect(lastLines.map((l) => [l.method, l.currencyCode])).toEqual([
      ["BINANCE", "USD"],
    ]);
  });

  it("on a sheet that offers USDT (Binance cash-out), picking Binance switches the line to USDT", () => {
    const onChange = jest.fn();
    render(
      <MultiPaymentInput
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={[...USD_LBP, { code: "USDT", symbol: "USDT" }]}
        showDiscount={false}
        onChange={onChange}
      />,
    );
    const method = document.querySelector<HTMLSelectElement>(
      '[data-testid^="payment-method-"]',
    )!;
    fireEvent.change(method, { target: { value: "BINANCE" } });

    expect(currencyField().value).toBe("USDT");
    const lastLines = onChange.mock.calls.at(-1)?.[0] as Array<{
      method: string;
      currencyCode: string;
    }>;
    expect(lastLines.map((l) => [l.method, l.currencyCode])).toEqual([
      ["BINANCE", "USDT"],
    ]);
  });
});
