/**
 * LIRA-237 test helper — produces "today"/"this month" boundary rows that
 * reproduce the day/month-bucketing bug at ANY real run time, not just a
 * single hardcoded calendar date.
 *
 * The original wave-2 test files anchored their boundary row at a FIXED
 * instant (`"2026-09-27 22:30:00"` UTC = 01:30 Beirut on 2026-09-28) and
 * then asked SQL's `'now'` (the REAL wall clock at test-run time) whether
 * that fixed instant was "today"/"this month". That only held on
 * 2026-09-28 (Beirut) — it started failing CI the very next day, and the
 * `FinancialServiceRepository` month case breaks on the 1st of any month.
 * This module computes the boundary instant FROM the real `Date.now()` at
 * test-run time instead, so the row is always "the client's today/this
 * month, but the host-UTC's yesterday/last month" — regardless of what day
 * it actually is.
 *
 * All instants are returned as the DB's marker-less storage string
 * (`'YYYY-MM-DD HH:MM:SS'`, no timezone suffix — the `CURRENT_TIMESTAMP`
 * convention every table in the schema uses).
 *
 * ─── The construction (day case) ───────────────────────────────────────
 * We want a UTC instant T such that, for a client offset of `offsetMinutes`
 * (e.g. +180 for Beirut):
 *   - localDay(T, offsetMinutes) === localDay(now, offsetMinutes)   (same "today" for the CLIENT)
 *   - utcDay(T) !== utcDay(now)                                     (different day for a bare-UTC HOST)
 *
 * Such a T always exists because a "local day" of `offsetMinutes` minutes'
 * worth of skew, mapped back onto the UTC timeline, is a 24h window that is
 * NOT aligned to a UTC day boundary (unless offsetMinutes is a multiple of
 * 1440) — so it straddles exactly one UTC midnight, giving two sub-ranges
 * with different UTC calendar days to choose from:
 *
 *   - If the client's current wall-clock hour is already >= offsetHours,
 *     "now" itself sits in the LATER sub-range (no UTC-day wrap yet this
 *     local day) — so T = local 01:30 (offsetHours / 2) on the same local
 *     day lands in the EARLIER sub-range (the previous UTC day).
 *   - If the client's current wall-clock hour is < offsetHours, "now"
 *     itself sits in the EARLIER sub-range (still the previous UTC day) —
 *     so T = local 12:00 on the same local day lands in the LATER
 *     sub-range (the current UTC day). Noon is comfortably past
 *     `offsetHours` for any offset this helper supports (<= 12h), so it
 *     never wraps a second time.
 *
 * The month case is the same construction one level up: the 1st of the
 * client's current local month, at 01:30 or 12:00 local time depending on
 * whether "now" itself is in the danger zone (the 1st of the month, before
 * `offsetHours` local time) — see {@link monthBoundaryInstant}'s doc
 * comment for the month-specific proof.
 *
 * Only whole-hour, positive, <= 12h offsets are supported (this repo only
 * ever calls this with Beirut's +180) — the noon fallback assumes
 * `offsetHours <= 12` so it can never land on the wrong side of a SECOND
 * UTC-midnight crossing.
 */

const MS_PER_MINUTE = 60_000;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function assertSupportedOffset(offsetMinutes: number, fn: string): void {
  if (
    offsetMinutes <= 0 ||
    offsetMinutes % 60 !== 0 ||
    offsetMinutes > 720
  ) {
    throw new Error(
      `${fn}: only whole positive hour offsets up to 12h (720 minutes) are ` +
        `supported, got ${offsetMinutes}`,
    );
  }
}

/**
 * Formats a UTC instant (ms since epoch) as the DB's marker-less
 * `'YYYY-MM-DD HH:MM:SS'` storage string.
 */
export function formatUtcTimestamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Parses the DB's marker-less `'YYYY-MM-DD HH:MM:SS'` storage string (or an
 * ISO `T`-separated one) back to a UTC ms timestamp — the inverse of
 * {@link formatUtcTimestamp}. Same UTC-pinning convention `parseDbDate.ts`
 * (frontend) and other tests in this suite (e.g.
 * `AuditRepository.utcStamp.test.ts`) already use for a marker-less string.
 */
export function parseUtcTimestamp(s: string): number {
  return Date.parse(`${s.replace(" ", "T")}Z`);
}

/** The calendar day (`'YYYY-MM-DD'`) `ms` falls on, in UTC. */
export function utcDay(ms: number): string {
  return formatUtcTimestamp(ms).slice(0, 10);
}

