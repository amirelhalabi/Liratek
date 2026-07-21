import {
  computeRepaymentReduction,
  applyDebtDiscount,
} from "../repaymentReduction";

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

describe("cross-currency change netting (the header's promise: 'both are netted')", () => {
  // Owner-reported (2026-07-20): debt due $30. Customer pays $40 cash, shop
  // returns 900,000 LBP as change (rate 90,000 = exactly $10). Pre-fix, the
  // LBP return only nets against LBP paid (0), so the $10 given back in a
  // DIFFERENT currency than it was tendered in is dropped entirely and the
  // full $40 clears the $30 debt — a $10 phantom customer credit.
  const RATE = 90_000;

  it("owner scenario: LBP change against USD-only payment nets to the exact due", () => {
    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: 40,
      paidLbp: 0,
      returnedUsd: 0,
      returnedLbp: 900_000, // = $10 at RATE, change for a currency never tendered
      dueUsd: 30,
      dueLbp: 0,
      rate: RATE,
    });
    expect(reduceUsd).toBeCloseTo(30, 5);
    expect(reduceLbp).toBe(0);
  });

  it("mirror: USD change against LBP-only payment nets to the exact due", () => {
    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: 0,
      paidLbp: 3_600_000,
      returnedUsd: 10, // = 900,000 LBP at RATE
      returnedLbp: 0,
      dueUsd: 0,
      dueLbp: 2_700_000,
      rate: RATE,
    });
    expect(reduceUsd).toBe(0);
    expect(reduceLbp).toBeCloseTo(2_700_000, 5);
  });

  it("control: same-currency change (already correct pre-fix) still nets correctly", () => {
    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: 40,
      paidLbp: 0,
      returnedUsd: 10,
      returnedLbp: 0,
      dueUsd: 30,
      dueLbp: 0,
      rate: RATE,
    });
    expect(reduceUsd).toBeCloseTo(30, 5);
    expect(reduceLbp).toBe(0);
  });

  it("degenerate: change returned (in any mix of currencies) worth more than was paid never reduces the debt by a negative amount", () => {
    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: 5,
      paidLbp: 0,
      returnedUsd: 0,
      returnedLbp: 900_000, // worth $10 at RATE — more than the $5 paid
      dueUsd: 30,
      dueLbp: 0,
      rate: RATE,
    });
    expect(reduceUsd).toBe(0);
    expect(reduceLbp).toBe(0);
  });

  it("cross-currency netting cascades into the leftover-USD branch when both currencies are due", () => {
    // Due in BOTH currencies, paid all-USD, change given in LBP. netUsd
    // collapses from 40 to 30 first (LBP deficit settled against it), THEN
    // the existing leftover-USD branch (line ~63) spills the remainder into
    // the LBP due — proving the two mechanisms compose correctly.
    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: 40,
      paidLbp: 0,
      returnedUsd: 0,
      returnedLbp: 900_000, // = $10 at RATE
      dueUsd: 20,
      dueLbp: 900_000,
      rate: RATE,
    });
    expect(reduceUsd).toBeCloseTo(20, 5);
    expect(reduceLbp).toBeCloseTo(900_000, 5);
  });

  it("smart-rounding branch is unaffected when there is no cross-currency return", () => {
    // No returns at all — this must behave identically before and after the
    // netting fix, proving the fix doesn't disturb the existing LBP-remainder
    // smart-rounding logic (paying the rounded fractional part in LBP clears
    // the exact fractional USD debt).
    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: 10,
      paidLbp: 25_000, // rounded fractional part of $0.25 @ RATE
      returnedUsd: 0,
      returnedLbp: 0,
      dueUsd: 10.25,
      dueLbp: 0,
      rate: RATE,
    });
    expect(reduceUsd).toBeCloseTo(10.25, 5);
    expect(reduceLbp).toBe(0);
  });
});

