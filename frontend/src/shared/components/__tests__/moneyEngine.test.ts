/**
 * Unit tests for the multi-currency payment engine
 * (packages/ui/src/money/*, docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md §4).
 *
 * Lives in the frontend workspace beside MultiPaymentInput.test.tsx because
 * @liratek/ui has no jest infrastructure; jest.config maps "@liratek/ui" to
 * the package source, so no build step is involved.
 *
 * The named invariants (plan §4):
 *   I1 — same-currency remaining is independent of every rate
 *   I2 — conservation per currency (paid = native + cross-consumed + change)
 *   I3 — identity: converting to the same currency returns the input as-is
 *   I4 — rounding honesty within each currency's epsilon
 *   I5 — determinism, including spillover order (D1)
 */

import {
  allocatePayments,
  convert,
  crossRate,
  DEFAULT_CURRENCIES,
  isSettled,
  MoneyError,
  roundForCurrency,
  type Money,
  type RateTable,
} from "@liratek/ui";

const usd = (amount: number): Money => ({ amount, currency: "USD" });
const lbp = (amount: number): Money => ({ amount, currency: "LBP" });
const eur = (amount: number): Money => ({ amount, currency: "EUR" });

const RATES: RateTable = {
  base: "USD",
  rates: { LBP: { buy: 89_000, sell: 89_500 } },
};

// EUR-readiness (plan MCP-5 acceptance): a third currency is DATA — the same
// engine handles it with zero new code. 1 USD = 0.9 EUR (buy side).
const RATES_EUR: RateTable = {
  base: "USD",
  rates: {
    LBP: { buy: 89_000, sell: 89_500 },
    EUR: { buy: 0.9, sell: 0.92 },
  },
};

describe("convert / crossRate", () => {
  it("I3 — converting to the same currency returns the input unchanged, no rate consulted", () => {
    const m = lbp(600_000);
    // Same reference — and works even with an empty table.
    expect(convert(m, "LBP", { base: "USD", rates: {} }, "buy")).toBe(m);
  });

  it("converts USD→LBP and LBP→USD through the quoted orientation", () => {
    expect(convert(usd(100), "LBP", RATES, "buy")).toEqual(lbp(8_900_000));
    expect(convert(lbp(890_000), "USD", RATES, "buy")).toEqual(usd(10));
  });

  it("respects the quote side", () => {
    expect(convert(usd(1), "LBP", RATES, "buy").amount).toBe(89_000);
    expect(convert(usd(1), "LBP", RATES, "sell").amount).toBe(89_500);
  });

  it("converts any-to-any through the base (EUR→LBP with no EUR↔LBP code path)", () => {
    // 9 EUR = 10 USD = 890,000 LBP at buy.
    expect(convert(eur(9), "LBP", RATES_EUR, "buy").amount).toBeCloseTo(
      890_000,
      6,
    );
    expect(crossRate("EUR", "LBP", RATES_EUR, "buy")).toBeCloseTo(
      89_000 / 0.9,
      6,
    );
  });

  it("throws MoneyError on a missing, zero, or non-finite rate — never NaN out", () => {
    expect(() => convert(usd(1), "EUR", RATES, "buy")).toThrow(MoneyError);
    expect(() =>
      convert(
        usd(1),
        "LBP",
        { base: "USD", rates: { LBP: { buy: 0, sell: 0 } } },
        "buy",
      ),
    ).toThrow(MoneyError);
    expect(() =>
      convert({ amount: Number.NaN, currency: "USD" }, "LBP", RATES, "buy"),
    ).toThrow(MoneyError);
  });
});

describe("roundForCurrency / isSettled (registry)", () => {
  it("rounds to each currency's precision (LBP whole, USD cents)", () => {
    expect(roundForCurrency(lbp(606_741.573)).amount).toBe(606_742);
    expect(roundForCurrency(usd(45.505618)).amount).toBe(45.51);
  });

  it("treats sub-epsilon amounts as settled", () => {
    expect(isSettled(usd(0.004))).toBe(true);
    expect(isSettled(lbp(0.4))).toBe(true);
    expect(isSettled(lbp(1))).toBe(false);
    expect(isSettled(usd(0.02))).toBe(false);
  });

  it("defaults unknown currencies to a safe 2-decimal profile", () => {
    expect(roundForCurrency(eur(1.006)).amount).toBe(1.01);
  });
});

