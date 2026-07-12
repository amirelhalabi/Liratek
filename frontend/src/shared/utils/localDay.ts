/**
 * Local (browser-timezone) calendar-day helpers for the renderer.
 *
 * Mirrors `@liratek/core`'s localDate helpers (which the renderer cannot import
 * — core is main-process only). Use these instead of
 * `new Date().toISOString().split("T")[0]` whenever you need the *business day*
 * or a default date-filter bound: `toISOString()` yields the UTC calendar day,
 * which rolls over at 03:00 in Beirut (UTC+3) and mismatches the backend's
 * `DATE(col, 'localtime')` reporting filters.
 */

const pad = (n: number): string => n.toString().padStart(2, "0");

/** Local calendar day as `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local calendar month as `YYYY-MM`. */
export function localMonth(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}
