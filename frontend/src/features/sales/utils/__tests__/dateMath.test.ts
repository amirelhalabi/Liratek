/**
 * Parity suite: every case here mirrors
 * packages/core/src/utils/__tests__/dates.test.ts verbatim (same inputs,
 * same expected outputs) so this frontend copy of `addMonthsIso` is proven
 * to agree with the core source of truth on every documented clamp case,
 * not just "looks similar".
 */
import { addMonthsIso } from "../dateMath";

describe("addMonthsIso (frontend copy — parity with packages/core/src/utils/dates.ts)", () => {
  it("clamps to month-end when the target month is shorter (Jan 31 + 1mo = Feb 28)", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("clamps to Feb 29 on a leap year", () => {
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("does NOT clamp a leap-day source when the target year isn't leap (Feb 29 + 12mo = Feb 28)", () => {
    expect(addMonthsIso("2024-02-29", 12)).toBe("2025-02-28");
  });

  it("adds a plain 12 months, rolling the year over", () => {
    expect(addMonthsIso("2026-03-15", 12)).toBe("2027-03-15");
  });

  it("+0 months returns the same calendar day, normalized", () => {
    expect(addMonthsIso("2026-06-10", 0)).toBe("2026-06-10");
  });

  it("rolls over the year boundary mid-year (Nov + 3mo = Feb next year)", () => {
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("accepts a full ISO datetime string and reads only the date prefix", () => {
    expect(addMonthsIso("2026-01-31T14:22:00.000Z", 1)).toBe("2026-02-28");
  });

  it("handles a negative month count", () => {
    expect(addMonthsIso("2026-03-15", -1)).toBe("2026-02-15");
  });
});
