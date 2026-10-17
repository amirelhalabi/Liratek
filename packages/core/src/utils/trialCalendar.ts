/**
 * LIRA-332 — the free-trial calendar. ONE derivation of "which shop day is it,
 * when does the trial end, how many days are left", used by the server gate,
 * the status route, the owner's list, the phone and the paired PC.
 *
 * The shop's day comes from an EXPLICIT IANA zone, never from the machine
 * (rule 27: on Fly the machine is UTC) and never from the client's
 * `X-Client-Day` header (the shop controls that header, so trusting it would
 * let a shop keep its own trial alive — research R3). Lebanon observes DST
 * (+3 in summer, +2 in winter, switching at local midnight), so a fixed
 * offset is wrong for half the year.
 *
 * ⚠ Pure leaf: reachable from `browser.ts` and imported by the phone app.
 * It must never import `db/`, the logger or any Node built-in (rule 29).
 * Day arithmetic reuses `calendarDate.ts` (rule 14), itself a leaf.
 */

import {
  addDaysToDateString,
  daysBetweenDateStrings,
} from "./calendarDate.js";

/** Every shop is in Lebanon today (spec Assumptions). */
export const SHOP_TIME_ZONE = "Asia/Beirut";

/** FR-002: the single place the trial length is defined. */
export const TRIAL_LENGTH_DAYS = 14;

/** What every screen renders. Computed on the server; clients never re-derive. */
export interface TrialView {
  /** The end instant, ISO UTC (`…Z`). */
  endsAt: string;
  /** The last trial day in the shop's calendar, `YYYY-MM-DD`. */
  lastDay: string;
  /** Days left INCLUDING today; 1 on the last day, 0 once ended. */
  daysLeft: number;
  /** 3 days or fewer left, and not ended. */
  endsSoon: boolean;
  /** `now >= endsAt`. */
  ended: boolean;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE_MS = 60_000;

let dayFormatter: Intl.DateTimeFormat | null = null;
function formatter(): Intl.DateTimeFormat {
  // Built lazily and once: constructing an Intl formatter is the expensive
  // part, and the gate calls this on every write request.
  if (!dayFormatter) {
    dayFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: SHOP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return dayFormatter;
}

/** The shop's calendar day (`YYYY-MM-DD`) at an instant. */
export function shopDayOf(instant: Date): string {
  const parts = formatter().formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** True for a real calendar day in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isCalendarDay(day: string): boolean {
  const m = DAY_RE.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
  );
}

function assertDay(day: string): void {
  if (!isCalendarDay(day)) throw new RangeError(`Not a calendar day: ${day}`);
}

/**
 * The FIRST instant whose shop day equals `day`.
 *
 * Not "00:00 local": on a spring-forward night local 00:00 does not exist
 * (Lebanon jumps 00:00 → 01:00), and the naive "offset at noon" answer is an
 * hour early. The shop day is non-decreasing in time, so a binary search over
 * whole minutes (every real zone offset is a whole number of minutes) in a
 * window wide enough for any UTC offset finds the exact boundary.
 */
export function startOfShopDay(day: string): Date {
  assertDay(day);
  const [y, mo, d] = day.split("-").map(Number);
  const utcMidnight = Date.UTC(y, mo - 1, d);
  let lo = (utcMidnight - 15 * 60 * MINUTE_MS) / MINUTE_MS; // before it
  let hi = (utcMidnight + 15 * 60 * MINUTE_MS) / MINUTE_MS; // on or after it
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (shopDayOf(new Date(mid * MINUTE_MS)) >= day) hi = mid;
    else lo = mid;
  }
  return new Date(hi * MINUTE_MS);
}

/** The instant a shop day ends = the first instant of the next day. */
export function endOfShopDay(day: string): Date {
  assertDay(day);
  return startOfShopDay(addDaysToDateString(day, 1));
}

/**
 * The end instant of a trial that starts at `signup`: the sign-up day is
 * day 1, so the last day is sign-up + 13 and the trial ends at the first
 * instant of sign-up + 14 (research R4).
 */
export function trialEndFor(signup: Date): Date {
  return startOfShopDay(
    addDaysToDateString(shopDayOf(signup), TRIAL_LENGTH_DAYS),
  );
}

/**
 * A stored instant: SQLite's `YYYY-MM-DD HH:MM:SS` (UTC, as `CURRENT_TIMESTAMP`
 * writes it), an ISO string, or a Date.
 */
export function parseUtcInstant(value: Date | string): Date {
  if (value instanceof Date) return value;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(iso);
}

/** `YYYY-MM-DD HH:MM:SS` in UTC — the shape every DATETIME column stores. */
export function toUtcSqlTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** The single trial view for an end instant at `now`. */
export function trialView(endsAt: Date | string, now: Date): TrialView {
  const end = parseUtcInstant(endsAt);
  const ended = now.getTime() >= end.getTime();
  const lastDay = shopDayOf(new Date(end.getTime() - 1));
  const daysLeft = ended
    ? 0
    : Math.max(1, daysBetweenDateStrings(shopDayOf(now), lastDay) + 1);
  return {
    endsAt: end.toISOString(),
    lastDay,
    daysLeft,
    endsSoon: !ended && daysLeft <= 3,
    ended,
  };
}
