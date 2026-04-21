/**
 * Unit tests for currencyConverter.ts
 *
 * Tests the universal formula, conversions, profit calculations,
 * and the master calculateExchange() for all currency pairs.
 */

import {
  computeRate,
  convertToUSD,
  convertFromUSD,
  computeLegProfitUsd,
  calculateExchange,
  getDisplayRate,
  findCurrencyRate,
  GIVE_USD,
  TAKE_USD,
} from "../currencyConverter.js";
import type { CurrencyRate } from "../currencyConverter.js";

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const mockRates: CurrencyRate[] = [
  {
    to_code: "LBP",
    market_rate: 89500,
    buy_rate: 89000,
    sell_rate: 90000,
    is_stronger: 1,
  },
  {
    to_code: "EUR",
    market_rate: 1.18,
    buy_rate: 1.16,
    sell_rate: 1.2,
    is_stronger: -1,
  },
];

const lbp = mockRates[0];
const eur = mockRates[1];

// ─── computeRate ───────────────────────────────────────────────────────────────

describe("computeRate", () => {
  it("USD→LBP (TAKE_USD): 89500 + 1×(-1×500) = 89,000", () => {
    expect(computeRate(lbp, TAKE_USD)).toBe(89000);
  });

  it("LBP→USD (GIVE_USD): 89500 + 1×(+1×500) = 90,000", () => {
    expect(computeRate(lbp, GIVE_USD)).toBe(90000);
  });

  it("EUR→USD (GIVE_USD): 1.18 + (-1)×(+1×0.02) = 1.16", () => {
    expect(computeRate(eur, GIVE_USD)).toBeCloseTo(1.16, 10);
  });

  it("USD→EUR (TAKE_USD): 1.18 + (-1)×(-1×0.02) = 1.20", () => {
    expect(computeRate(eur, TAKE_USD)).toBeCloseTo(1.2, 10);
  });
});

// ─── convertToUSD ─────────────────────────────────────────────────────────────

describe("convertToUSD", () => {
  it("LBP→USD: 90,000 LBP ÷ 90,000 = 1 USD", () => {
    const { amountUSD, rate } = convertToUSD(90000, lbp, GIVE_USD);
    expect(rate).toBe(90000);
    expect(amountUSD).toBeCloseTo(1, 8);
  });

  it("EUR→USD: 10 EUR × 1.16 = 11.6 USD", () => {
    const { amountUSD, rate } = convertToUSD(10, eur, GIVE_USD);
    expect(rate).toBeCloseTo(1.16, 10);
    expect(amountUSD).toBeCloseTo(11.6, 6);
  });
});

// ─── convertFromUSD ───────────────────────────────────────────────────────────

describe("convertFromUSD", () => {
  it("USD→LBP: 1 USD × 89,000 = 89,000 LBP", () => {
    const { amountOut, rate } = convertFromUSD(1, lbp, TAKE_USD);
    expect(rate).toBe(89000);
    expect(amountOut).toBe(89000);
  });

  it("USD→EUR: 1.20 USD ÷ 1.20 = 1 EUR", () => {
    const { amountOut, rate } = convertFromUSD(1.2, eur, TAKE_USD);
    expect(rate).toBeCloseTo(1.2, 10);
    expect(amountOut).toBeCloseTo(1, 8);
  });
});

// ─── computeLegProfitUsd ──────────────────────────────────────────────────────

describe("computeLegProfitUsd", () => {
  it("LBP leg: profit = amountIn/market × halfSpread", () => {
    // 10 USD worth of LBP at market rate 89500, halfSpread = (90000-89000)/2 = 500
    const profit = computeLegProfitUsd(10, lbp);
    expect(profit).toBeCloseTo((10 * 500) / 89500, 8);
  });

  it("EUR leg: profit = amountIn × halfSpread", () => {
    // 10 EUR, halfSpread = (1.20-1.16)/2 = 0.02
    const profit = computeLegProfitUsd(10, eur);
    expect(profit).toBeCloseTo(10 * 0.02, 8);
  });

  it("profit is always positive for valid rates", () => {
    expect(computeLegProfitUsd(100, lbp)).toBeGreaterThan(0);
    expect(computeLegProfitUsd(100, eur)).toBeGreaterThan(0);
  });
});

// ─── calculateExchange — direct pairs ─────────────────────────────────────────

