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
 * On the desktop app the machine IS the shop's PC (Beirut), so `localDay()`
 * is always correct there — it, and this whole module, remain fine for
 * desktop/CLI code and for migrations, which never run per-request.
 *
 * On the web backend the machine is a Fly container with no `TZ` set (UTC),
 * NOT the shop's clock — see CLAUDE.md rule 27. Do NOT "fix" that by pinning
 * `TZ=Asia/Beirut` on the server: that hides the symptom for one tenant while
 * leaving every other tenant in a different zone silently wrong, and trades a
 * visible bug for an invisible one. For any REQUEST-path caller that needs
 * the shop's actual calendar day, use `clientDay()` below instead of
 * `localDay()` — it prefers the day the client itself supplied (via
 * `runWithTenant()`'s `clientDay` option / the `X-Client-Day` header) and
 * only falls back to this machine's day when none was supplied.
 */

import { ValidationError } from "./errors.js";
import { getContextClientDay } from "../db/tenantContext.js";

const pad = (n: number): string => n.toString().padStart(2, "0");

/** Local calendar day as `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The CLIENT's own local calendar day (`YYYY-MM-DD`) for a REQUEST-path
 * caller: the value set in the current tenant-context scope (see
 * `runWithTenant()`'s `clientDay` option in `db/tenantContext.ts`) if one is
 * present, else this machine's own `localDay()`.
 *
 * Use this instead of `localDay()` in any repository/service method reached
 * from an HTTP request or IPC call whose answer depends on "what day is it
 * for the shop" — voucher expiry, carrier-line validity, login balance
 * checks, checkpoints, and anything else CLAUDE.md rule 27 calls a
 * dual-transport hazard. On desktop there is never an active
 * `runWithTenant()` scope (the fixed-tenant fallback carries no day), so
 * `clientDay()` reduces to `localDay()` there automatically — no behavior
 * change for desktop, CLI tools, or migrations, which should keep calling
 * `localDay()` directly (they don't run inside a request context anyway).
 *
 * An explicit parameter a caller already threads through (`closing_date`,
 * `client_day`, `day`, …) still wins over this — those are checked BEFORE
 * falling back to `clientDay()`, exactly as they fell back to `localDay()`
 * before this existed. This function only removes the need to add a NEW
 * explicit parameter for every future caller.
 */
export function clientDay(): string {
  return getContextClientDay() ?? localDay();
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
