/**
 * REQUEST-path calendar day. **Server-only — never import this from a module
 * reachable by the browser bundle.**
 *
 * This lives apart from `utils/localDate.ts` for one hard reason: it reaches
 * into `db/tenantContext.ts`, which imports `node:async_hooks`. `localDate.ts`
 * is re-exported through `browser.ts` (transitively, via
 * `utils/carrierLineValidity.ts`), so putting `clientDay()` there drags a Node
 * built-in into Vite's graph and the Vercel build dies at bundle time —
 * `tsc --noEmit` passes happily, because typechecking does not care about
 * bundling. That regression shipped once (`5f323027`); this split is the fix.
 * Same class of problem as the `formatMoney.ts` extraction: a browser-facing
 * module must stay a leaf.
 */

import {
  getContextClientDay,
  getContextClientTzOffsetMinutes,
} from "../db/tenantContext.js";
import { localDay } from "./localDate.js";

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

/**
 * LIRA-237 — the CLIENT browser's own UTC offset in minutes (the JS
 * convention `-date.getTimezoneOffset()`; Beirut/UTC+3 is `180`), for a
 * REQUEST-path caller that needs to convert a stored UTC timestamp to the
 * client's wall-clock DAY inside SQL (a numeric shift, unlike `clientDay()`'s
 * day-label string). `undefined` — never a machine fallback — when no
 * request supplied one: `ProfitRepository.localtimeModifier()` is the only
 * caller today, and it falls back to SQLite's own `'localtime'` modifier
 * itself in that case (desktop/CLI/migrations — unchanged behavior, since
 * `'localtime'` already reads the machine's OS zone correctly there).
 */
export function clientTzOffsetMinutes(): number | undefined {
  return getContextClientTzOffsetMinutes();
}
