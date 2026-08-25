/**
 * Calendar-month arithmetic, clamped at month-end.
 *
 * Built for LIRA-143 phase 4's warranty stamp (`sale_items.warranty_until =
 * sale date + product.warranty_months`, owner decision #4), but generic —
 * nothing here is warranty-specific. Pure and timezone-agnostic in effect:
 * input and output are both plain `YYYY-MM-DD` strings, and the one `Date`
 * object used internally (`daysInMonth`) only ever reads back its own
 * locally-constructed calendar fields, so there is no UTC/local boundary to
 * cross (unlike `localDate.ts`, which deliberately reads the machine's
 * timezone for "what day is it right now").
 */

/** Number of days in `year`-`month` (`month` is 1-indexed). Day 0 of the
 *  FOLLOWING month is the last day of THIS month — a standard JS Date trick. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const pad = (n: number): string => n.toString().padStart(2, "0");

/**
 * Add `months` calendar months to `dateIso` (`YYYY-MM-DD`, or any string
 * with that prefix — only the first 10 characters are read), clamping the
 * result's day-of-month to the target month's last day when the original
 * day doesn't exist there — e.g. `2026-01-31` + 1 month = `2026-02-28`; on a
 * leap year, `2024-02-29` + 12 months = `2025-02-28` (2025 isn't leap).
 * `months` may be `0` (returns the same calendar day, still normalized to
 * `YYYY-MM-DD`) or negative (subtracts months).
 */
export function addMonthsIso(dateIso: string, months: number): string {
  const [yearStr, monthStr, dayStr] = dateIso.slice(0, 10).split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const totalMonths = month - 1 + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  // Normalize a possibly-negative `totalMonths % 12` into 0-11 before
  // shifting back to the 1-12 convention `dateIso` uses.
  const targetMonth = (((totalMonths % 12) + 12) % 12) + 1;

  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));

  return `${targetYear}-${pad(targetMonth)}-${pad(clampedDay)}`;
}
