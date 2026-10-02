/**
 * Shared SQL day/time-bucketing fragments (LIRA-237) — kept in their OWN leaf
 * module, deliberately with no other repository import, so both
 * `ProfitRepository.ts` and `SalesRepository.ts` can use them without
 * creating a require cycle: `ProfitRepository.ts` already imports from
 * `TransactionRepository.ts`, which imports `SalesRepository.ts` — so a
 * direct `SalesRepository.ts → ProfitRepository.ts` import would close that
 * loop (`SalesRepository → ProfitRepository → TransactionRepository →
 * SalesRepository`). `ProfitRepository.ts` re-exports everything here (so
 * `ClosingRepository.ts`'s existing `import { dateRange } from
 * "./ProfitRepository.js"` keeps working unchanged); `SalesRepository.ts`
 * imports straight from this file instead of through `ProfitRepository.ts`.
 *
 * See CLAUDE.md rule 27 and LIRA-237: SQLite `'localtime'` reads the QUERY
 * HOST's OS timezone, which is the shop's own PC on desktop but a Fly
 * container running UTC (no `TZ` pinned, on purpose) on web — so a hardcoded
 * `'localtime'` buckets a web report's rows into the SERVER's day, not the
 * shop's, for the ~3h/night the two disagree (00:00–03:00 Beirut).
 */

import { clientTzOffsetMinutes } from "../utils/requestDay.js";

/**
 * The SQLite time-shift modifier reporting queries use to view a stored UTC
 * timestamp as the OPERATOR's wall-clock day, in place of a hardcoded
 * `'localtime'`.
 *
 * Desktop/CLI/migrations: no request-scoped client offset exists (no active
 * `runWithTenant()` scope, or a scope that never got a
 * `clientTzOffsetMinutes`) — returns SQLite's own `'localtime'` modifier
 * unchanged, which reads the machine's OS timezone. That machine IS the
 * shop's own PC on desktop, so behavior there is byte-for-byte unchanged.
 *
 * Web (rule 27): the Fly host runs UTC with no `TZ` pinned, on purpose — so
 * `'localtime'` there is the CONTAINER's day, not the shop's. Never "fix"
 * this by pinning `TZ` on the server (rule 27 again — that hides the bug for
 * one tenant while leaving every other tenant's zone silently wrong).
 * Instead `authenticateJWT` (`backend/src/middleware/auth.ts`) reads the
 * BROWSER's own UTC offset off the `X-Client-Tz-Offset` request header
 * (minutes to ADD to a UTC instant to reach the browser's local wall clock —
 * the JS convention `-date.getTimezoneOffset()`) and threads it through
 * `runWithTenant`'s `clientTzOffsetMinutes` option, alongside `clientDay`.
 * This reads it back (`clientTzOffsetMinutes()`, `utils/requestDay.js`) and
 * returns the equivalent SQLite numeric modifier instead — e.g. `'180
 * minutes'` for a Beirut browser (UTC+3) — so a row is bucketed into the
 * BROWSER's day, not the Fly container's.
 *
 * Returns the modifier ALREADY QUOTED as a SQL string literal (`'localtime'`
 * or `'180 minutes'`) so every call site interpolates it directly:
 * `datetime(${col}, ${localtimeModifier()})`. The minutes value was
 * validated and clamped to an integer in `[-840, 840]` by
 * `tenantContext.ts` before it ever reaches here (never the raw header
 * text), so inlining it is safe — there is nothing here for a header to
 * inject.
 *
 * ⚠ KNOWN PLATFORM LIMITATION (do not silently rework the fallback — see
 * `docs/plans/ongoing_plans/...` / the task note this was investigated
 * under): on Windows, better-sqlite3's bundled SQLite does not reliably
 * parse an IANA zone name placed in `process.env.TZ` (e.g. `TZ=Asia/Beirut`
 * — exactly what this package's own `npm test` script pins via
 * `cross-env`), and `'localtime'` can compute an offset a couple of hours
 * off the real one, while Node's own `Date` getters resolve the SAME
 * `process.env.TZ` correctly on every platform. A fallback that instead
 * computed the modifier from `Date.getTimezoneOffset()` was tried and
 * reverted: dozens of tests across this suite (`*.webTodayTzOffset.test.ts`,
 * `ClosingRepository.localBusinessDay.test.ts`,
 * `ProfitRepository.localBusinessDay.test.ts`, …) deliberately assert the
 * OPPOSITE contract — "without a client offset, the fallback is INERT and
 * trusts SQLite's own `'localtime'` verbatim, whatever that resolves to on
 * this runner" — precisely so a query never disagrees with ITSELF across
 * its own two sides. Those tests derive their "today" expectation from
 * SQLite directly rather than from JS `Date`, so they are immune to this
 * quirk by construction. Any future fix for the Windows-only mismatch needs
 * to change what the C runtime resolves (or stop pinning an IANA string at
 * test-launch), not swap this fallback for a JS-computed approximation.
 *
 * Never call `date(col, 'localtime')` / `datetime(col, 'localtime')`
 * directly in a NEW reporting query — call this (or {@link localDayExpr})
 * so every caller shifts the SAME way (rule 14).
 */