describe("allocatePayments — native pass (I1)", () => {
  it("nets a same-currency payment with NO rate involvement", () => {
    const result = allocatePayments({
      totals: [lbp(600_000)],
      payments: [lbp(200_000)],
      rates: RATES,
      side: "buy",
    });
    expect(result.remaining).toEqual([lbp(400_000)]);
    expect(result.crossCurrencyApplied).toEqual([]);
    expect(result.change).toEqual([]);
  });

  it("I1 — same-currency remaining is identical under wildly different rates", () => {
    const at = (rate: number) =>
      allocatePayments({
        totals: [lbp(600_000)],
        payments: [lbp(200_000)],
        rates: { base: "USD", rates: { LBP: { buy: rate, sell: rate } } },
        side: "buy",
      });
    expect(at(89_000)).toEqual(at(150_000));
  });

  it("the T2 shape: an untouched LBP debt stays exactly 600,000 at any rate", () => {
    for (const rate of [89_000, 90_000, 100_000]) {
      const { remaining } = allocatePayments({
        totals: [lbp(600_000)],
        payments: [],
        rates: { base: "USD", rates: { LBP: { buy: rate, sell: rate } } },
        side: "buy",
      });
      expect(remaining).toEqual([lbp(600_000)]);
    }
  });

  it("produces change in the tender currency when overpaid natively (D1)", () => {
    const result = allocatePayments({
      totals: [lbp(600_000)],
      payments: [lbp(700_000)],
      rates: RATES,
      side: "buy",
    });
    expect(result.remaining).toEqual([]);
    expect(result.change).toEqual([lbp(100_000)]);
    expect(result.crossCurrencyApplied).toEqual([]);
  });
});

describe("allocatePayments — cross-currency spillover (D1, I2)", () => {
  it("applies excess LBP to the USD debt at the given rate, and only the excess", () => {
    // Owed $50 + 600,000 LBP; customer hands 1,000,000 LBP.
    const result = allocatePayments({
      totals: [usd(50), lbp(600_000)],
      payments: [lbp(1_000_000)],
      rates: RATES,
      side: "buy",
    });
    // Native: 600,000 LBP settled. Excess 400,000 LBP → $4.4944 at 89,000.
    expect(result.remaining).toEqual([usd(45.51)]);
    expect(result.change).toEqual([]);
    expect(result.crossCurrencyApplied).toHaveLength(1);
    const cross = result.crossCurrencyApplied[0];
    expect(cross.from.currency).toBe("LBP");
    expect(cross.from.amount).toBeCloseTo(400_000, 6);
    expect(cross.to.currency).toBe("USD");
    expect(cross.to.amount).toBeCloseTo(400_000 / 89_000, 6);
  });

  it("I2 — conservation: paid = native-applied + cross-consumed + change, per currency", () => {
    const paidLbp = 1_500_000;
    const result = allocatePayments({
      totals: [usd(5), lbp(600_000)],
      payments: [lbp(paidLbp)],
      rates: RATES,
      side: "buy",
    });
    // Native LBP applied = 600,000; cross consumes 5 USD × 89,000 = 445,000;
    // change carries the rest, still in LBP.
    const crossConsumed = result.crossCurrencyApplied
      .filter((c) => c.from.currency === "LBP")
      .reduce((s, c) => s + c.from.amount, 0);
    const changeLbp =
      result.change.find((m) => m.currency === "LBP")?.amount ?? 0;
    expect(600_000 + crossConsumed + changeLbp).toBeCloseTo(paidLbp, 0);
    expect(result.remaining).toEqual([]);
    expect(changeLbp).toBe(455_000);
  });

  it("D1 — settles the LARGEST remaining (in base value) first; change stays in tender currency", () => {
    // Owed $10 (≈ $10) + 600,000 LBP (≈ $6.74): USD bucket is larger.
    // Customer hands 20 EUR (≈ $22.22 at buy 0.9).
    const result = allocatePayments({
      totals: [usd(10), lbp(600_000)],
      payments: [eur(20)],
      rates: RATES_EUR,
      side: "buy",
    });

    expect(result.remaining).toEqual([]);
    // USD first (largest), then LBP.
    expect(
      result.crossCurrencyApplied.map((c) => c.to.currency),
    ).toEqual(["USD", "LBP"]);
    // Consumed: $10 → 9 EUR; 600,000 LBP → 600,000 × 0.9 / 89,000 ≈ 6.0674 EUR.
    expect(result.change).toHaveLength(1);
    expect(result.change[0].currency).toBe("EUR");
    expect(result.change[0].amount).toBeCloseTo(20 - 9 - 6.067416, 2);
  });

  it("EUR-readiness: a third currency participates with zero engine changes", () => {
    const result = allocatePayments({
      totals: [eur(100)],
      payments: [usd(50), lbp(890_000)],
      rates: RATES_EUR,
      side: "buy",
    });
    // 50 USD = 45 EUR; 890,000 LBP = 10 USD = 9 EUR → 54 EUR applied.
    expect(result.remaining).toEqual([eur(46)]);
    expect(result.change).toEqual([]);
  });

  it("I4 — float dust from a conversion round-trip never surfaces as a phantom remainder", () => {
    // 890,000 LBP is exactly $10 — the USD debt must close, not leave $1e-15.
    const result = allocatePayments({
      totals: [usd(10)],
      payments: [lbp(890_000)],
      rates: RATES,
      side: "buy",
    });
    expect(result.remaining).toEqual([]);
    expect(result.change).toEqual([]);
  });

  it("keeps honest sub-epsilon change out but real small change in", () => {
    const dust = allocatePayments({
      totals: [usd(10)],
      payments: [usd(10.004)],
      rates: RATES,
      side: "buy",
    });
    expect(dust.change).toEqual([]);

    const real = allocatePayments({
      totals: [usd(10)],
      payments: [usd(10.25)],
      rates: RATES,
      side: "buy",
    });
    expect(real.change).toEqual([usd(0.25)]);
  });
});