describe("applyDebtDiscount", () => {
  it("caps the discount per currency at what's actually due", () => {
    const result = applyDebtDiscount({
      dueUsd: 50,
      dueLbp: 100_000,
      discountUsd: 80, // more than owed
      discountLbp: 40_000,
    });
    expect(result.appliedDiscountUsd).toBe(50);
    expect(result.appliedDiscountLbp).toBe(40_000);
    expect(result.remainingDueUsd).toBe(0);
    expect(result.remainingDueLbp).toBe(60_000);
  });

  it("zero discount leaves the due unchanged", () => {
    const result = applyDebtDiscount({
      dueUsd: 30,
      dueLbp: 500_000,
      discountUsd: 0,
      discountLbp: 0,
    });
    expect(result.remainingDueUsd).toBe(30);
    expect(result.remainingDueLbp).toBe(500_000);
    expect(result.appliedDiscountUsd).toBe(0);
    expect(result.appliedDiscountLbp).toBe(0);
  });

  it("treats a negative (malformed) discount input as zero", () => {
    const result = applyDebtDiscount({
      dueUsd: 30,
      dueLbp: 0,
      discountUsd: -10,
      discountLbp: 0,
    });
    expect(result.appliedDiscountUsd).toBe(0);
    expect(result.remainingDueUsd).toBe(30);
  });

  it("each currency is capped independently (USD overshoot doesn't leak into LBP)", () => {
    const result = applyDebtDiscount({
      dueUsd: 10,
      dueLbp: 200_000,
      discountUsd: 999,
      discountLbp: 0,
    });
    expect(result.appliedDiscountUsd).toBe(10);
    expect(result.appliedDiscountLbp).toBe(0);
    expect(result.remainingDueLbp).toBe(200_000);
  });
});

describe("applyDebtDiscount + computeRepaymentReduction combined (advisor-flagged seam)", () => {
  // Regression for the exact bug the advisor's review caught: feeding the
  // RAW due (instead of the discount-adjusted remainingDue) into
  // computeRepaymentReduction lets a payment + a separately-posted discount
  // double-dip past the original debt, pushing the ledger into a phantom
  // credit. This proves the fixed call shape (remainingDue in) nets exactly
  // to the original due, and demonstrates the raw-due variant overshooting —
  // per rule 17, the guard is shown failing against the buggy shape first.
  const RATE2 = 89_000;
  const dueLbp = 100_000; // LBP-only debt
  const discountLbp = 30_000; // shop forgives 30k LBP
  const paidUsd = 10; // customer pays $10 cash (worth 890,000 LBP @ RATE2)

  it("FIXED: remainingDue (post-discount) in → payment + discount nets exactly to the original due", () => {
    const { remainingDueUsd, remainingDueLbp, appliedDiscountLbp } =
      applyDebtDiscount({
        dueUsd: 0,
        dueLbp,
        discountUsd: 0,
        discountLbp,
      });

    const { reduceLbp } = computeRepaymentReduction({
      paidUsd,
      paidLbp: 0,
      returnedUsd: 0,
      returnedLbp: 0,
      dueUsd: remainingDueUsd,
      dueLbp: remainingDueLbp,
      rate: RATE2,
    });

    expect(reduceLbp + appliedDiscountLbp).toBeCloseTo(dueLbp, 5);
  });

  it("BUGGY (documented, not the shipped call shape): raw due in → payment + discount overshoots into a phantom credit", () => {
    const { appliedDiscountLbp } = applyDebtDiscount({
      dueUsd: 0,
      dueLbp,
      discountUsd: 0,
      discountLbp,
    });

    // The bug: pass the RAW due instead of remainingDue.
    const { reduceLbp } = computeRepaymentReduction({
      paidUsd,
      paidLbp: 0,
      returnedUsd: 0,
      returnedLbp: 0,
      dueUsd: 0,
      dueLbp, // raw, undiscounted — the mistake
      rate: RATE2,
    });

    // Payment alone already clears the full raw due (the $10 tender is worth
    // far more than 100,000 LBP at this rate), so adding the discount on top
    // overshoots past the original debt — proving why raw due is unsafe.
    expect(reduceLbp + appliedDiscountLbp).toBeGreaterThan(dueLbp);
  });
});
