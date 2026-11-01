import type { CurrencyExchangeResult } from "@liratek/core";
import { exchangeUnitUsd, isUsdOrLbp } from "../exchangeUnitUsd";

type Leg = CurrencyExchangeResult["legs"][number];

function result(legs: Array<Partial<Leg>>): CurrencyExchangeResult {
  const full = legs.map(
    (l) =>
      ({
        rate: 1,
        marketRate: 1,
        profitUsd: 0,
        ...l,
      }) as Leg,
  );
  return {
    fromCurrency: full[0]!.fromCurrency,
    toCurrency: full[full.length - 1]!.toCurrency,
    amountIn: full[0]!.amountIn,
    totalAmountOut: full[full.length - 1]!.amountOut,
    totalProfitUsd: 0,
    viaCurrency: full.length === 2 ? "USD" : null,
    legs: full,
  } as CurrencyExchangeResult;
}

describe("exchangeUnitUsd (LIRA-369 R5)", () => {
  it("direct USD → EUR: $110 for 100 EUR seeds 1 EUR = 1.10 USD", () => {
    const r = result([
      { fromCurrency: "USD", toCurrency: "EUR", amountIn: 110, amountOut: 100 },
    ]);
    expect(exchangeUnitUsd(r, "EUR")).toBeCloseTo(1.1, 10);
  });

  it("direct EUR → USD: 100 EUR for $110 seeds 1.10", () => {
    const r = result([
      { fromCurrency: "EUR", toCurrency: "USD", amountIn: 100, amountOut: 110 },
    ]);
    expect(exchangeUnitUsd(r, "EUR")).toBeCloseTo(1.1, 10);
  });

  it("divides by the rounded quantity the page sends, so qty × rate = the USD paid", () => {
    const r = result([
      {
        fromCurrency: "USD",
        toCurrency: "EUR",
        amountIn: 100,
        amountOut: 100 / 1.16,
      },
    ]);
    const rate = exchangeUnitUsd(r, "EUR", { amountIn: 100, amountOut: 86.21 });
    expect(rate).toBeCloseTo(100 / 86.21, 12);
    expect(86.21 * rate!).toBeCloseTo(100, 10);
  });

  it("cross GBP → EUR: each side's own USD notional ÷ its quantity", () => {
    const r = result([
      { fromCurrency: "GBP", toCurrency: "USD", amountIn: 50, amountOut: 63.5 },
      { fromCurrency: "USD", toCurrency: "EUR", amountIn: 63.5, amountOut: 55 },
    ]);
    expect(exchangeUnitUsd(r, "GBP")).toBeCloseTo(1.27, 10);
    expect(exchangeUnitUsd(r, "EUR")).toBeCloseTo(63.5 / 55, 10);
  });

  it("USD is 1; a currency not on either side gives null", () => {
    const r = result([
      { fromCurrency: "USD", toCurrency: "EUR", amountIn: 110, amountOut: 100 },
    ]);
    expect(exchangeUnitUsd(r, "USD")).toBe(1);
    expect(exchangeUnitUsd(r, "GBP")).toBeNull();
  });

  it("a zero quantity gives null, never Infinity", () => {
    const r = result([
      { fromCurrency: "USD", toCurrency: "EUR", amountIn: 110, amountOut: 0 },
    ]);
    expect(exchangeUnitUsd(r, "EUR")).toBeNull();
  });

  it("isUsdOrLbp", () => {
    expect(isUsdOrLbp("USD")).toBe(true);
    expect(isUsdOrLbp("LBP")).toBe(true);
    expect(isUsdOrLbp("EUR")).toBe(false);
  });
});
