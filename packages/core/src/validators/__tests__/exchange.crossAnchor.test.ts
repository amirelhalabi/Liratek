/**
 * exchangeSubmitSchema — cross-exchange USD-anchor refinement.
 *
 * Mirrors `ExchangeRepository._crossUsdNotional`'s anchor-priority rule: a
 * cross exchange (`viaCurrency` set) anchors off `leg2Rate` when
 * `toCurrency === 'LBP'`, off `leg1Rate` when `fromCurrency === 'LBP'`, and
 * for an exotic<->exotic pair (neither side LBP) tries `leg1Rate` first,
 * falling back to `leg2Rate` at runtime if the FROM currency has no
 * configured `exchange_rates` row — a DB-state question this stateless
 * validator can't see, so it requires BOTH legs unconditionally whenever
 * `viaCurrency` is set, closing every anchor path at once rather than only
 * the one path in front of the request. Before this refinement, a
 * hand-built cross payload missing the anchor rate reached
 * `data.leg2Rate as number` unchecked inside `_usdPerUnitFromExecutedRate`
 * and divided 1/undefined -> a NaN `unit_cost_usd` lot (see
 * `ExchangeRepository.overrideChain.test.ts` for the write-path proof).
 * This file pins the SCHEMA half of that fix: both leg rates must be
 * finite positive numbers whenever a cross is in play.
 */

import { describe, it, expect } from "@jest/globals";
import { exchangeSubmitSchema } from "../exchange.js";

// A direct (non-cross) pair — no viaCurrency, no anchor requirement at all.
const directPair = {
  fromCurrency: "USD",
  toCurrency: "LBP",
  amountIn: 100,
  amountOut: 8_950_000,
  leg1Rate: 89500,
  leg1MarketRate: 89500,
  leg1ProfitUsd: 0,
  totalProfitUsd: 0,
};

// A cross where toCurrency === 'LBP' -> anchor is leg2Rate.
const crossToLbp = {
  fromCurrency: "EUR",
  toCurrency: "LBP",
  amountIn: 100,
  amountOut: 10_384_000,
  leg1Rate: 1.16,
  leg1MarketRate: 1.18,
  leg1ProfitUsd: 20,
  leg2MarketRate: 89500,
  leg2ProfitUsd: 50,
  viaCurrency: "USD",
  totalProfitUsd: 70,
};

// A cross where toCurrency !== 'LBP' -> anchor is leg1Rate (fromCurrency is
// LBP here, one of the two "otherwise" cases named in the rule).
const crossFromLbp = {
  fromCurrency: "LBP",
  toCurrency: "XAF",
  amountIn: 90_000_000,
  amountOut: 200,
  leg1Rate: 90000,
  leg1MarketRate: 89500,
  leg1ProfitUsd: 40,
  leg2Rate: 999,
  leg2MarketRate: 999,
  leg2ProfitUsd: 999,
  viaCurrency: "USD",
  totalProfitUsd: 1039,
};

// A cross where NEITHER side is LBP (exotic<->exotic) — the third anchor
// path in `_crossUsdNotional`: it tries `leg1Rate`/`fromCurrency` first and,
// ONLY if that currency has no configured `exchange_rates` row at runtime,
// falls back to `leg2Rate`/`toCurrency`. This validator has no DB access to
// know which branch `_crossUsdNotional` will take, so both legs must anchor
// unconditionally whenever `viaCurrency` is set.
const crossExoticToExotic = {
  fromCurrency: "GBP",
  toCurrency: "AED",
  amountIn: 100,
  amountOut: 466.41,
  leg1Rate: 1.27,
  leg1MarketRate: 1.27,
  leg1ProfitUsd: 0,
  leg2Rate: 3.6725,
  leg2MarketRate: 3.6725,
  leg2ProfitUsd: 5,
  viaCurrency: "USD",
  totalProfitUsd: 5,
};

describe("exchangeSubmitSchema — direct pair (no viaCurrency)", () => {
  it("accepts a direct pair with no leg2 fields at all", () => {
    const result = exchangeSubmitSchema.safeParse(directPair);
    expect(result.success).toBe(true);
  });
});

describe("exchangeSubmitSchema — cross, toCurrency === 'LBP' (anchor: leg2Rate)", () => {
  it("rejects when leg2Rate is missing (crossToLbp fixture carries no leg2Rate key at all)", () => {
    const result = exchangeSubmitSchema.safeParse(crossToLbp);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("leg2Rate"));
      expect(issue).toBeDefined();
    }
  });

  it("rejects when leg2Rate is zero", () => {
    const result = exchangeSubmitSchema.safeParse({ ...crossToLbp, leg2Rate: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects when leg2Rate is negative", () => {
    const result = exchangeSubmitSchema.safeParse({ ...crossToLbp, leg2Rate: -90000 });
    expect(result.success).toBe(false);
  });

  it("rejects when leg2Rate is Infinity (not finite)", () => {
    const result = exchangeSubmitSchema.safeParse({
      ...crossToLbp,
      leg2Rate: Infinity,
    });
    expect(result.success).toBe(false);
  });

  it("accepts when leg2Rate is a finite positive number", () => {
    const result = exchangeSubmitSchema.safeParse({ ...crossToLbp, leg2Rate: 90000 });
    expect(result.success).toBe(true);
  });
});

describe("exchangeSubmitSchema — cross, toCurrency !== 'LBP' (anchor: leg1Rate)", () => {
  it("accepts with only leg1Rate anchored (leg2Rate present but unused-by-the-rule is fine)", () => {
    const result = exchangeSubmitSchema.safeParse(crossFromLbp);
    expect(result.success).toBe(true);
  });

  it("rejects when leg1Rate is zero", () => {
    const result = exchangeSubmitSchema.safeParse({ ...crossFromLbp, leg1Rate: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("leg1Rate"));
      expect(issue).toBeDefined();
    }
  });

  it("rejects when leg1Rate is negative", () => {
    const result = exchangeSubmitSchema.safeParse({ ...crossFromLbp, leg1Rate: -90000 });
    expect(result.success).toBe(false);
  });
});

describe("exchangeSubmitSchema — cross, neither side LBP (both legs must anchor)", () => {
  it("accepts when both leg1Rate and leg2Rate are finite positive numbers", () => {
    const result = exchangeSubmitSchema.safeParse(crossExoticToExotic);
    expect(result.success).toBe(true);
  });

  it("rejects when leg2Rate is missing — this is the fallback anchor _crossUsdNotional reads if fromCurrency (GBP) turns out to have no configured exchange_rates row; a schema that only required leg1Rate here would let this reach the repository unchecked", () => {
    const { leg2Rate: _leg2Rate, ...rest } = crossExoticToExotic;
    const result = exchangeSubmitSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("leg2Rate"));
      expect(issue).toBeDefined();
    }
  });

  it("rejects when leg2Rate is zero", () => {
    const result = exchangeSubmitSchema.safeParse({ ...crossExoticToExotic, leg2Rate: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects when leg1Rate is missing", () => {
    const { leg1Rate: _leg1Rate, ...rest } = crossExoticToExotic;
    const result = exchangeSubmitSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("leg1Rate"));
      expect(issue).toBeDefined();
    }
  });
});