describe("calculateExchange — direct USD pairs", () => {
  it("USD→LBP: 1 leg, correct amount, no via_currency", () => {
    const r = calculateExchange("USD", "LBP", 10, mockRates);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].fromCurrency).toBe("USD");
    expect(r.legs[0].toCurrency).toBe("LBP");
    expect(r.totalAmountOut).toBe(890000); // 10 × 89,000
    expect(r.viaCurrency).toBeNull();
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });

  it("LBP→USD: 1 leg, correct amount", () => {
    const r = calculateExchange("LBP", "USD", 90000, mockRates);
    expect(r.legs).toHaveLength(1);
    expect(r.totalAmountOut).toBeCloseTo(1, 6); // 90,000 ÷ 90,000 = 1 USD
    expect(r.viaCurrency).toBeNull();
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });

  it("EUR→USD: 1 leg, correct amount", () => {
    const r = calculateExchange("EUR", "USD", 10, mockRates);
    expect(r.legs).toHaveLength(1);
    expect(r.totalAmountOut).toBeCloseTo(11.6, 4); // 10 × 1.16
    expect(r.viaCurrency).toBeNull();
    expect(r.totalProfitUsd).toBeCloseTo(0.2, 6); // 10 × 0.02
  });

  it("USD→EUR: 1 leg, correct amount", () => {
    const r = calculateExchange("USD", "EUR", 12, mockRates);
    expect(r.legs).toHaveLength(1);
    expect(r.totalAmountOut).toBeCloseTo(10, 4); // 12 ÷ 1.20 = 10 EUR
    expect(r.viaCurrency).toBeNull();
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });
});

// ─── calculateExchange — cross-currency ───────────────────────────────────────

describe("calculateExchange — cross-currency", () => {
  it("EUR→LBP: 2 legs, via USD, correct currencies", () => {
    const r = calculateExchange("EUR", "LBP", 10, mockRates);
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0].fromCurrency).toBe("EUR");
    expect(r.legs[0].toCurrency).toBe("USD");
    expect(r.legs[1].fromCurrency).toBe("USD");
    expect(r.legs[1].toCurrency).toBe("LBP");
    expect(r.viaCurrency).toBe("USD");
  });

  it("EUR→LBP: correct final amount (10 EUR × 1.16 × 89,000 = 1,032,400 LBP)", () => {
    const r = calculateExchange("EUR", "LBP", 10, mockRates);
    expect(r.totalAmountOut).toBeCloseTo(1032400, 0);
  });

  it("EUR→LBP: total profit = leg1 + leg2", () => {
    const r = calculateExchange("EUR", "LBP", 10, mockRates);
    const expectedTotal = r.legs[0].profitUsd + r.legs[1].profitUsd;
    expect(r.totalProfitUsd).toBeCloseTo(expectedTotal, 8);
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });

  it("LBP→EUR: 2 legs, via USD, correct currencies", () => {
    const r = calculateExchange("LBP", "EUR", 1000000, mockRates);
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0].fromCurrency).toBe("LBP");
    expect(r.legs[0].toCurrency).toBe("USD");
    expect(r.legs[1].fromCurrency).toBe("USD");
    expect(r.legs[1].toCurrency).toBe("EUR");
    expect(r.viaCurrency).toBe("USD");
  });

  it("LBP→EUR: correct final amount (1,000,000 ÷ 90,000 ÷ 1.20 ≈ 9.259 EUR)", () => {
    const r = calculateExchange("LBP", "EUR", 1000000, mockRates);
    expect(r.totalAmountOut).toBeCloseTo(9.259, 2);
  });

  it("LBP→EUR: total profit = leg1 + leg2", () => {
    const r = calculateExchange("LBP", "EUR", 1000000, mockRates);
    const expectedTotal = r.legs[0].profitUsd + r.legs[1].profitUsd;
    expect(r.totalProfitUsd).toBeCloseTo(expectedTotal, 8);
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });
});

// ─── Profit invariants ────────────────────────────────────────────────────────

