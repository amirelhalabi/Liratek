/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md D6 — dedicated unit tests for the
 * largest-remainder proportional allocator (`allocateProportional`,
 * utils/largestRemainder.ts). This is the ONE allocator
 * `SupplierRepository.settleTransactions` uses to split an entered
 * commission across the settled `financial_services` rows; these tests pin
 * the pure-math contract in isolation (no DB) — the exact-sum guarantee,
 * the equal-weight fallback (bills-only batches, where every row's gross
 * weight is 0), 3-way odd-lump splits, and LBP (whole-unit) rounding.
 */

import { allocateProportional } from "../largestRemainder";

describe("allocateProportional", () => {
  it("returns [] for an empty row list", () => {
    expect(allocateProportional([], 100, 0.01)).toEqual([]);
  });

  it("returns a 0 share per row when total is 0", () => {
    const shares = allocateProportional(
      [
        { id: 1, weight: 10 },
        { id: 2, weight: 20 },
      ],
      0,
      0.01,
    );
    expect(shares).toEqual([
      { id: 1, amount: 0 },
      { id: 2, amount: 0 },
    ]);
  });

  it("returns a 0 share per row when total is within half a unit of 0", () => {
    const shares = allocateProportional(
      [
        { id: 1, weight: 5 },
        { id: 2, weight: 5 },
      ],
      0.004, // < 0.005 (half of the USD cent unit)
      0.01,
    );
    expect(shares.every((s) => s.amount === 0)).toBe(true);
  });

  // ── Exact-sum guarantee (the whole point of largest-remainder) ─────────────

  it("USD: shares always sum to the exact entered total, never off by a cent", () => {
    const rows = [
      { id: 1, weight: 33 },
      { id: 2, weight: 33 },
      { id: 3, weight: 34 },
    ];
    const shares = allocateProportional(rows, 100, 0.01);
    const sum = shares.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBeCloseTo(100, 10);
  });

  it("odd lump ($10.01 across 3 equal-weight rows) — largest remainder breaks the tie deterministically", () => {
    // 1001 cents / 3 = 333.67 each → floor 333,333,333 = 999, remainder 2 cents
    // → the first two rows (by index, ties broken by original order) get +1 cent.
    const rows = [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 },
    ];
    const shares = allocateProportional(rows, 10.01, 0.01);
    const sum = shares.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBeCloseTo(10.01, 10);
    // Two rows get 3.34, one gets 3.33 (or the equivalent distribution) —
    // whichever two absorb the remainder, the multiset of amounts must be
    // exactly [3.34, 3.34, 3.33] in some order.
    const sorted = shares.map((s) => Number(s.amount.toFixed(2))).sort();
    expect(sorted).toEqual([3.33, 3.34, 3.34]);
  });

  // ── 3-way splits ───────────────────────────────────────────────────────────

  it("3-way equal-weight split of an amount not divisible by 3 (USD)", () => {
    const rows = [
      { id: 1, weight: 1 },
      { id: 2, weight: 1 },
      { id: 3, weight: 1 },
    ];
    const shares = allocateProportional(rows, 1, 0.01); // $1.00 / 3
    const sum = shares.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBeCloseTo(1, 10);
    const sorted = shares.map((s) => Number(s.amount.toFixed(2))).sort();
    // 100 cents / 3 → 34, 33, 33
    expect(sorted).toEqual([0.33, 0.33, 0.34]);
  });

  it("3-way WEIGHTED split (proportional to gross owed) sums exactly", () => {
    const rows = [
      { id: 1, weight: 100 }, // 50%
      { id: 2, weight: 60 }, // 30%
      { id: 3, weight: 40 }, // 20%
    ];
    const shares = allocateProportional(rows, 33.33, 0.01);
    const sum = shares.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBeCloseTo(33.33, 10);
    const byId = new Map(shares.map((s) => [s.id, s.amount]));
    // Roughly 50/30/20 of 33.33 — exact cent-level split may absorb rounding
    // on any one row, but each should land within a cent of its ideal share.
    expect(byId.get(1)!).toBeCloseTo(16.67, 1);
    expect(byId.get(2)!).toBeCloseTo(10.0, 1);
    expect(byId.get(3)!).toBeCloseTo(6.67, 1);
  });

  // ── LBP (whole-unit currency, no fractional remainder possible) ────────────

  it("LBP: 3-way equal split of 100 LBP (not divisible by 3) sums exactly, no fractional LBP", () => {
    const rows = [
      { id: 1, weight: 1 },
      { id: 2, weight: 1 },
      { id: 3, weight: 1 },
    ];
    const shares = allocateProportional(rows, 100, 1);
    const sum = shares.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBe(100);
    for (const s of shares) {
      expect(Number.isInteger(s.amount)).toBe(true);
    }
    const sorted = shares.map((s) => s.amount).sort((a, b) => a - b);
    expect(sorted).toEqual([33, 33, 34]);
  });

  it("LBP: weighted split of a bill-commission-sized lump (e.g. 3 bills × 20,000 = 60,000)", () => {
    const rows = [
      { id: 1, weight: 1 },
      { id: 2, weight: 1 },
      { id: 3, weight: 1 },
    ];
    const shares = allocateProportional(rows, 60000, 1);
    expect(shares).toEqual([
      { id: 1, amount: 20000 },
      { id: 2, amount: 20000 },
      { id: 3, amount: 20000 },
    ]);
  });

  // ── Equal-weight fallback (bills-only batch: every row's gross weight is 0) ─

  it("falls back to an equal split when every row's weight is 0 (bills-only batch)", () => {
    const rows = [
      { id: 1, weight: 0 },
      { id: 2, weight: 0 },
      { id: 3, weight: 0 },
    ];
    const shares = allocateProportional(rows, 60000, 1);
    expect(shares).toEqual([
      { id: 1, amount: 20000 },
      { id: 2, amount: 20000 },
      { id: 3, amount: 20000 },
    ]);
  });

  it("does NOT fall back when at least one row has a positive weight — zero-weight rows get 0", () => {
    const rows = [
      { id: 1, weight: 50 },
      { id: 2, weight: 0 },
    ];
    const shares = allocateProportional(rows, 10, 0.01);
    const byId = new Map(shares.map((s) => [s.id, s.amount]));
    expect(byId.get(1)).toBeCloseTo(10, 2);
    expect(byId.get(2)).toBe(0);
  });

  // ── Negative row weights are clamped, never corrupt the proportion ────────

  it("clamps a negative weight to 0 rather than reducing another row's share", () => {
    const rows = [
      { id: 1, weight: 100 },
      { id: 2, weight: -50 },
    ];
    const shares = allocateProportional(rows, 100, 0.01);
    const byId = new Map(shares.map((s) => [s.id, s.amount]));
    expect(byId.get(1)).toBeCloseTo(100, 2);
    expect(byId.get(2)).toBe(0);
  });

  // ── Negative total (rare, but must stay sign-consistent) ──────────────────

  it("a negative total distributes negative shares that still sum exactly", () => {
    const rows = [
      { id: 1, weight: 1 },
      { id: 2, weight: 1 },
      { id: 3, weight: 1 },
    ];
    const shares = allocateProportional(rows, -100, 1);
    const sum = shares.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBe(-100);
    for (const s of shares) expect(s.amount).toBeLessThanOrEqual(0);
  });
});
