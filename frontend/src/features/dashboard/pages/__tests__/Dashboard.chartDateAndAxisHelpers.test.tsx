/** @jest-environment jsdom */

/**
 * Dashboard — DC-8 and the axis-max half of DC-5 (OWNER_NOTES_2026-09-21.md
 * §7.1). Both are pure functions living in `../../utils/chartFormat` (moved
 * out of this page's own file by LINT-1, a round-2 verifier finding —
 * react-refresh/only-export-components forbids a component file from also
 * exporting plain functions) specifically so they're unit-testable without
 * rendering the page. See `Dashboard.chartUsesLocalDateParse.guard.test.tsx`
 * for the companion integration test (DC8-GUARD) proving `loadData` itself
 * actually calls `parseLocalDateOnly` — this file only proves the helper is
 * correct in isolation.
 *
 * DC-8: `new Date("YYYY-MM-DD")` parses the string as UTC MIDNIGHT (the ES
 * spec's rule for a date-only ISO string), so a browser WEST of UTC renders
 * the PREVIOUS calendar day. `parseLocalDateOnly` reads y/m/d literally
 * instead — proven below by picking a timezone offset that reproduces the
 * exact pre-fix symptom.
 */

import {
  parseLocalDateOnly,
  niceUsdAxisMax,
} from "../../utils/chartFormat";

describe("parseLocalDateOnly (DC-8)", () => {
  it("reads the same calendar day the string names, regardless of the runtime's timezone", () => {
    const d = parseLocalDateOnly("2026-09-10");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // 0-indexed: September
    expect(d.getDate()).toBe(10);
  });

  it("differs from the buggy `new Date(str)` UTC-midnight parse for a timezone west of UTC", () => {
    // `new Date("2026-09-10")` is UTC midnight. In any timezone with a
    // negative UTC offset (e.g. US Eastern, UTC-4/-5), converting that
    // instant to a LOCAL Date/time lands on September 9th, not 10th — the
    // exact "previous day" bug DC-8 reports. We don't depend on the actual
    // machine timezone (CI/dev boxes vary) — instead we simulate the
    // pre-fix code's own arithmetic directly: subtract a west-of-UTC
    // offset from the UTC-midnight instant and read back the calendar day.
    const utcMidnight = new Date("2026-09-10");
    const westOfUtcOffsetMs = 4 * 60 * 60 * 1000; // UTC-4, e.g. US Eastern (summer)
    const localWallClock = new Date(utcMidnight.getTime() - westOfUtcOffsetMs);
    expect(localWallClock.getUTCDate()).toBe(9); // pre-fix: renders the 9th

    // `parseLocalDateOnly` never goes through a UTC instant at all, so it
    // is NOT affected by the offset subtraction above.
    const fixed = parseLocalDateOnly("2026-09-10");
    expect(fixed.getDate()).toBe(10);
  });

  it("round-trips through toLocaleDateString the same way the chart formats it", () => {
    const label = parseLocalDateOnly("2026-01-05").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    expect(label).toBe("Jan 5");
  });
});

describe("niceUsdAxisMax (DC-5)", () => {
  it("returns 0 for a non-positive max", () => {
    expect(niceUsdAxisMax(0)).toBe(0);
    expect(niceUsdAxisMax(-10)).toBe(0);
  });

  it("rounds up to the next $100 below $1,000 (a shop under ~$500/day)", () => {
    expect(niceUsdAxisMax(420)).toBe(500);
    expect(niceUsdAxisMax(1)).toBe(100);
    expect(niceUsdAxisMax(999)).toBe(1000);
  });

  it("rounds up to the next $1,000 at/above $1,000, matching the pre-fix behavior there", () => {
    expect(niceUsdAxisMax(1000)).toBe(1000);
    expect(niceUsdAxisMax(1001)).toBe(2000);
    expect(niceUsdAxisMax(4200)).toBe(5000);
  });
});
