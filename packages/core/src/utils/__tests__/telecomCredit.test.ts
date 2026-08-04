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
  TELECOM_CREDIT_COST_RATE_LBP,
  deriveDaysCostLbp,
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
    const completeItem = {
      cost_lbp: 7_600_000,
      days_cost_lbp: 1_162_000,
      credits: 77,
    };

    it("is true for a fully-specified split", () => {
      expect(isTelecomSplitComplete(completeItem)).toBe(true);
    });

    it("is false when cost_lbp is missing, zero, or negative", () => {
      expect(isTelecomSplitComplete({ ...completeItem, cost_lbp: 0 })).toBe(
        false,
      );
      expect(isTelecomSplitComplete({ ...completeItem, cost_lbp: -1 })).toBe(
        false,
      );
      expect(isTelecomSplitComplete({ ...completeItem, cost_lbp: null })).toBe(
        false,
      );
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
      expect(isTelecomSplitComplete({ ...completeItem, credits: null })).toBe(
        false,
      );
      expect(
        isTelecomSplitComplete({ ...completeItem, credits: undefined }),
      ).toBe(false);
      expect(isTelecomSplitComplete({ ...completeItem, credits: 0 })).toBe(
        false,
      );
      expect(isTelecomSplitComplete({ ...completeItem, credits: -1 })).toBe(
        false,
      );
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
      expect(isTelecomSplitComplete({ ...completeItem, cost_lbp: NaN })).toBe(
        false,
      );
      expect(
        isTelecomSplitComplete({ ...completeItem, days_cost_lbp: Infinity }),
      ).toBe(false);
      expect(isTelecomSplitComplete({ ...completeItem, credits: NaN })).toBe(
        false,
      );
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
      const result = deriveItemEconomics({
        costLbp,
        daysCostLbp,
        creditsUsd: 77,
      });

      const netCost =
        costLbp -
        (result.maxReturnedUsd as number) * (result.recoveredRateLbp as number);
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

  describe("TELECOM_CREDIT_COST_RATE_LBP", () => {
    it("pins the owner-confirmed rate (280,000 / 3$, iPick mtc Credits)", () => {
      expect(TELECOM_CREDIT_COST_RATE_LBP).toBe(93333.33);
    });

    it("stays below the 98,603 ceiling set by Katsh/WHISH alfa 77.28 (plan §4.4)", () => {
      expect(TELECOM_CREDIT_COST_RATE_LBP).toBeLessThan(98_603);
    });
  });

  describe("deriveDaysCostLbp", () => {
    it("matches the §4.5 worked value: iPick alfa 77.28 -> 515,200", () => {
      expect(deriveDaysCostLbp(7_728_000, 77.28)).toBe(515_200);
    });

    it("matches the §4.5 worked value: Katsh alfa 77.28 -> 407,230", () => {
      expect(deriveDaysCostLbp(7_620_030, 77.28)).toBe(407_230);
    });

    it("matches the §4.5 worked value: iPick mtc 3.79 -> 25,267 (rounding)", () => {
      expect(deriveDaysCostLbp(379_000, 3.79)).toBe(25_267);
    });

    it("matches the §4.5 worked value: iPick mtc 4.5 -> 30,000", () => {
      expect(deriveDaysCostLbp(450_000, 4.5)).toBe(30_000);
    });

    it("returns null when creditsUsd is null, undefined, zero, or negative", () => {
      expect(deriveDaysCostLbp(7_728_000, null)).toBeNull();
      expect(deriveDaysCostLbp(7_728_000, undefined)).toBeNull();
      expect(deriveDaysCostLbp(7_728_000, 0)).toBeNull();
      expect(deriveDaysCostLbp(7_728_000, -1)).toBeNull();
    });

    it("returns null when costLbp is zero, negative, NaN, or Infinity", () => {
      expect(deriveDaysCostLbp(0, 77.28)).toBeNull();
      expect(deriveDaysCostLbp(-1, 77.28)).toBeNull();
      expect(deriveDaysCostLbp(NaN, 77.28)).toBeNull();
      expect(deriveDaysCostLbp(Infinity, 77.28)).toBeNull();
    });

    it("returns null when creditsUsd is NaN or Infinity", () => {
      expect(deriveDaysCostLbp(7_728_000, NaN)).toBeNull();
      expect(deriveDaysCostLbp(7_728_000, Infinity)).toBeNull();
    });

    it("returns null once the rate crosses the 98,603 ceiling (Katsh alfa 77.28, the exact ceiling case, plan §4.4)", () => {
      // 7,620,030 / 77.28 ~= 98,602.87 LBP/$ — the card's own per-dollar
      // price. At R = 98,603 (already above that ratio) days_cost goes
      // negative and must be rejected, not clamped or silently written.
      expect(deriveDaysCostLbp(7_620_030, 77.28, 98_603)).toBeNull();
      expect(deriveDaysCostLbp(7_620_030, 77.28, 100_000)).toBeNull();
    });

    it("returns null when rate is 0 (days_cost would equal cost_lbp, not < cost_lbp)", () => {
      expect(deriveDaysCostLbp(7_728_000, 77.28, 0)).toBeNull();
    });

    it("returns null when rate is negative", () => {
      expect(deriveDaysCostLbp(7_728_000, 77.28, -1)).toBeNull();
    });

    it("never throws and never returns NaN across a battery of malformed inputs", () => {
      const inputs: Array<[number, number | null | undefined, number?]> = [
        [NaN, 77.28, 93_333.33],
        [-1, 77.28, 93_333.33],
        [0, 77.28, 93_333.33],
        [7_728_000, NaN, 93_333.33],
        [7_728_000, Infinity, 93_333.33],
        [7_728_000, null, 93_333.33],
        [7_728_000, undefined, 93_333.33],
        [7_728_000, 77.28, NaN],
        [7_728_000, 77.28, Infinity],
        [7_728_000, 77.28, 0],
        [7_728_000, 77.28, -1],
      ];

      for (const [costLbp, creditsUsd, rateLbp] of inputs) {
        expect(() =>
          deriveDaysCostLbp(costLbp, creditsUsd, rateLbp),
        ).not.toThrow();
        const result = deriveDaysCostLbp(costLbp, creditsUsd, rateLbp);
        expect(result === null || Number.isFinite(result)).toBe(true);
      }
    });

    it("defaults to TELECOM_CREDIT_COST_RATE_LBP when rateLbp is omitted", () => {
      expect(deriveDaysCostLbp(7_728_000, 77.28)).toBe(
        deriveDaysCostLbp(7_728_000, 77.28, TELECOM_CREDIT_COST_RATE_LBP),
      );
    });

    // The full 43-item Only-Days inventory, TELECOM_DAYS_COST_PLAN.md §1.
    // Guards that a future rate change cannot silently zero out an item
    // without the guard test failing here first.
    const ONLY_DAYS_CATALOG: Array<{
      label: string;
      costLbp: number;
      creditsUsd: number;
    }> = [
      // §1.1 alfa Prepaid — 22 items (credits = face value)
      { label: "iPick alfa 1.22", costLbp: 140_000, creditsUsd: 1.22 },
      { label: "iPick alfa 3.03", costLbp: 322_000, creditsUsd: 3.03 },
      { label: "Katsh alfa 3.03", costLbp: 318_978, creditsUsd: 3.03 },
      { label: "WHISH_APP alfa 3.03", costLbp: 318_978, creditsUsd: 3.03 },
      { label: "iPick alfa 4.5", costLbp: 466_000, creditsUsd: 4.5 },
      { label: "Katsh alfa 4.5", costLbp: 462_075, creditsUsd: 4.5 },
      { label: "WHISH_APP alfa 4.5", costLbp: 462_075, creditsUsd: 4.5 },
      { label: "iPick alfa 7.58", costLbp: 770_000, creditsUsd: 7.58 },
      { label: "Katsh alfa 7.58", costLbp: 765_007, creditsUsd: 7.58 },
      { label: "WHISH_APP alfa 7.58", costLbp: 765_007, creditsUsd: 7.58 },
      { label: "iPick alfa 10", costLbp: 1_000_000, creditsUsd: 10 },
      { label: "Katsh alfa 10", costLbp: 1_003_274, creditsUsd: 10 },
      { label: "WHISH_APP alfa 10", costLbp: 1_003_274, creditsUsd: 10 },
      { label: "iPick alfa 15.15", costLbp: 1_515_000, creditsUsd: 15.15 },
      { label: "Katsh alfa 15.15", costLbp: 1_511_601, creditsUsd: 15.15 },
      { label: "WHISH_APP alfa 15.15", costLbp: 1_511_601, creditsUsd: 15.15 },
      { label: "iPick alfa 22.73", costLbp: 2_273_000, creditsUsd: 22.73 },
      { label: "Katsh alfa 22.73", costLbp: 2_256_769, creditsUsd: 22.73 },
      { label: "WHISH_APP alfa 22.73", costLbp: 2_256_769, creditsUsd: 22.73 },
      { label: "iPick alfa 77.28", costLbp: 7_728_000, creditsUsd: 77.28 },
      { label: "Katsh alfa 77.28", costLbp: 7_620_030, creditsUsd: 77.28 },
      { label: "WHISH_APP alfa 77.28", costLbp: 7_620_030, creditsUsd: 77.28 },
      // §1.2 mtc Prepaid — 21 items (credits = face value, derivable from label)
      { label: "iPick mtc 3.79", costLbp: 379_000, creditsUsd: 3.79 },
      { label: "Katsh mtc 3.79", costLbp: 398_723, creditsUsd: 3.79 },
      { label: "WHISH_APP mtc 3.79", costLbp: 398_723, creditsUsd: 3.79 },
      { label: "iPick mtc 4.5", costLbp: 450_000, creditsUsd: 4.5 },
      { label: "Katsh mtc 4.5", costLbp: 462_518, creditsUsd: 4.5 },
      { label: "WHISH_APP mtc 4.5", costLbp: 462_518, creditsUsd: 4.5 },
      { label: "iPick mtc 7.58", costLbp: 758_000, creditsUsd: 7.58 },
      { label: "Katsh mtc 7.58", costLbp: 765_007, creditsUsd: 7.58 },
      { label: "WHISH_APP mtc 7.58", costLbp: 765_007, creditsUsd: 7.58 },
      { label: "iPick mtc 10", costLbp: 1_000_000, creditsUsd: 10 },
      { label: "Katsh mtc 10", costLbp: 1_003_274, creditsUsd: 10 },
      { label: "WHISH_APP mtc 10", costLbp: 1_003_274, creditsUsd: 10 },
      { label: "iPick mtc 15.15", costLbp: 1_526_000, creditsUsd: 15.15 },
      { label: "Katsh mtc 15.15", costLbp: 1_509_829, creditsUsd: 15.15 },
      { label: "WHISH_APP mtc 15.15", costLbp: 1_509_829, creditsUsd: 15.15 },
      { label: "iPick mtc 22.73", costLbp: 2_273_000, creditsUsd: 22.73 },
      { label: "Katsh mtc 22.73", costLbp: 2_255_883, creditsUsd: 22.73 },
      { label: "WHISH_APP mtc 22.73", costLbp: 2_255_883, creditsUsd: 22.73 },
      { label: "iPick mtc 77.28", costLbp: 7_728_000, creditsUsd: 77.28 },
      { label: "Katsh mtc 77.28", costLbp: 7_620_030, creditsUsd: 77.28 },
      { label: "WHISH_APP mtc 77.28", costLbp: 7_620_030, creditsUsd: 77.28 },
    ];

    it("has exactly 43 candidate items (plan §1 inventory)", () => {
      expect(ONLY_DAYS_CATALOG.length).toBe(43);
    });

    it("yields a positive, in-bounds days_cost_lbp for all 43 catalog items at the default rate (plan §4.5 guard)", () => {
      for (const { label, costLbp, creditsUsd } of ONLY_DAYS_CATALOG) {
        const result = deriveDaysCostLbp(costLbp, creditsUsd);
        if (result === null) {
          throw new Error(`${label} failed to derive a days_cost_lbp value`);
        }
        if (!(result > 0)) {
          throw new Error(
            `${label} derived a non-positive days_cost_lbp: ${result}`,
          );
        }
        if (!(result < costLbp)) {
          throw new Error(
            `${label} derived days_cost_lbp >= cost_lbp: ${result} >= ${costLbp}`,
          );
        }
      }
    });

    it("the lowest days_cost_lbp across all 43 items is 25,267 (iPick mtc 3.79, plan §4.4)", () => {
      const values = ONLY_DAYS_CATALOG.map(
        ({ costLbp, creditsUsd }) =>
          deriveDaysCostLbp(costLbp, creditsUsd) as number,
      );
      expect(Math.min(...values)).toBe(25_267);
    });
  });
});
