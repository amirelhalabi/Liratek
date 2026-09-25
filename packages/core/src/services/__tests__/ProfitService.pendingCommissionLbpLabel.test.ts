/**
 * ProfitService.getByPaymentMethod — LPAY-V7 (OWNER_NOTES_2026-09-21.md §6.5
 * PA-3.5 review, round 3): the per-provider "Commission Pending Settlement"
 * label built from `getPendingCommissionByProvider` only ever rendered a
 * dollar figure (`$${p.total_usd.toFixed(2)}`) or, absent that, the literal
 * "$0.00" — so a legacy model-0 provider whose pending commission is
 * genuinely denominated in LBP (not USD) read as "$0.00" even though it had
 * real money pending.
 *
 * Rule 17 proof — ACTUALLY RUN
 * (`npx jest ProfitService.pendingCommissionLbpLabel.test.ts --maxWorkers=1`
 * from `packages/core`) against the PRE-FIX `providerLabel` builder (the
 * `if (p.total_lbp > 0) parts.push(...)` branch removed — Edit tool, this
 * lane's own uncommitted change only, restored immediately after). Verbatim
 * jest output:
 *
 *   "shows the LBP figure for an LBP-only pending provider instead of a bare $0.00"
 *     expect(received).toMatch(expected)
 *     Expected pattern: /BOB 900,000 LBP/
 *     Received string:  "Commission Pending Settlement (BOB $0.00)"
 *
 * After restoring the `if (p.total_lbp > 0) parts.push(...)` branch, the
 * same run passed.
 */

import { ProfitService } from "../ProfitService";
import type { ProfitRepository } from "../../repositories/ProfitRepository";

function makeRepo(): ProfitRepository {
  return {
    getPaymentMethodRows: jest.fn(() => []),
    getRealizedCommissionTotals: jest.fn(() => ({
      total_usd: 0,
      total_lbp: 0,
      count: 0,
    })),
    getPendingCommissionTotals: jest.fn(() => ({
      total_usd: 0,
      total_lbp: 900_000,
      count: 1,
      awaiting_settlement_count: 0,
    })),
    getPendingCommissionByProvider: jest.fn(() => [
      {
        provider: "BOB",
        total_usd: 0,
        total_lbp: 900_000,
        count: 1,
        awaiting_settlement_count: 0,
      },
    ]),
  } as unknown as ProfitRepository;
}

describe("ProfitService.getByPaymentMethod — pending-commission LBP label (LPAY-V7)", () => {
  it("shows the LBP figure for an LBP-only pending provider instead of a bare $0.00", () => {
    const service = new ProfitService(makeRepo());

    const rows = service.getByPaymentMethod("2026-07-01", "2026-07-01");
    const pendingRow = rows.find((r) => r.method.startsWith("Commission"));
    expect(pendingRow).toBeDefined();
    expect(pendingRow!.method).toMatch(/BOB 900,000 LBP/);
    expect(pendingRow!.method).not.toMatch(/BOB \$0\.00/);
  });
});
