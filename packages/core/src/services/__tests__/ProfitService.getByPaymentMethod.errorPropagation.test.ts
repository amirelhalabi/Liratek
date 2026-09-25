/**
 * ProfitService.getByPaymentMethod — PA-4.16 (OWNER_NOTES_2026-09-21.md §6.6):
 * a repository failure must propagate as a thrown/rejected error, never be
 * swallowed into an empty array. A swallowed `[]` renders the SAME "No
 * payment data for this period" the Profits page shows for a genuine
 * no-activity day, so a broken query silently reads as an empty one.
 *
 * Rule 17 proof (RED observed before GREEN): this file was run against the
 * PRE-FIX `getByPaymentMethod` (`catch (error) { logger.error(...); return
 * []; }`) by temporarily reverting that one method's catch block (Edit tool,
 * this lane's own uncommitted change only) and re-running. `getByPaymentMethod`
 * is synchronous (returns `ProfitByPaymentMethod[]`, not a Promise), so the
 * assertion below is the synchronous `expect(() => ...).toThrow(...)` form —
 * observed failure, verbatim (LPAY-2 fix: this replaces an earlier, incorrect
 * `.rejects.toThrow()` quote that could not have come from this test):
 *
 *   "propagates a repository failure instead of returning []"
 *     expect(received).toThrow(expected)
 *     Expected substring: "SQLITE_CORRUPT: database disk image is malformed"
 *     Received function did not throw
 *
 * After restoring the fix (rethrow), the same run passed. The mocked repo
 * below implements only what `getByPaymentMethod` calls before the failing
 * call is reached — `getPaymentMethodRows` throws first, so the sibling
 * commission-total methods are never invoked for this test.
 */

import { ProfitService } from "../ProfitService";
import type { ProfitRepository } from "../../repositories/ProfitRepository";

function makeFailingRepo(): ProfitRepository {
  return {
    getPaymentMethodRows: jest.fn(() => {
      throw new Error("SQLITE_CORRUPT: database disk image is malformed");
    }),
    getRealizedCommissionTotals: jest.fn(),
    getPendingCommissionTotals: jest.fn(),
    getPendingCommissionByProvider: jest.fn(),
  } as unknown as ProfitRepository;
}

describe("ProfitService.getByPaymentMethod — error propagation (PA-4.16)", () => {
  it("propagates a repository failure instead of returning []", () => {
    const service = new ProfitService(makeFailingRepo());

    expect(() =>
      service.getByPaymentMethod("2026-07-01", "2026-07-01"),
    ).toThrow("SQLITE_CORRUPT: database disk image is malformed");
  });

  it("still returns rows normally when the repository succeeds (regression)", () => {
    const repo = {
      getPaymentMethodRows: jest.fn(() => [
        {
          method: "CASH",
          total_usd: 100,
          total_lbp: 0,
          debt_repayment_usd: 0,
          debt_repayment_lbp: 0,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
      ]),
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
    const service = new ProfitService(repo);

    const rows = service.getByPaymentMethod("2026-07-01", "2026-07-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe("CASH");
  });
});
