/**
 * REQUEST-path "now" for business timestamps (LIRA-306, R11, FR-021).
 * **Server-only — never import from a module reachable by `browser.ts`**
 * (it reads `db/tenantContext.ts`, i.e. `node:async_hooks`; rule 29).
 *
 * Inside an offline replay the tenant context carries the event's
 * (corrected) instant, and every row the replay writes must carry that time —
 * the sale happened then, not when the PC reconnected. Everywhere else this
 * is simply the current time. ONE output format: the `YYYY-MM-DD HH:MM:SS`
 * UTC text SQLite's `CURRENT_TIMESTAMP` produces, so existing string
 * date-range filters keep matching.
 *
 * A time the user typed (`transaction_time`, backdating) still wins at each
 * call site: `transaction_time ?? requestNow()`.
 */
import { getContextEffectiveNow } from "../db/tenantContext.js";

/** An instant (ISO text or Date) as SQLite's CURRENT_TIMESTAMP text, UTC. */
export function toSqliteUtc(instant: string | Date): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function requestNow(): string {
  const eff = getContextEffectiveNow();
  return toSqliteUtc(eff ?? new Date());
}

/** True while an offline replay supplied the time (used by writers that
 *  must not fall back to a SQL clock default). */
export function hasEffectiveNow(): boolean {
  return getContextEffectiveNow() !== undefined;
}
