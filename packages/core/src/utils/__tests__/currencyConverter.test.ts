/**
 * Unit tests for currencyConverter.ts
 *
 * Tests the universal formula, conversions, profit calculations,
 * and the master calculateExchange() for all currency pairs.
 *
 * NOT RUN — proven at the end-of-batch gate (LIRA-213 #20 batch — the
 * `calculateAmountInForTarget` describe block below is new in this change).
 */

import {
  computeRate,
  convertToUSD,
  convertFromUSD,
  computeLegProfitUsd,
  computeOverrideLegProfitUsd,
  calculateExchange,
  calculateAmountInForTarget,
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
  it("LBP leg (USD→LBP): profit = amountIn × halfSpread / market_rate", () => {
    // 10 USD → LBP: shop keeps spread on the LBP side, converted back to USD
    const profit = computeLegProfitUsd(10, lbp, true);
    expect(profit).toBeCloseTo((10 * 500) / 89500, 8);
  });

  it("LBP leg (LBP→USD): profit = amountIn × halfSpread / market_rate²", () => {
    // 89500 LBP ≈ 1 USD at market; profit must be positive and much smaller than 89500
    const profit = computeLegProfitUsd(89500, lbp, false);
    expect(profit).toBeCloseTo((89500 * 500) / (89500 * 89500), 8);
    expect(profit).toBeGreaterThan(0);
  });

  it("EUR leg (EUR→USD): profit = amountIn × halfSpread", () => {
    // 10 EUR, halfSpread = (1.20-1.16)/2 = 0.02
    const profit = computeLegProfitUsd(10, eur, false);
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

// ─── computeOverrideLegProfitUsd ────────────────────────────────────────────
//
// Anchors mirror the live-DB rates used throughout this file: LBP market
// 89500 / buy 89000 / sell 90000 (is_stronger=+1); EUR market 1.18 / buy
// 1.16 / sell 1.20 (is_stronger=-1). SIGN CONVENTION under test: +ve = the
// shop keeps value vs market; −ve = the customer got better than market
// (a real loss) — never wrapped in Math.abs.

describe("computeOverrideLegProfitUsd", () => {
  it("USD→LBP payout of 116 USD, applied 89000 vs market 89500: shop pays out FEWER LBP → +0.6480", () => {
    const marketOut = 116 * 89500; // 10,382,000
    const actualOut = 116 * 89000; // 10,324,000
    const profit = computeOverrideLegProfitUsd(marketOut, actualOut, lbp);
    expect(profit).toBeCloseTo(116 / 179, 10); // 58,000 / 89,500 = +0.6480...
    expect(profit).toBeGreaterThan(0);
  });

  it("same payout at applied 90000 (customer gets MORE LBP) → −0.6480 (a real loss)", () => {
    const marketOut = 116 * 89500;
    const actualOut = 116 * 90000; // 10,440,000
    const profit = computeOverrideLegProfitUsd(marketOut, actualOut, lbp);
    expect(profit).toBeCloseTo(-(116 / 179), 10);
    expect(profit).toBeLessThan(0);
  });

  it("EUR→USD leg (shop buys 100 EUR), applied 1.12 vs market 1.18 → +6.00 (OUT is USD, outCurrencyRate: null)", () => {
    const marketOut = 100 * 1.18; // 118 USD
    const actualOut = 100 * 1.12; // 112 USD
    const profit = computeOverrideLegProfitUsd(marketOut, actualOut, null);
    expect(profit).toBeCloseTo(6, 10);
  });

  it("same buy at applied 1.20 (shop overpaid the customer in USD) → −2.00", () => {
    const marketOut = 100 * 1.18;
    const actualOut = 100 * 1.2; // 120 USD
    const profit = computeOverrideLegProfitUsd(marketOut, actualOut, null);
    expect(profit).toBeCloseTo(-2, 10);
  });

  it("applied === market → 0, regardless of OUT currency", () => {
    expect(computeOverrideLegProfitUsd(10_382_000, 10_382_000, lbp)).toBe(0);
    expect(computeOverrideLegProfitUsd(118, 118, null)).toBe(0);
    expect(computeOverrideLegProfitUsd(100, 100, eur)).toBe(0);
  });

  it("is_stronger orientation — EUR OUT (is_stronger=-1) multiplies by market_rate, not divides", () => {
    // USD→EUR leg: 118 USD at market 1.18 -> 100 EUR; applied 1.20 gives the
    // customer FEWER EUR (98.333...) — the shop keeps value → +profit.
    const marketOut = 118 / 1.18; // 100 EUR
    const actualOut = 118 / 1.2; // 98.3333... EUR
    const profit = computeOverrideLegProfitUsd(marketOut, actualOut, eur);
    expect(profit).toBeCloseTo(5.9 / 3, 10); // (100 - 118/1.2) EUR * 1.18 USD/EUR
    expect(profit).toBeGreaterThan(0);
  });

  it("is_stronger orientation — LBP OUT (is_stronger=+1) divides by market_rate, at a different magnitude than the primary anchor", () => {
    const marketOut = 50 * 89500; // 4,475,000
    const actualOut = 50 * 89000; // 4,450,000
    const profit = computeOverrideLegProfitUsd(marketOut, actualOut, lbp);
    expect(profit).toBeCloseTo(25000 / 89500, 10);
    expect(profit).toBeGreaterThan(0);
  });
});

// ─── calculateAmountInForTarget — LIRA-213 #20 ────────────────────────────────
// "The customer wants 50 EUR — how much USD does he pay?" — the reverse of
// calculateExchange(). Owner answer: no rounding, exact figure, honour rate
// overrides (a caller-adjusted rates[] is just data — see the worked examples
// in OWNER_NOTES_REMAINING_BUILD.md #20).

describe("calculateAmountInForTarget — worked examples from the owner's note", () => {
  it("customer wants 50 EUR and pays USD, EUR sell 1.20 → exactly $60.00", () => {
    const amountIn = calculateAmountInForTarget("USD", "EUR", 50, mockRates);
    expect(amountIn).toBeCloseTo(60, 10);
    // and forward from that exact amount gives back exactly 50 EUR
    const fwd = calculateExchange("USD", "EUR", amountIn, mockRates);
    expect(fwd.totalAmountOut).toBeCloseTo(50, 10);
  });

  it("customer wants 5,000,000 LBP and pays USD, LBP buy 89,000 → exactly $56.1797752...", () => {
    const amountIn = calculateAmountInForTarget(
      "USD",
      "LBP",
      5000000,
      mockRates,
    );
    expect(amountIn).toBeCloseTo(5000000 / 89000, 10);
    const fwd = calculateExchange("USD", "LBP", amountIn, mockRates);
    expect(fwd.totalAmountOut).toBeCloseTo(5000000, 6);
  });

  it("customer wants 50 EUR and pays LBP (cross, EUR sell 1.1634) → exactly 5,235,300 LBP", () => {
    const crossRates: CurrencyRate[] = [
      lbp,
      { ...eur, sell_rate: 1.1634 },
    ];
    const amountIn = calculateAmountInForTarget(
      "LBP",
      "EUR",
      50,
      crossRates,
    );
    // FIX ROUND finding "float-noise-shown-as-exact" — this is the owner's
    // own worked example. `toBe` (not `toBeCloseTo`) on purpose: the reverse
    // chain (convertToUSD then convertFromUSD, two independent float
    // multiplications) is not guaranteed by IEEE-754 to land on the exact
    // integer even though the true value is exact — `calculateAmountInForTarget`
    // strips that representation noise (`stripFloatNoise`, 12 significant
    // digits) without rounding to LBP's cash decimals, so the figure the
    // "You Receive"/target boxes display and the payload books is the exact
    // 5,235,300, never a `5235299.999999999`-shaped artifact.
    expect(amountIn).toBe(5235300);
    const fwd = calculateExchange("LBP", "EUR", amountIn, crossRates);
    expect(fwd.totalAmountOut).toBeCloseTo(50, 8);
  });

  it("strips genuine IEEE-754 noise from the reverse chain (not merely a coincidentally-exact rate)", () => {
    // Unlike the 1.1634 example above (which happens to land exact in
    // doubles), this EUR sell rate makes the UNMODIFIED
    // `targetOut * sellRate * lbpSellRate` chain produce
    // 4547699.999999999 in plain JS float arithmetic — verified directly:
    // `50 * 1.0106 * 90000 === 4547699.999999999`, one ULP below the true
    // 4,547,700. `calculateAmountInForTarget` must still return the exact
    // integer.
    const noisyRates: CurrencyRate[] = [lbp, { ...eur, sell_rate: 1.0106 }];
    const amountIn = calculateAmountInForTarget("LBP", "EUR", 50, noisyRates);
    expect(amountIn).toBe(4547700);
  });
});

describe("calculateAmountInForTarget — reverse(forward(x)) = x, every direction", () => {
  const directions: Array<[string, string]> = [
    ["USD", "LBP"],
    ["LBP", "USD"],
    ["USD", "EUR"],
    ["EUR", "USD"],
  ];

  test.each(directions)(
    "%s→%s: reverse(forward(x)) = x",
    (from, to) => {
      const x = 137.4321;
      const forward = calculateExchange(from, to, x, mockRates);
      const back = calculateAmountInForTarget(
        from,
        to,
        forward.totalAmountOut,
        mockRates,
      );
      expect(back).toBeCloseTo(x, 8);
    },
  );

  it("cross pair EUR→LBP: reverse(forward(x)) = x", () => {
    const x = 42.5;
    const forward = calculateExchange("EUR", "LBP", x, mockRates);
    const back = calculateAmountInForTarget(
      "EUR",
      "LBP",
      forward.totalAmountOut,
      mockRates,
    );
    expect(back).toBeCloseTo(x, 6);
  });

  it("cross pair LBP→EUR: reverse(forward(x)) = x", () => {
    const x = 3_250_000;
    const forward = calculateExchange("LBP", "EUR", x, mockRates);
    const back = calculateAmountInForTarget(
      "LBP",
      "EUR",
      forward.totalAmountOut,
      mockRates,
    );
    expect(back).toBeCloseTo(x, 4);
  });

  it("forward(reverse(y)) = y — the direction the page actually drives", () => {
    const y = 25_000_000; // customer wants 25M LBP
    const amountIn = calculateAmountInForTarget("USD", "LBP", y, mockRates);
    const forward = calculateExchange("USD", "LBP", amountIn, mockRates);
    expect(forward.totalAmountOut).toBeCloseTo(y, 6);
  });
});

describe("calculateAmountInForTarget — errors and edge cases", () => {
  it("throws for same-currency exchange", () => {
    expect(() =>
      calculateAmountInForTarget("USD", "USD", 10, mockRates),
    ).toThrow(/itself/);
  });

  it("throws for a non-positive target", () => {
    expect(() =>
      calculateAmountInForTarget("USD", "LBP", 0, mockRates),
    ).toThrow(/positive/);
    expect(() =>
      calculateAmountInForTarget("USD", "LBP", -5, mockRates),
    ).toThrow(/positive/);
  });

  it("throws for an unknown currency (findCurrencyRate)", () => {
    expect(() =>
      calculateAmountInForTarget("USD", "GBP", 10, mockRates),
    ).toThrow(/No exchange rate found/);
  });
});
