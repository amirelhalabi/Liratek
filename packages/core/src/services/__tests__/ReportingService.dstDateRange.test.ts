/**
 * `ReportingService.getDateRange` (private, exercised via `getDailySummaries`)
 * — DST bug (2026-09-13).
 *
 * The old implementation parsed `from`/`to` with `new Date("2026-03-27")`
 * (UTC midnight) and formatted with `toISOString()` (UTC), but advanced the
 * loop with `current.setDate(current.getDate() + 1)` — LOCAL time. On a
 * DST-observing machine, "advance one local calendar day" is 23 or 25 hours
 * across a transition, not 24, so the UTC instant drifted across a UTC
 * midnight boundary and the emitted date sequence duplicated one day and
 * dropped the requested end date.
 *
 * This app runs on the shop's own Beirut PC (desktop), not the Fly backend
 * (UTC) — the reverse of the usual rule-27 direction: here the DESKTOP side
 * is the one that was wrong, and the web/UTC side was always fine.
 *
 * Fix: iterate `YYYY-MM-DD` strings via `addDaysToDateString`
 * (`utils/carrierLineValidity.ts`), which does all arithmetic in UTC on the
 * parsed y/m/d — no `Date` object survives across loop iterations for a time
 * zone to disagree with.
 *
 * `packages/core/package.json`'s `test` script pins `TZ=Asia/Beirut` via
 * cross-env, so plain `npm test`/`yarn test` in this package already runs in
 * the affected zone — no test-local TZ mocking needed to hit the bug.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Rule-17 discharge note (2026-09-13)
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Copied `ReportingService.ts` to a temp path outside the repo.
 * 2. Reverted `getDateRange` in the working tree to the pre-fix body:
 *      const dates: string[] = [];
 *      const current = new Date(from);
 *      const end = new Date(to);
 *      while (current <= end) {
 *        dates.push(current.toISOString().split("T")[0]);
 *        current.setDate(current.getDate() + 1);
 *      }
 *      return dates;
 * 3. Ran, under TZ=Asia/Beirut:
 *      cd packages/core && node ../../node_modules/cross-env/src/bin/cross-env.js \
 *        TZ=Asia/Beirut node ../../node_modules/jest/bin/jest.js \
 *        --config jest.config.cjs --testPathPatterns "ReportingService.dstDateRange"
 *    Both DST tests failed against the buggy code, e.g. (spring-forward case):
 *      expect(received).toEqual(expected)
 *      - Expected  - 1
 *      + Received  + 1
 *        Array [
 *          "2026-03-27",
 *          "2026-03-28",
 *      -   "2026-03-29",
 *      +   "2026-03-28",
 *          "2026-03-30",
 *      -   "2026-03-31",
 *        ]
 *    and the "no duplicate dates" / "end date present" assertions failed too
 *    (duplicate "2026-03-28", missing "2026-03-31"). Fall-back case
 *    (2026-10-25) failed the same way: missing "2026-10-27".
 * 4. Restored `ReportingService.ts` from the temp copy and confirmed
 *    `git diff --stat -- packages/core/src/services/ReportingService.ts`
 *    printed nothing.
 * 5. Re-ran the same test command against the restored (fixed) code — green,
 *    under both:
 *      TZ=Asia/Beirut node .../jest.js --config jest.config.cjs --testPathPatterns "ReportingService.dstDateRange"
 *      TZ=UTC          node .../jest.js --config jest.config.cjs --testPathPatterns "ReportingService.dstDateRange"
 *    confirming the fix is timezone-independent, not merely Beirut-correct.
 */

import {
  getReportingService,
  resetReportingService,
} from "../ReportingService.js";
import { getTransactionRepository } from "../../repositories/TransactionRepository.js";
import type { DailySummary } from "../../repositories/TransactionRepository.js";

jest.mock("../../repositories/TransactionRepository.js", () => ({
  getTransactionRepository: jest.fn(),
}));

describe("ReportingService — DST date-range bug (Asia/Beirut)", () => {
  let getDailySummaryMock: jest.Mock;

  beforeEach(() => {
    resetReportingService();
    getDailySummaryMock = jest.fn(
      (date: string): DailySummary =>
        ({
          date,
          total_usd: 0,
          total_lbp: 0,
          transaction_count: 0,
        }) as unknown as DailySummary,
    );
    (getTransactionRepository as jest.Mock).mockReturnValue({
      getDailySummary: getDailySummaryMock,
    });
  });

  /** Pull the actual sequence of dates the service queried the repo for. */
  function queriedDates(): string[] {
    return getDailySummaryMock.mock.calls.map((call) => call[0] as string);
  }

  it("spring-forward transition (2026-03-29, Beirut clocks jump forward): no duplicate day, end date present", () => {
    getReportingService().getDailySummaries("2026-03-27", "2026-03-31");
    const dates = queriedDates();

    expect(dates).toEqual([
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
    ]);
    expect(new Set(dates).size).toBe(dates.length); // no duplicates
    expect(dates).toContain("2026-03-31"); // requested end date not dropped
  });

  it("fall-back transition (2026-10-25, Beirut clocks jump back): no duplicate day, end date present", () => {
    getReportingService().getDailySummaries("2026-10-23", "2026-10-27");
    const dates = queriedDates();

    expect(dates).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toContain("2026-10-27");
  });

  it("single-day range returns exactly that day", () => {
    getReportingService().getDailySummaries("2026-03-29", "2026-03-29");
    expect(queriedDates()).toEqual(["2026-03-29"]);
  });

  it("reversed range (from after to) returns no dates, not an infinite loop", () => {
    const result = getReportingService().getDailySummaries(
      "2026-03-31",
      "2026-03-27",
    );
    expect(result).toEqual([]);
    expect(getDailySummaryMock).not.toHaveBeenCalled();
  });

  it("malformed date string returns no dates, not an infinite loop", () => {
    const result = getReportingService().getDailySummaries(
      "not-a-date",
      "2026-03-31",
    );
    expect(result).toEqual([]);
    expect(getDailySummaryMock).not.toHaveBeenCalled();
  });
});
