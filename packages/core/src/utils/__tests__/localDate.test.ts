/**
 * LIRA-159 Task 2 — `monthBounds` unit tests.
 *
 * `monthBounds()` (utils/localDate.ts) is the ONE definition of a calendar-
 * month window in local time — `FinancialRepository.getMonthlyPL` and
 * `ProfitRepository.dateRange()`'s SQL `datetime(col, 'localtime')` bound are
 * meant to describe the identical window (see localDate.ts's own doc
 * comment). This file proves the JS half in isolation: exact returned
 * strings for a 31-day month, a 30-day month, February in both a leap and a
 * non-leap year, December (year must not roll over), malformed-input
 * rejection, and purity (no dependency on the system clock — the function
 * deliberately never calls `new Date()` with no argument).
 *
 * Deliberately imports ONLY `../localDate` (which itself imports only
 * `./errors.js`) — neither pulls in `better-sqlite3` or any repository, so
 * this file runs under plain Node with no native-module/ABI dependency at
 * all (verified: `../errors.js` has zero imports of its own).
 */

import { monthBounds } from "../localDate";
import { ValidationError } from "../errors";

describe("monthBounds", () => {
  it("returns the exact inclusive window for a 31-day month (January)", () => {
    expect(monthBounds("2026-01")).toEqual({
      fromDt: "2026-01-01 00:00:00",
      toDt: "2026-01-31 23:59:59",
    });
  });

  it("returns the exact inclusive window for a 30-day month (April)", () => {
    expect(monthBounds("2026-04")).toEqual({
      fromDt: "2026-04-01 00:00:00",
      toDt: "2026-04-30 23:59:59",
    });
  });

  it("clamps February to the 29th on a leap year (2024)", () => {
    expect(monthBounds("2024-02")).toEqual({
      fromDt: "2024-02-01 00:00:00",
      toDt: "2024-02-29 23:59:59",
    });
  });

  it("clamps February to the 28th on a non-leap year (2026)", () => {
    expect(monthBounds("2026-02")).toEqual({
      fromDt: "2026-02-01 00:00:00",
      toDt: "2026-02-28 23:59:59",
    });
  });

  it("does not roll the year over for December (fromDt/toDt both stay in the same year)", () => {
    expect(monthBounds("2026-12")).toEqual({
      fromDt: "2026-12-01 00:00:00",
      toDt: "2026-12-31 23:59:59",
    });
  });

  it("throws ValidationError for an out-of-range month '2026-13'", () => {
    expect(() => monthBounds("2026-13")).toThrow(ValidationError);
  });

  it("throws ValidationError for a non-zero-padded month '2026-1'", () => {
    expect(() => monthBounds("2026-1")).toThrow(ValidationError);
  });

  it("throws ValidationError for garbage input", () => {
    expect(() => monthBounds("garbage")).toThrow(ValidationError);
  });

  it("is pure: the same input yields the same output regardless of the system clock", () => {
    const before = monthBounds("2026-05");

    jest.useFakeTimers();
    try {
      // A wildly different "now" than anything the function could plausibly
      // read — different year, different month, different local/UTC edge.
      jest.setSystemTime(new Date("2099-12-31T23:59:59.000Z"));

      const after = monthBounds("2026-05");

      expect(after).toEqual(before);
      expect(after).toEqual({
        fromDt: "2026-05-01 00:00:00",
        toDt: "2026-05-31 23:59:59",
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