export function localtimeModifier(): string {
  const minutes = clientTzOffsetMinutes();
  return minutes === undefined ? "'localtime'" : `'${minutes} minutes'`;
}

/**
 * `DATE(col, <modifier>)` using {@link localtimeModifier}'s modifier — the
 * per-row "which calendar day does this timestamp fall on" expression used
 * by `ProfitRepository.getByDate`'s per-day CTEs and
 * `SalesRepository.getChartData`'s day-bucketing. `col` may also be the
 * literal `'now'` (already quoted by the caller) to shift SQLite's own
 * current instant the same way `SalesRepository`'s `DATE('now', ...)` "today"
 * queries need.
 */
export function localDayExpr(col: string): string {
  return `DATE(${col}, ${localtimeModifier()})`;
}

/**
 * `col`'s calendar day equals "today", both sides shifted by the SAME
 * {@link localtimeModifier} — the `DATE(col, 'localtime') = DATE('now',
 * 'localtime')` predicate `SalesRepository`'s dashboard "today" stats used
 * to hand-roll four times (LIRA-237). Replaces it everywhere it appears so a
 * web request's "today" is the BROWSER's today, not the Fly host's (rule
 * 27) — see {@link localtimeModifier}'s doc comment for the full mechanism.
 */
export function isToday(col: string): string {
  return `${localDayExpr(col)} = ${localDayExpr("'now'")}`;
}

/**
 * `col`'s calendar MONTH (`YYYY-MM`) equals "this month", both sides
 * shifted by the SAME {@link localtimeModifier} — the
 * `strftime('%Y-%m', col, 'localtime') = strftime('%Y-%m', 'now', 'localtime')`
 * predicate `FinancialServiceRepository.getAnalytics()`'s "this month" card
 * used to hand-roll twice (LIRA-237 wave 2). Same rationale as
 * {@link isToday}: a transaction made in the last ~3 hours of a UTC month
 * that is already the 1st of the next month in Beirut used to be booked
 * into the wrong month's card on web.
 */
export function isThisMonth(col: string): string {
  const mod = localtimeModifier();
  return `strftime('%Y-%m', ${col}, ${mod}) = strftime('%Y-%m', 'now', ${mod})`;
}

/**
 * Inclusive [from, to] date-range bound on a timestamp column (two bind
 * params).
 *
 * The column is converted to the OPERATOR's wall-clock (via
 * {@link localtimeModifier}) before comparison, so the range is interpreted
 * in the operator's local day, not the query host's. `ProfitService` passes
 * `"${from} 00:00:00"` / `"${to} 23:59:59"`, so a sale at 01:00 Beirut
 * (stored as the previous UTC day) lands in the local day the operator
 * expects — on desktop via the machine's own OS zone, on web via the
 * client's offset (LIRA-237; see {@link localtimeModifier}'s doc comment for
 * the full mechanism). Non-sargable (defeats a `created_at` index) — same
 * cost the other `'localtime'`-derived reporting queries already pay.
 *
 * Exported (same precedent as `ProfitRepository.notRefunded`/`activeExpense`)
 * so every caller binds the SAME predicate text — the daily closing snapshot
 * and the Profits page then bound their windows identically (rule 14)
 * instead of a second hand-written `strftime('%Y-%m', …)` form drifting from
 * this one.
 */
export function dateRange(col: string): string {
  const mod = localtimeModifier();
  return `datetime(${col}, ${mod}) >= ? AND datetime(${col}, ${mod}) <= ?`;
}
