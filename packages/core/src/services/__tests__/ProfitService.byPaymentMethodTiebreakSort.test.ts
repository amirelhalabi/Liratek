/**
 * ProfitService.getByPaymentMethod — LPAY-V11 (OWNER_NOTES_2026-09-21.md
 * §6.5 PA-3.5 review, round 3): a unit test for the USD-then-LBP tiebreak
 * sort (LPAY-R3-6, round 3) — `results.sort((a, b) => b.total_usd -
 * a.total_usd || b.total_lbp - a.total_lbp)`. This sort landed in round 3
 * with no dedicated test of its own; this file closes that gap.
 *
 * Uses the same mocked-repository pattern as
 * `ProfitService.getByPaymentMethod.errorPropagation.test.ts` (SOLID/DIP —
 * the service is unit-tested against a fake repo, no database involved).
 *
 * Rule 17 proof (RED observed before GREEN) — ACTUALLY RUN
 * (`npx jest ProfitService.byPaymentMethodTiebreakSort.test.ts --maxWorkers=1`
 * from `packages/core`) against `getByPaymentMethod` with the tiebreak
 * clause temporarily reduced to `results.sort((a, b) => b.total_usd -
 * a.total_usd)` (USD-only, dropping `|| b.total_lbp - a.total_lbp` — Edit
 * tool, this lane's own uncommitted change only, restored immediately
 * after). Verbatim jest output for the one case that went red:
 *
 *   "breaks a USD tie by total_lbp, descending"
 *     expect(received).toEqual(expected) // deep equality
 *     - Expected  - 1
 *     + Received  + 1
 *       Array [
 *     -   "B_HIGH_LBP",
 *         "A_LOW_LBP",
 *     +   "B_HIGH_LBP",
 *         "C_ZERO",
 *       ]
 *
 * (insertion order preserved for the tied USD=0 pair when there is no
 * secondary sort key — A_LOW_LBP was inserted before B_HIGH_LBP in the
 * mocked repo's return array, and `Array.prototype.sort`'s stability kept
 * that order under a comparator that returns 0 for the tie). The other two
 * cases in this file PASSED even pre-fix — they never tie on `total_usd`,
 * so they never exercise the missing clause. After restoring `||
 * b.total_lbp - a.total_lbp`, all three passed.
 */

import { ProfitService } from "../ProfitService";
import type { ProfitRepository } from "../../repositories/ProfitRepository";

function makeRepo(
  rows: Array<{ method: string; total_usd: number; total_lbp: number }>,
): ProfitRepository {
  return {
    getPaymentMethodRows: jest.fn(() =>
      rows.map((r) => ({
        ...r,
        debt_repayment_usd: 0,
        debt_repayment_lbp: 0,
        count: 1,
        pending_commission_usd: 0,
        is_settled: 1,
      })),
    ),
    getRealizedCommissionTotals: jest.fn(() => ({
      total_usd: 0,
      total_lbp: 0,
      count: 0,
    })),
    getPendingCommissionTotals: jest.fn(() => ({
      total_usd: 0,
      total_lbp: 0,
      count: 0,
      awaiting_settlement_count: 0,
    })),
    getPendingCommissionByProvider: jest.fn(() => []),
  } as unknown as ProfitRepository;
}

describe("ProfitService.getByPaymentMethod — USD-then-LBP tiebreak sort (LPAY-V11)", () => {
  it("sorts by total_usd descending first", () => {
    const repo = makeRepo([
      { method: "LOW_USD", total_usd: 10, total_lbp: 9_000_000 },
      { method: "HIGH_USD", total_usd: 100, total_lbp: 0 },
    ]);
    const service = new ProfitService(repo);

    const rows = service.getByPaymentMethod("2026-07-01", "2026-07-01");
    expect(rows.map((r) => r.method)).toEqual(["HIGH_USD", "LOW_USD"]);
  });

  it("breaks a USD tie by total_lbp, descending", () => {
    const repo = makeRepo([
      // Inserted in an order that would survive UNCHANGED (wrong) if the
      // tiebreak were missing — A before B, despite B's larger LBP total.
      { method: "A_LOW_LBP", total_usd: 0, total_lbp: 1_000_000 },
      { method: "B_HIGH_LBP", total_usd: 0, total_lbp: 5_000_000 },
      { method: "C_ZERO", total_usd: 0, total_lbp: 0 },
    ]);
    const service = new ProfitService(repo);

    const rows = service.getByPaymentMethod("2026-07-01", "2026-07-01");
    expect(rows.map((r) => r.method)).toEqual([
      "B_HIGH_LBP",
      "A_LOW_LBP",
      "C_ZERO",
    ]);
  });

  it("USD always outranks LBP — a tiny USD total beats a huge LBP-only total", () => {
    const repo = makeRepo([
      { method: "LBP_ONLY", total_usd: 0, total_lbp: 999_000_000 },
      { method: "TINY_USD", total_usd: 0.01, total_lbp: 0 },
    ]);
    const service = new ProfitService(repo);

    const rows = service.getByPaymentMethod("2026-07-01", "2026-07-01");
    expect(rows.map((r) => r.method)).toEqual(["TINY_USD", "LBP_ONLY"]);
  });
});