describe("profit invariants", () => {
  const pairs = [
    ["USD", "LBP"],
    ["LBP", "USD"],
    ["USD", "EUR"],
    ["EUR", "USD"],
    ["EUR", "LBP"],
    ["LBP", "EUR"],
  ];

  test.each(pairs)("profit > 0 for %s→%s", (from, to) => {
    const r = calculateExchange(from, to, 100, mockRates);
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });

  test.each(pairs)(
    "totalProfitUsd = sum of leg profits for %s→%s",
    (from, to) => {
      const r = calculateExchange(from, to, 100, mockRates);
      const sumLegs = r.legs.reduce(
        (s: number, l: { profitUsd: number }) => s + l.profitUsd,
        0,
      );
      expect(r.totalProfitUsd).toBeCloseTo(sumLegs, 8);
    },
  );

  test.each(pairs)("totalAmountOut > 0 for %s→%s", (from, to) => {
    const r = calculateExchange(from, to, 100, mockRates);
    expect(r.totalAmountOut).toBeGreaterThan(0);
  });
});

// ─── N-currency extensibility ─────────────────────────────────────────────────

describe("N-currency extensibility", () => {
  const ratesWithGBP: CurrencyRate[] = [
    ...mockRates,
    {
      to_code: "GBP",
      market_rate: 1.28,
      buy_rate: 1.25,
      sell_rate: 1.31,
      is_stronger: -1,
    },
  ];

  it("GBP→USD works with just a new rate row", () => {
    const r = calculateExchange("GBP", "USD", 10, ratesWithGBP);
    expect(r.legs).toHaveLength(1);
    expect(r.totalAmountOut).toBeCloseTo(10 * 1.25, 4); // 10 × buy_rate 1.25 = 12.5
  });

  it("USD→GBP works with just a new rate row", () => {
    const r = calculateExchange("USD", "GBP", 13.1, ratesWithGBP);
    expect(r.legs).toHaveLength(1);
    expect(r.totalAmountOut).toBeCloseTo(13.1 / 1.31, 4); // 13.1 / sell_rate 1.31 = 10
  });

  it("GBP→LBP: cross-currency, 2 legs, via USD", () => {
    const r = calculateExchange("GBP", "LBP", 1, ratesWithGBP);
    expect(r.legs).toHaveLength(2);
    expect(r.viaCurrency).toBe("USD");
    expect(r.totalAmountOut).toBeCloseTo(1.25 * 89000, 0); // GBP buy_rate × LBP buy_rate
  });

  it("GBP→EUR: cross-currency, 2 legs, via USD", () => {
    const r = calculateExchange("GBP", "EUR", 1, ratesWithGBP);
    expect(r.legs).toHaveLength(2);
    expect(r.viaCurrency).toBe("USD");
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });
});

// ─── Error cases ──────────────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws for unknown currency", () => {
    expect(() => calculateExchange("USD", "GBP", 100, mockRates)).toThrow(
      "No exchange rate found for currency: GBP",
    );
  });

  it("throws for same currency", () => {
    expect(() => calculateExchange("USD", "USD", 100, mockRates)).toThrow(
      "Cannot exchange a currency for itself",
    );
  });

  it("throws for zero amount", () => {
    expect(() => calculateExchange("USD", "LBP", 0, mockRates)).toThrow(
      "Exchange amount must be positive",
    );
  });

  it("throws for negative amount", () => {
    expect(() => calculateExchange("USD", "LBP", -10, mockRates)).toThrow(
      "Exchange amount must be positive",
    );
  });

  it("findCurrencyRate throws for missing code", () => {
    expect(() => findCurrencyRate("GBP", mockRates)).toThrow(
      "No exchange rate found for currency: GBP",
    );
  });
});

// ─── getDisplayRate ───────────────────────────────────────────────────────────

describe("getDisplayRate", () => {
  it("USD→LBP: returns 89,000", () => {
    expect(getDisplayRate("USD", "LBP", mockRates)).toBe(89000);
  });

  it("LBP→USD: returns 90,000 (rate in LBP per USD)", () => {
    expect(getDisplayRate("LBP", "USD", mockRates)).toBe(90000);
  });

  it("EUR→USD: returns 1.16", () => {
    expect(getDisplayRate("EUR", "USD", mockRates)).toBeCloseTo(1.16, 10);
  });

  it("USD→EUR: returns 1.20", () => {
    expect(getDisplayRate("USD", "EUR", mockRates)).toBeCloseTo(1.2, 10);
  });

  it("EUR→LBP: returns combined cross-currency rate", () => {
    const rate = getDisplayRate("EUR", "LBP", mockRates);
    expect(rate).toBeCloseTo(1.16 * 89000, 0); // 103,240
  });
});