/**
 * The calendar day (`'YYYY-MM-DD'`) `ms` falls on, shifted by
 * `offsetMinutes` — the same calculation `localDayExpr()`/`isToday()`
 * perform in SQL (`DATE(col, '<offsetMinutes> minutes')`).
 */
export function localDay(ms: number, offsetMinutes: number): string {
  return utcDay(ms + offsetMinutes * MS_PER_MINUTE);
}

/** The calendar month (`'YYYY-MM'`) `ms` falls on, in UTC. */
export function utcMonth(ms: number): string {
  return formatUtcTimestamp(ms).slice(0, 7);
}

/**
 * The calendar month (`'YYYY-MM'`) `ms` falls on, shifted by
 * `offsetMinutes` — mirrors `isThisMonth()`'s
 * `strftime('%Y-%m', col, '<offsetMinutes> minutes')`.
 */
export function localMonth(ms: number, offsetMinutes: number): string {
  return utcMonth(ms + offsetMinutes * MS_PER_MINUTE);
}

/**
 * A UTC instant T (DB storage string) that is "today" for a client at
 * `offsetMinutes` but NOT "today" for a bare-UTC host — see this module's
 * doc comment for the construction and proof. `nowMs` is the real
 * "current" instant (pass `Date.now()`) the caller's SQL `'now'` will be
 * compared against.
 */
export function dayBoundaryInstant(nowMs: number, offsetMinutes: number): string {
  assertSupportedOffset(offsetMinutes, "dayBoundaryInstant");
  const offsetHours = offsetMinutes / 60;
  const offsetMs = offsetMinutes * MS_PER_MINUTE;
  const nowShifted = new Date(nowMs + offsetMs);
  const localHour = nowShifted.getUTCHours();
  const localY = nowShifted.getUTCFullYear();
  const localM = nowShifted.getUTCMonth();
  const localD = nowShifted.getUTCDate();

  const localHourToUse = localHour >= offsetHours ? offsetHours / 2 : 12;
  const wholeHour = Math.floor(localHourToUse);
  const minute = Math.round((localHourToUse - wholeHour) * 60);

  // Build "local today at localHourToUse" as if it were itself a UTC
  // instant, then shift BACK by the offset to recover the real UTC instant.
  const asIfUtcMs = Date.UTC(localY, localM, localD, wholeHour, minute, 0);
  return formatUtcTimestamp(asIfUtcMs - offsetMs);
}

/**
 * A UTC instant T (DB storage string) that is "this month" for a client at
 * `offsetMinutes` but NOT "this month" for a bare-UTC host — the month-case
 * sibling of {@link dayBoundaryInstant}.
 *
 * Danger zone: if `nowMs` itself is on the 1st of the client's local month
 * before `offsetHours` local time, the client's "this month" instant at
 * local 01:30 on the 1st would land in the SAME (previous) UTC month as
 * `now` itself — both still "last month" in UTC — which would make T
 * indistinguishable from `now`'s own UTC month. Local NOON on the 1st
 * avoids this (see the day-case proof: noon is comfortably past
 * `offsetHours`, so it never wraps into the previous UTC day/month).
 */
export function monthBoundaryInstant(
  nowMs: number,
  offsetMinutes: number,
): string {
  assertSupportedOffset(offsetMinutes, "monthBoundaryInstant");
  const offsetHours = offsetMinutes / 60;
  const offsetMs = offsetMinutes * MS_PER_MINUTE;
  const nowShifted = new Date(nowMs + offsetMs);
  const localHour = nowShifted.getUTCHours();
  const localDate = nowShifted.getUTCDate();
  const localY = nowShifted.getUTCFullYear();
  const localM = nowShifted.getUTCMonth();

  const inDangerZone = localDate === 1 && localHour < offsetHours;
  const localHourToUse = inDangerZone ? 12 : offsetHours / 2;
  const wholeHour = Math.floor(localHourToUse);
  const minute = Math.round((localHourToUse - wholeHour) * 60);

  // The 1st of the client's current local month, at localHourToUse local
  // wall-clock — built the same "as-if-UTC, then shift back" way as
  // dayBoundaryInstant. JS Date arithmetic normalizes a month=-1 (January's
  // "previous month") into December of the prior year for free.
  const asIfUtcMs = Date.UTC(localY, localM, 1, wholeHour, minute, 0);
  return formatUtcTimestamp(asIfUtcMs - offsetMs);
}
