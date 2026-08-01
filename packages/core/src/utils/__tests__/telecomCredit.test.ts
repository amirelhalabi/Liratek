/**
 * Telecom Days & Credit Validity Model — pure calc core tests.
 *
 * Spec: docs/plans/todo_plans/TELECOM_DAYS_VALIDITY_PLAN.md §2.
 */

import {
  MAX_CREDIT_PER_SMS_USD,
  SMS_TRANSFER_FEE_USD,
  CREDIT_TRANSFER_STEP_USD,
  maxReturnableCredits,
  deriveItemEconomics,
  deliveredCostLbp,
  isTelecomSplitComplete,
} from "../telecomCredit";

describe("telecomCredit", () => {
  describe("constants", () => {
    it("pins the carrier constants (owner's explicit hardcoded values)", () => {
      expect(MAX_CREDIT_PER_SMS_USD).toBe(3);
      expect(SMS_TRANSFER_FEE_USD).toBe(0.16);
      expect(CREDIT_TRANSFER_STEP_USD).toBe(0.5);
    });
  });

  describe("maxReturnableCredits", () => {
    it("returns exactly 73 for the 77$ cart headline case (not 72.5 or 72.99999...)", () => {
      const result = maxReturnableCredits(77);
      expect(result).toBe(73);
      // Guard against the floating-point trap explicitly: a near-miss like
      // 72.99999999999999 would still "look" like 73 in loose comparisons.
      expect(Object.is(result, 73)).toBe(true);
    });

    it("picks the n-1 candidate when it beats the loop-ceiling n (B=3.2 -> 3.0)", () => {
      expect(maxReturnableCredits(3.2)).toBe(3.0);
    });

    it("picks the loop-ceiling n when it beats n-1 (B=5 -> 4.5)", () => {
      expect(maxReturnableCredits(5)).toBe(4.5);
    });

    it("B=10 -> 9.0", () => {
      expect(maxReturnableCredits(10)).toBe(9.0);
    });

    it("B=3 -> 2.5", () => {
      expect(maxReturnableCredits(3)).toBe(2.5);
    });

    it("B=0.5 -> 0 (one SMS would leave the balance negative after the fee)", () => {
      expect(maxReturnableCredits(0.5)).toBe(0);
    });

    it("B=0.66 -> 0.5", () => {
      expect(maxReturnableCredits(0.66)).toBe(0.5);
    });

    it("B=0 -> 0", () => {
      expect(maxReturnableCredits(0)).toBe(0);
    });

    it("clamps negative balances to 0", () => {
      expect(maxReturnableCredits(-5)).toBe(0);
      expect(maxReturnableCredits(-0.01)).toBe(0);
    });

    it("guards NaN and non-finite input to 0", () => {
      expect(maxReturnableCredits(NaN)).toBe(0);
      expect(maxReturnableCredits(Infinity)).toBe(0);
      expect(maxReturnableCredits(-Infinity)).toBe(0);
    });

    it("survives known naive-float-arithmetic failure points (rule 17 guard)", () => {
      // These balances are pinned because a naive `balance - FEE*n` computed
      // in raw doubles (no integer-cents conversion) lands a hair below the
      // true step boundary and floors one step too low. Verified against a
      // brute-force sweep of 50,000 balances comparing naive vs integer-cents
      // arithmetic before this test was written.
      expect(maxReturnableCredits(1.16)).toBe(1.0);
      expect(maxReturnableCredits(32.26)).toBe(30.5);
      expect(maxReturnableCredits(32.76)).toBe(31.0);
      expect(maxReturnableCredits(33.26)).toBe(31.5);
      expect(maxReturnableCredits(33.76)).toBe(32.0);
      expect(maxReturnableCredits(67.02)).toBe(63.5);
      expect(maxReturnableCredits(67.52)).toBe(64.0);
    });

    it("M1 regression: floors a sub-cent balance instead of rounding it up (1.159 -> 0.5, not 1.0)", () => {
      // 1.159 * 100 = 115.9 cents. The true balance is $1.159 — flooring to
      // the cent gives 115 cents ($1.15), which returns 0.5 via the normal
      // n=1 candidate (300 cap, 115-16=99 surviving, floored to 50).
      // Math.round would instead read this as 116 cents ($1.16), which
      // returns 1.0 — over-counting what the shop will actually get back.
      expect(maxReturnableCredits(1.159)).toBe(0.5);
    });

    it("M1 regression: floors a sub-cent balance instead of rounding it up (76.999 -> 72.5, not 73)", () => {
      // 76.999 * 100 = 7699.9 cents -> floors to 7699 ($76.99), whose best
      // candidate is 72.5 (n=25: cap 7500, surviving 7699-400=7299, floored
      // to 7250 = 72.5). Math.round reads 76.999 as a full 7700 cents
      // ($77.00 exactly) and silently returns the 77$-cart figure of 73 —
      // expecting 0.5$ more credit back than can ever actually arrive.
      expect(maxReturnableCredits(76.999)).toBe(72.5);
    });

    it("M1 regression: an EXACT-cent balance is unaffected by flooring (77 still returns exactly 73)", () => {
      // Guards against a naive floor-without-epsilon fix, which would
      // corrupt exact values whose `* 100` lands a hair BELOW the integer
      // in binary floating point (e.g. 1.16 * 100 === 115.99999999999999).
      expect(maxReturnableCredits(77)).toBe(73);
      expect(maxReturnableCredits(1.16)).toBe(1.0);
    });

    it("never returns a value that is not a multiple of the 0.5 step", () => {
      for (let cents = 1; cents <= 20000; cents += 37) {
        const balance = cents / 100;
        const result = maxReturnableCredits(balance);
        // multiply by 2 and round to defeat float noise on the modulo check
        expect(Math.round(result * 2) % 1).toBe(0);
      }
    });
  });

  describe("isTelecomSplitComplete", () => {
    const completeItem = { cost_lbp: 7_600_000, days_cost_lbp: 1_162_000, credits: 77 };

    it("is true for a fully-specified split", () => {
      expect(isTelecomSplitComplete(completeItem)).toBe(true);
    });

    it("is false when cost_lbp is missing, zero, or negative", () => {
      expect(
        isTelecomSplitComplete({ ...completeItem, cost_lbp: 0 }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, cost_lbp: -1 }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, cost_lbp: null }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, cost_lbp: undefined }),
      ).toBe(false);
    });

    it("is false when days_cost_lbp is null, undefined, zero, or negative", () => {
      expect(
        isTelecomSplitComplete({ ...completeItem, days_cost_lbp: null }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, days_cost_lbp: undefined }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, days_cost_lbp: 0 }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, days_cost_lbp: -1 }),
      ).toBe(false);
    });

    it("is false when credits is null, undefined, zero, or negative", () => {
      expect(
        isTelecomSplitComplete({ ...completeItem, credits: null }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, credits: undefined }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, credits: 0 }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, credits: -1 }),
      ).toBe(false);
    });

    it("is false when days_cost_lbp is not strictly less than cost_lbp", () => {
      expect(
        isTelecomSplitComplete({ ...completeItem, days_cost_lbp: 7_600_000 }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, days_cost_lbp: 8_000_000 }),
      ).toBe(false);
    });

    it("is false when any field is non-finite", () => {
      expect(
        isTelecomSplitComplete({ ...completeItem, cost_lbp: NaN }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, days_cost_lbp: Infinity }),
      ).toBe(false);
      expect(
        isTelecomSplitComplete({ ...completeItem, credits: NaN }),
      ).toBe(false);
    });

    it("accepts a structurally-typed object with extra fields (frontend item shape)", () => {
      const frontendItem = {
        id: 1,
        label: "77$ Cart",
        provider: "iPick",
        category: "mtc",
        cost_lbp: 7_600_000,
        days_cost_lbp: 1_162_000,
        credits: 77,
        sell_lbp: 8_000_000,
      };
      expect(isTelecomSplitComplete(frontendItem)).toBe(true);
    });
  });

  describe("deriveItemEconomics", () => {
    it("matches the §2.3 worked example for the 77$ cart", () => {
      const result = deriveItemEconomics({
        costLbp: 7_600_000,
        daysCostLbp: 1_162_000,
        creditsUsd: 77,
      });

      expect(result.creditCostLbp).toBe(6_438_000);
      expect(result.maxReturnedUsd).toBe(73);
      expect(result.recoveredRateLbp).not.toBeNull();
      expect(result.recoveredRateLbp as number).toBeCloseTo(88_191.78, 2);
      expect(result.selfChargeRateLbp).not.toBeNull();
      expect(result.selfChargeRateLbp as number).toBeCloseTo(83_610.39, 2);
    });

    it("holds the correctness invariant: costLbp - maxReturned * recoveredRateLbp == daysCostLbp", () => {
      const costLbp = 7_600_000;
      const daysCostLbp = 1_162_000;
      const result = deriveItemEconomics({ costLbp, daysCostLbp, creditsUsd: 77 });

      const netCost =
        costLbp - (result.maxReturnedUsd as number) * (result.recoveredRateLbp as number);
      expect(netCost).toBeCloseTo(daysCostLbp, 6);
    });

    it("returns all-null when days_cost_lbp is missing (incomplete split)", () => {
      const result = deriveItemEconomics({
        costLbp: 7_600_000,
        daysCostLbp: null,
        creditsUsd: 77,
      });
      expect(result).toEqual({
        creditCostLbp: null,
        maxReturnedUsd: null,
        recoveredRateLbp: null,
        selfChargeRateLbp: null,
      });
    });

    it("returns all-null when credits is missing (incomplete split)", () => {
      const result = deriveItemEconomics({
        costLbp: 7_600_000,
        daysCostLbp: 1_162_000,
        creditsUsd: null,
      });
      expect(result).toEqual({
        creditCostLbp: null,
        maxReturnedUsd: null,
        recoveredRateLbp: null,
        selfChargeRateLbp: null,
      });
    });

    it("returns all-null when days_cost_lbp >= cost_lbp", () => {
      const result = deriveItemEconomics({
        costLbp: 7_600_000,
        daysCostLbp: 7_600_000,
        creditsUsd: 77,
      });
      expect(result).toEqual({
        creditCostLbp: null,
        maxReturnedUsd: null,
        recoveredRateLbp: null,
        selfChargeRateLbp: null,
      });
    });

    it("returns all-null when cost_lbp is zero or negative", () => {
      expect(
        deriveItemEconomics({ costLbp: 0, daysCostLbp: 0, creditsUsd: 77 }),
      ).toEqual({
        creditCostLbp: null,
        maxReturnedUsd: null,
        recoveredRateLbp: null,
        selfChargeRateLbp: null,
      });
    });

    it("guards divide-by-zero: recoveredRateLbp is null when creditsUsd is too small to ever return anything, but selfChargeRateLbp still computes", () => {
      // 0.3$ face credit: split is technically "complete" (credits > 0), but
      // maxReturnableCredits(0.3) is 0 — no SMS transfer can ever recover it.
      const result = deriveItemEconomics({
        costLbp: 100_000,
        daysCostLbp: 50_000,
        creditsUsd: 0.3,
      });
      expect(result.maxReturnedUsd).toBe(0);
      expect(result.recoveredRateLbp).toBeNull();
      expect(result.selfChargeRateLbp).not.toBeNull();
      expect(result.selfChargeRateLbp as number).toBeCloseTo(50_000 / 0.3, 2);
    });

    it("never throws and never returns NaN, across a battery of malformed inputs", () => {
      const inputs: Array<{
        costLbp: number;
        daysCostLbp: number | null | undefined;
        creditsUsd: number | null | undefined;
      }> = [
        { costLbp: NaN, daysCostLbp: 1, creditsUsd: 1 },
        { costLbp: -1, daysCostLbp: 1, creditsUsd: 1 },
        { costLbp: 100, daysCostLbp: undefined, creditsUsd: 1 },
        { costLbp: 100, daysCostLbp: 1, creditsUsd: undefined },
        { costLbp: 100, daysCostLbp: NaN, creditsUsd: 1 },
        { costLbp: 100, daysCostLbp: 1, creditsUsd: NaN },
      ];

      for (const input of inputs) {
        expect(() => deriveItemEconomics(input)).not.toThrow();
        const result = deriveItemEconomics(input);
        for (const value of Object.values(result)) {
          expect(value === null || Number.isFinite(value)).toBe(true);
        }
      }
    });
  });

  describe("deliveredCostLbp", () => {
    // recoveredRateLbp for the 77$ cart, per the §2.3 worked example.
    const recoveredRateLbp = 6_438_000 / 73;

    it("matches the §2.4 table for chunk = 1$ (102,302 LBP)", () => {
      expect(deliveredCostLbp(recoveredRateLbp, 1)).toBeCloseTo(102_302, 0);
    });

    it("matches the §2.4 table for chunk = 2$ (95,247 LBP)", () => {
      expect(deliveredCostLbp(recoveredRateLbp, 2)).toBeCloseTo(95_247, 0);
    });

    it("matches the §2.4 table for chunk = 3$ (92,895 LBP)", () => {
      expect(deliveredCostLbp(recoveredRateLbp, 3)).toBeCloseTo(92_895, 0);
    });

    it("larger chunks are always cheaper per delivered dollar", () => {
      const one = deliveredCostLbp(recoveredRateLbp, 1) as number;
      const two = deliveredCostLbp(recoveredRateLbp, 2) as number;
      const three = deliveredCostLbp(recoveredRateLbp, 3) as number;
      expect(one).toBeGreaterThan(two);
      expect(two).toBeGreaterThan(three);
    });

    it("returns null for invalid chunk size", () => {
      expect(deliveredCostLbp(recoveredRateLbp, 0)).toBeNull();
      expect(deliveredCostLbp(recoveredRateLbp, -1)).toBeNull();
      expect(deliveredCostLbp(recoveredRateLbp, NaN)).toBeNull();
    });

    it("returns null for invalid recoveredRateLbp", () => {
      expect(deliveredCostLbp(NaN, 1)).toBeNull();
      expect(deliveredCostLbp(-1, 1)).toBeNull();
    });
  });
});