describe("allocatePayments — determinism & input hygiene (I5)", () => {
  it("is deterministic: identical inputs give identical outputs", () => {
    const input = {
      totals: [usd(50), lbp(600_000)],
      payments: [lbp(1_000_000), usd(20)],
      rates: RATES,
      side: "buy" as const,
    };
    expect(allocatePayments(input)).toEqual(allocatePayments(input));
  });

  it("consolidates duplicate-currency entries before allocating", () => {
    const result = allocatePayments({
      totals: [lbp(400_000), lbp(200_000)],
      payments: [lbp(100_000), lbp(100_000)],
      rates: RATES,
      side: "buy",
    });
    expect(result.remaining).toEqual([lbp(400_000)]);
  });

  it("rejects negative and non-finite amounts with MoneyError", () => {
    expect(() =>
      allocatePayments({
        totals: [usd(-5)],
        payments: [],
        rates: RATES,
        side: "buy",
      }),
    ).toThrow(MoneyError);
    expect(() =>
      allocatePayments({
        totals: [usd(10)],
        payments: [{ amount: Number.NaN, currency: "LBP" }],
        rates: RATES,
        side: "buy",
      }),
    ).toThrow(MoneyError);
  });

  it("throws (not NaN) when spillover needs a rate the table lacks", () => {
    expect(() =>
      allocatePayments({
        totals: [usd(10)],
        payments: [eur(20)], // no EUR rate in RATES
        rates: RATES,
        side: "buy",
      }),
    ).toThrow(MoneyError);
  });

  it("registry knowledge is data: DEFAULT_CURRENCIES carries LBP whole-unit precision", () => {
    expect(DEFAULT_CURRENCIES.LBP.decimals).toBe(0);
    expect(DEFAULT_CURRENCIES.USD.decimals).toBe(2);
  });

  it("round:false keeps raw amounts (for caller-side display pipelines) but still drops dust", () => {
    const raw = allocatePayments(
      {
        totals: [usd(10.126)],
        payments: [usd(10)],
        rates: RATES,
        side: "buy",
      },
      { round: false },
    );
    expect(raw.remaining).toHaveLength(1);
    expect(raw.remaining[0].amount).toBeCloseTo(0.126, 10); // not rounded to 0.13
    expect(raw.remaining[0].amount).not.toBe(0.13);

    const dust = allocatePayments(
      {
        totals: [usd(10)],
        payments: [usd(10.004)],
        rates: RATES,
        side: "buy",
      },
      { round: false },
    );
    expect(dust.change).toEqual([]); // sub-epsilon dust still dropped
  });
});
