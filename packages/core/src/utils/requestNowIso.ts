/**
 * REQUEST-path "now" as an ISO-8601 instant (LIRA-306, FR-021) — for the few
 * writers that have always stored a JS ISO timestamp (`expense_date` of the
 * auto SMS-fee and Line_Usage expenses) rather than SQLite's text format.
 * Inside an offline replay it is the event's (corrected) instant, otherwise
 * the current time — same rule as `requestNow()`, kept in ISO so existing
 * rows and readers see no format change.
 *
 * **Server-only — never import from a module reachable by `browser.ts`**
 * (it reads `db/tenantContext.ts`, i.e. `node:async_hooks`; rule 29).
 */
import { getContextEffectiveNow } from "../db/tenantContext.js";

export function requestNowIso(): string {
  const eff = getContextEffectiveNow();
  return (eff ? new Date(eff) : new Date()).toISOString();
}
