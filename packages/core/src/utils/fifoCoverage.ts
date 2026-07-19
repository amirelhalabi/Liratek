/**
 * CQ-2 (COUNTERPARTY_CONSOLIDATION_PLAN.md) — the ONE pure FIFO allocation
 * function. Five call sites used to hand-roll "walk open rows oldest-first,
 * clamp take = min(remaining, outstanding)" independently:
 *
 *   - DebtRepository._markSalesPaidFIFO          (sales.paid_usd, USD)
 *   - DebtRepository._coverServiceDebtsFIFO       (debt_ledger.covered_usd/lbp,
 *     dual-currency — calls this function twice, once per currency, and
 *     merges the two results into one UPDATE per row)
 *   - PartnerRepository.applySettlementCoverage   (partner_ledger.covered_amount)
 *   - SupplierRepository._applyPurchaseFifoCoverage (supplier_purchases.paid_usd)
 *   - SupplierPurchaseRepository.applyFifoPayment   (same table as above —
 *     previously a zero-caller duplicate of the same algorithm)
 *
 * This module is PURE MATH ONLY — no DB access, no imports. Each call site
 * keeps its own SQL for selecting the open rows and applying the UPDATE
 * (rule 13 + the CQ-2 plan's principle #3: "consolidate BEHAVIOR, not
 * STORAGE"); only the allocation algorithm and its tolerance handling live
 * here.
 *
 * `epsilon` is deliberately NOT homogenized across call sites — each site
 * passes its own pre-existing tolerance so behavior stays byte-identical to
 * what it replaces:
 *
 *   | Site                                          | epsilon | Unit                |
 *   | ---------------------------------------------- | ------- | -------------------- |
 *   | DebtRepository._markSalesPaidFIFO               | 0.01    | USD                  |
 *   | DebtRepository._coverServiceDebtsFIFO (USD pass) | 0.005   | USD                  |
 *   | DebtRepository._coverServiceDebtsFIFO (LBP pass) | 1       | LBP                  |
 *   | PartnerRepository.applySettlementCoverage        | 0.005   | single amount column |
 *   | SupplierRepository._applyPurchaseFifoCoverage    | 0       | USD (exact)          |
 *   | SupplierPurchaseRepository.applyFifoPayment      | 0       | USD (exact)          |
 */

/** One row still open for coverage — how much of it is left uncovered. */
export interface FifoOpenRow {
  /** Row identifier, passed through unchanged so the caller can map takes back to its own UPDATE. */
  id: number | string;
  /** Outstanding amount on this row (amount − already covered). May be ≤ 0 (already fully covered / bad data) — such rows are skipped, never negatively applied. */
  outstanding: number;
}

/** How much budget a specific row absorbed. Always present with `take` strictly greater than the caller's epsilon. */
export interface FifoTake {
  id: number | string;
  take: number;
}

/**
 * Allocate `budget` across `open` rows, oldest-first (the caller is
 * responsible for ordering `open` — this function never reorders), clamping
 * each row's take at its outstanding balance.
 *
 * - Stops as soon as the remaining budget drops to `epsilon` or below.
 * - Skips (without consuming budget) any row whose computed take would be
 *   `epsilon` or below — this also covers rows with zero/negative
 *   outstanding, and rows encountered after the budget is effectively spent.
 * - Returns only the rows that received a real allocation, in the same
 *   relative order as `open`. The caller can derive the unconsumed remainder
 *   as `budget - takes.reduce((s, t) => s + t.take, 0)`.
 *
 * `budget <= 0` (or `<= epsilon`) and `open.length === 0` both return `[]`
 * with no iteration.
 */
export function allocateFifo(
  open: FifoOpenRow[],
  budget: number,
  epsilon = 0.005,
): FifoTake[] {
  const takes: FifoTake[] = [];
  let remaining = budget;
  if (remaining <= epsilon) return takes;

  for (const row of open) {
    if (remaining <= epsilon) break;
    const take = Math.min(remaining, row.outstanding);
    if (take <= epsilon) continue;
    takes.push({ id: row.id, take });
    remaining -= take;
  }

  return takes;
}
