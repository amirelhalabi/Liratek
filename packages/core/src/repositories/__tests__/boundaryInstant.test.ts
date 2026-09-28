/**
 * Unit tests for `boundaryInstant.ts`'s day/month boundary-instant
 * construction — proves the two invariants hold at every hour-of-day this
 * helper branches on, plus the two calendar edge cases (year rollover,
 * leap day) that the LIRA-237 wave-2 repository tests rely on.
 *
 * These tests fix `nowMs` themselves (rather than calling `Date.now()`), so
 * they are deterministic regardless of when the suite actually runs.
 */

import {
  dayBoundaryInstant,
  monthBoundaryInstant,
  localDay,
  utcDay,
  localMonth,
  utcMonth,
  parseUtcTimestamp,
} from "../testHelpers/boundaryInstant.js";

const BEIRUT_OFFSET_MINUTES = 180;

/** `nowMs` for a given Beirut (UTC+3) wall-clock date/time. */
function beirut(
  year: number,
  month1based: number,
  day: number,
  hour: number,
  minute = 0,
): number {
  return (
    Date.UTC(year, month1based - 1, day, hour, minute, 0) -
    BEIRUT_OFFSET_MINUTES * 60_000
  );
}

describe("dayBoundaryInstant — invariants at every hour-of-day this helper branches on", () => {
  const cases: Array<[string, number]> = [
    ["00:30", beirut(2026, 9, 15, 0, 30)],
    ["02:59", beirut(2026, 9, 15, 2, 59)],
    ["03:00", beirut(2026, 9, 15, 3, 0)],
    ["03:01", beirut(2026, 9, 15, 3, 1)],
    ["12:00", beirut(2026, 9, 15, 12, 0)],
    ["23:59", beirut(2026, 9, 15, 23, 59)],
  ];

  it.each(cases)(
    "Beirut %s: localDay(T) matches now's, utcDay(T) differs from now's",
    (_label, nowMs) => {
      const t = dayBoundaryInstant(nowMs, BEIRUT_OFFSET_MINUTES);
      const tMs = parseUtcTimestamp(t);

      expect(localDay(tMs, BEIRUT_OFFSET_MINUTES)).toBe(
        localDay(nowMs, BEIRUT_OFFSET_MINUTES),
      );
      expect(utcDay(tMs)).not.toBe(utcDay(nowMs));
    },
  );

  it("produces a well-formed 'YYYY-MM-DD HH:MM:SS' string", () => {
    const t = dayBoundaryInstant(beirut(2026, 9, 15, 12, 0), BEIRUT_OFFSET_MINUTES);
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("monthBoundaryInstant — invariants, including the danger-zone edge", () => {
  const cases: Array<[string, number]> = [
    ["1st of month, 00:30 (danger zone)", beirut(2026, 9, 1, 0, 30)],
    ["1st of month, 05:00 (not danger zone)", beirut(2026, 9, 1, 5, 0)],
    ["mid-month, 12:00", beirut(2026, 9, 15, 12, 0)],
    ["last day of month, 23:00", beirut(2026, 9, 30, 23, 0)],
  ];

  it.each(cases)(
    "%s: localMonth(T) matches now's, utcMonth(T) differs from now's",
    (_label, nowMs) => {
      const t = monthBoundaryInstant(nowMs, BEIRUT_OFFSET_MINUTES);
      const tMs = parseUtcTimestamp(t);

      expect(localMonth(tMs, BEIRUT_OFFSET_MINUTES)).toBe(
        localMonth(nowMs, BEIRUT_OFFSET_MINUTES),
      );
      expect(utcMonth(tMs)).not.toBe(utcMonth(nowMs));
    },
  );

  it("31 Dec -> 1 Jan: the 1st of January, just past midnight Beirut (danger zone, year rollover)", () => {
    const nowMs = beirut(2027, 1, 1, 0, 45);
    const t = monthBoundaryInstant(nowMs, BEIRUT_OFFSET_MINUTES);
    const tMs = parseUtcTimestamp(t);

    expect(localMonth(tMs, BEIRUT_OFFSET_MINUTES)).toBe("2027-01");
    expect(localMonth(nowMs, BEIRUT_OFFSET_MINUTES)).toBe("2027-01");
    expect(utcMonth(tMs)).not.toBe(utcMonth(nowMs));
    // Confirms the year-rollover case actually landed in December, not a
    // mis-normalized month index.
    expect(utcMonth(nowMs)).toBe("2026-12");
  });

  it("31 Dec, late evening Beirut (not the 1st — no danger zone, no rollover)", () => {
    const nowMs = beirut(2026, 12, 31, 22, 0);
    const t = monthBoundaryInstant(nowMs, BEIRUT_OFFSET_MINUTES);
    const tMs = parseUtcTimestamp(t);

    expect(localMonth(tMs, BEIRUT_OFFSET_MINUTES)).toBe("2026-12");
    expect(localMonth(nowMs, BEIRUT_OFFSET_MINUTES)).toBe("2026-12");
    expect(utcMonth(tMs)).not.toBe(utcMonth(nowMs));
  });

  it("leap day (2028-02-29), mid-morning Beirut", () => {
    const nowMs = beirut(2028, 2, 29, 10, 0);
    const t = monthBoundaryInstant(nowMs, BEIRUT_OFFSET_MINUTES);
    const tMs = parseUtcTimestamp(t);

    expect(localMonth(tMs, BEIRUT_OFFSET_MINUTES)).toBe("2028-02");
    expect(localMonth(nowMs, BEIRUT_OFFSET_MINUTES)).toBe("2028-02");
    expect(utcMonth(tMs)).not.toBe(utcMonth(nowMs));
  });

  it("leap day (2028-02-29), 1st-of-month danger zone does not apply mid-month", () => {
    // Sanity: leap day is NOT the 1st, so this must take the "not danger
    // zone" (01:30-equivalent) branch even at an early hour.
    const nowMs = beirut(2028, 2, 29, 1, 0);
    const t = monthBoundaryInstant(nowMs, BEIRUT_OFFSET_MINUTES);
    const tMs = parseUtcTimestamp(t);

    expect(localMonth(tMs, BEIRUT_OFFSET_MINUTES)).toBe("2028-02");
    expect(utcMonth(tMs)).not.toBe(utcMonth(nowMs));
  });
});

describe("dayBoundaryInstant / monthBoundaryInstant — unsupported offsets rejected", () => {
  it.each([0, -180, 90, 780])("rejects offsetMinutes=%d", (offset) => {
    expect(() => dayBoundaryInstant(Date.now(), offset)).toThrow();
    expect(() => monthBoundaryInstant(Date.now(), offset)).toThrow();
  });
});
