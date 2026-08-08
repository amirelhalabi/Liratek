/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md D6 — the ONE largest-remainder
 * proportional allocator (rule 14). Splits a fixed `total` across weighted
 * rows so each row's share is proportional to its own weight, while
 * guaranteeing the shares SUM to `total` EXACTLY — independent per-row
 * rounding (`Math.round(weight / totalWeight * total)`) can be off by a
 * cent/LBP because each row rounds without knowing what the others did;
 * largest-remainder (floor every share, then hand the leftover units to the
 * rows with the biggest fractional remainder, largest first) is the standard
 * fix and is the only allocator `SupplierRepository.settleTransactions` uses
 * to split an entered commission across the settled `financial_services`
 * rows.
 *
 * PURE MATH ONLY — no DB access, no imports (mirrors utils/fifoCoverage.ts's
 * own rule: consolidate the ALGORITHM, let each call site keep its own SQL).
 *
 * `unit` is the smallest indivisible increment of `total`'s currency — 0.01
 * for USD (cents), 1 for LBP (no fractional LBP). Rows are allocated in
 * `unit`-sized integer steps internally so the remainder distribution is
 * exact regardless of floating-point weight noise.
 *
 * Equal-weight fallback: when every row's weight is ~0 (e.g. a BILLS-only
 * settlement batch — a bill's principal never touches supplier_ledger, so
 * every row's "gross owed" weight is 0; COMMISSION_AT_SETTLEMENT_PLAN.md's
 * "bills settlement note") the split degrades to an equal share per row
 * (weight 1 each) instead of 0/0 → NaN for every row. Negative row weights
 * are clamped to 0 (a malformed/negative supplier_owed row still gets a
 * well-defined — zero, or equal-fallback — share rather than corrupting the
 * proportion for every other row).
 */

export interface WeightedAllocationRow {
  /** Row identifier, passed through unchanged so the caller can map shares back to its own INSERT/UPDATE. */
  id: number | string;
  /** This row's share of `total` is proportional to this weight (any non-negative number; 0 is valid). */
  weight: number;
}

/** One row's exact share of `total`. Always present — D6 requires ONE allocation row per settled fs row, even a $0 share. */
export interface AllocationShare {
  id: number | string;
  amount: number;
}

/**
 * Allocate `total` across `rows` proportionally to each row's `weight`,
 * rounded to `unit`-sized increments, with the shares summing to `total`
 * EXACTLY (largest-remainder). Returns one share per input row, in the same
 * order — including rows with a 0 weight and/or a 0 resulting share.
 *
 * `rows.length === 0` returns `[]`. A `total` within half a `unit` of 0 (or
 * non-finite) returns every row at 0 without dividing by the weight sum —
 * avoids a spurious NaN/±0 split when there is nothing to allocate.
 */
export function allocateProportional(
  rows: WeightedAllocationRow[],
  total: number,
  unit: number,
): AllocationShare[] {
  if (rows.length === 0) return [];
  if (!Number.isFinite(total) || Math.abs(total) < unit / 2) {
    return rows.map((r) => ({ id: r.id, amount: 0 }));
  }

  const sign = total < 0 ? -1 : 1;
  const totalUnits = Math.round(Math.abs(total) / unit);
  if (totalUnits === 0) return rows.map((r) => ({ id: r.id, amount: 0 }));

  const clampedWeights = rows.map((r) => Math.max(0, r.weight || 0));
  const weightSum = clampedWeights.reduce((s, w) => s + w, 0);
  // Equal-weight fallback (every row weighted 1) when the batch's real
  // weights are all ~0 — e.g. a bills-only batch, where "gross owed" is 0
  // for every row by design.
  const effectiveWeights = weightSum > 0 ? clampedWeights : rows.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : rows.length;

  const rawShareUnits = effectiveWeights.map(
    (w) => (w / effectiveSum) * totalUnits,
  );
  const flooredUnits = rawShareUnits.map((v) => Math.floor(v));
  const flooredSum = flooredUnits.reduce((s, v) => s + v, 0);
  const remainderUnits = totalUnits - flooredSum;

  // Largest fractional remainder first; original index breaks ties so the
  // distribution is deterministic (equal-weight fallback produces identical
  // fractions for every row).
  const byRemainder = rawShareUnits
    .map((v, i) => ({ i, frac: v - flooredUnits[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const shareUnits = [...flooredUnits];
  for (let k = 0; k < remainderUnits && k < byRemainder.length; k++) {
    shareUnits[byRemainder[k].i] += 1;
  }

  return rows.map((r, i) => ({
    id: r.id,
    amount: sign * shareUnits[i] * unit,
  }));
}
