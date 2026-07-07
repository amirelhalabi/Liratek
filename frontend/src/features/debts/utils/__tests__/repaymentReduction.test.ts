import { computeRepaymentReduction } from "../repaymentReduction";

/**
 * Guards the gross-vs-net double-count fix (see repaymentReduction.ts header).
 *
 * Scenario mirrors lira-096 under the buy rate (89,000): a $30 debt paid with
 * $10 cash + 1,800,000 LBP. At the buy rate 1,800,000 LBP = $20.2247, so the
 * customer overpays by ~$0.22, handed back as ~20,000 LBP change. The debt
 * must clear to EXACTLY $0 — the returned change must not ALSO reduce the debt.
 */
const RATE = 89_000; // buy rate

describe("computeRepaymentReduction", () => {
  it("overpayment with LBP change clears the debt exactly (no phantom credit)", () => {
    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: 10,
      paidLbp: 1_800_000,
      returnedUsd: 0,
      returnedLbp: 20_000, // change handed back in LBP
      dueUsd: 30,
      dueLbp: 0,
      rate: RATE,
    });
    // Net LBP kept = 1,780,000 = $20 exactly → $10 + $20 = $30 → debt clears.
    expect(reduceUsd).toBeCloseTo(30, 2);
    expect(reduceLbp).toBe(0);
  });

  it("does NOT over-reduce: reduction never exceeds the debt when change is returned", () => {
    const { reduceUsd } = computeRepaymentReduction({
      paidUsd: 10,
      paidLbp: 1_800_000,
      returnedUsd: 0,
      returnedLbp: 20_000,
      dueUsd: 30,
      dueLbp: 0,
      rate: RATE,
    });
    // Pre-fix (change not netted) this was 30.2247 → a $0.22 phantom credit.
    expect(reduceUsd).toBeLessThanOrEqual(30.01);
  });

  it("exact settlement (no change) is unchanged", () => {
    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: 10,
      paidLbp: 1_780_000, // exactly $20 at the buy rate
      returnedUsd: 0,
      returnedLbp: 0,
      dueUsd: 30,
      dueLbp: 0,
      rate: RATE,
    });
    expect(reduceUsd).toBeCloseTo(30, 2);
    expect(reduceLbp).toBe(0);
  });

  it("nets change returned in USD too", () => {
    const { reduceUsd } = computeRepaymentReduction({
      paidUsd: 10.22, // customer handed $10.22
      paidLbp: 1_780_000,
      returnedUsd: 0.22, // $0.22 handed back
      returnedLbp: 0,
      dueUsd: 30,
      dueLbp: 0,
      rate: RATE,
    });
    // Net USD kept = $10 → $10 + $20 = $30 → clears, no over-reduction.
    expect(reduceUsd).toBeCloseTo(30, 2);
  });

  it("a genuine (unreturned) overpayment still over-reduces into a credit", () => {
    // No change leg → the customer really did overpay and keeps a credit.
    const { reduceUsd } = computeRepaymentReduction({
      paidUsd: 10,
      paidLbp: 1_800_000,
      returnedUsd: 0,
      returnedLbp: 0,
      dueUsd: 30,
      dueLbp: 0,
      rate: RATE,
    });
    expect(reduceUsd).toBeGreaterThan(30); // ≈ 30.2247, a legitimate credit
  });
});
