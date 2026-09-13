/**
 * Calendar-date arithmetic — the ONE definition (rule 14).
 *
 * A `YYYY-MM-DD` calendar date has no timezone of its own: "2026-08-29" means
 * the same day everywhere, so adding/subtracting days from it, or measuring
 * the whole-day gap between two of them, must be done in UTC — never by
 * parsing with `new Date()` (which lands on UTC midnight) and then reading it
 * back with LOCAL getters, and never by stepping it with a LOCAL `setDate()`.
 * Both of those break the moment the machine's offset is negative (any zone
 * west of UTC turns UTC-midnight into "yesterday evening" locally) and again
 * across a DST transition, where a local calendar day is not a fixed number
 * of milliseconds.
 *
 * This is not a hypothetical: that exact local-getter/local-setter mistake
 * shipped twice, independently, in the two fixes landed in `3a3c96bd` —
 * `LotoService` double-counted a day on a checkpoint date, and
 * `ReportingService` duplicated/dropped days at the edges of a date range
 * across Beirut's DST transitions. Both call sites needed nothing more than
 * "add N days to this calendar-date string", found `addDaysToDateString`
 * already implemented (for carrier-line validity, a different domain
 * entirely), and imported it from there rather than re-deriving the bug a
 * third time. This module exists so the NEXT caller finds it under a name
 * that says what it does, instead of importing a carrier-line module to add
 * a day to a date.
 *
 * Leaf module: no imports beyond (at most) `./errors.js`. This is reachable
 * from `browser.ts`, so any Node built-in anywhere in its graph fails the
 * Vercel build (rule 29) — `browserEntryIsNodeFree.guard.test.ts` enforces
 * it.
 */

/**
 * Add (or, for a negative `days`, subtract) whole days to a `YYYY-MM-DD`
 * calendar-date string. Parsed/formatted entirely in UTC — a calendar date has
 * no timezone of its own, so doing this arithmetic in UTC sidesteps any
 * local-timezone month/day-rollover bug entirely (contrast `localDate.ts`,
 * which deliberately uses local getters because IT answers "what day is it on
 * the shop's clock right now" — a different question from "what date is N days
 * after this stored calendar date").
 *
 * Originally moved into `CarrierLineRepository` by LIRA-157 so the frontend's
 * pre-submit projection could reuse it rather than re-implement it; relocated
 * here so callers with no carrier-line involvement (loto checkpoints,
 * reporting date ranges) do not have to import a carrier-line module to add a
 * day to a date.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Whole-day difference `toStr - fromStr` between two `YYYY-MM-DD` calendar
 * dates, computed in UTC (a fixed 86,400,000 ms/day — no DST ambiguity ever
 * applies to a pure calendar date). Negative when `toStr` precedes `fromStr`.
 */
export function daysBetweenDateStrings(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}
