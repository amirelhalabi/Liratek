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

import { parseDbDate } from "./parseDbDate";

const pad = (n: number): string => n.toString().padStart(2, "0");

/** Local calendar day as `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local calendar month as `YYYY-MM`. */
export function localMonth(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/**
 * The business (local) day a stored date belongs to, as `YYYY-MM-DD` — the
 * day every date filter files a row under AND the day its Date column shows
 * (rule 27: the two must agree). A bare `YYYY-MM-DD` is already a day label
 * and is kept as is; a timestamp (SQLite UTC or ISO with a zone) is turned
 * into the local calendar day. An unparsable value falls back to its first
 * ten characters.
 */
export function businessDayOf(raw: unknown): string {
  const value = String(raw ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = parseDbDate(value);
  return isNaN(parsed.getTime()) ? value.slice(0, 10) : localDay(parsed);
}
