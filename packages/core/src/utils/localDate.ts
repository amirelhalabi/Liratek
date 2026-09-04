/**
 * Local (machine-timezone) calendar-day helpers.
 *
 * SQLite `CURRENT_TIMESTAMP` stores UTC. When we need the *business day* — the
 * day as the operator sees it on the shop's clock — we must NOT use
 * `new Date().toISOString().split("T")[0]`, which yields the UTC calendar day
 * (rolls over at 03:00 in Beirut, UTC+3). These helpers use the local getters
 * so the day matches the machine's timezone, consistent with the SQL
 * `DATE(col, 'localtime') = DATE('now', 'localtime')` convention used across the
 * reporting repositories (SalesRepository, FinancialServiceRepository, …).
 *
 * On the desktop app the machine is the shop's PC (Beirut). On the web backend
 * the machine is the server — pin `TZ=Asia/Beirut` there (see
 * docs/plans/done_plans/LOCAL_BUSINESS_DAY_PLAN.md).
 */

import { ValidationError } from "./errors.js";

const pad = (n: number): string => n.toString().padStart(2, "0");

/** Local calendar day as `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local calendar month as `YYYY-MM`. */
export function localMonth(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Local calendar day `n` days before today, as `YYYY-MM-DD`. */
export function localDaysAgo(n: number, date: Date = new Date()): string {
  const d = new Date(date);
  d.setDate(d.getDate() - n);
  return localDay(d);
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The ONE definition of a calendar-month window in local time, so a month
 * bound is never hand-written as `strftime('%Y-%m', …)` again. Given a
 * `"YYYY-MM"` month, returns the inclusive local datetime window
 * `["YYYY-MM-01 00:00:00", "YYYY-MM-<lastDay> 23:59:59"]` — the exact shape
 * `ProfitRepository.dateRange`'s two bind params expect
 * (`datetime(col, 'localtime') >= ? AND datetime(col, 'localtime') <= ?`).
 * This is the JS twin of that SQL fragment: both describe the same window,
 * and must keep describing the same window if either changes.
 *
 * Pure function of the input string only — deliberately does not read the
 * machine clock or local offset (no `new Date()` with no argument, no
 * `getTimezoneOffset()`), so the result never depends on when or where it
 * runs. The last day of the month is computed via `Date.UTC(year,
 * monthIndex + 1, 0)` — day 0 of the next month is the last day of this one
 * — using UTC getters purely as an offset-free calendar calculator, not to
 * represent a UTC instant.
 */
export function monthBounds(month: string): { fromDt: string; toDt: string } {
  if (!MONTH_PATTERN.test(month)) {
    throw new ValidationError(
      `Invalid month "${month}": expected format YYYY-MM`,
    );
  }
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    fromDt: `${month}-01 00:00:00`,
    toDt: `${month}-${pad(lastDay)} 23:59:59`,
  };
}
