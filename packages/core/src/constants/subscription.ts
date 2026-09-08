/**
 * Subscription policy constants — ONE definition, both transports and the UI.
 *
 * Pure data with no Node.js dependencies, so it can be exported from
 * `browser.ts` as well as `index.ts`. That matters: the frontend hides modules
 * a tenant is not entitled to, and it must apply the SAME ungateable rule the
 * backend enforces. A second copy of this list in `frontend/src` is exactly
 * the duplicated business rule rule 14 forbids — and the copy would drift the
 * first time a module was added.
 */

/** Days of full function after the paid period ends, before read-only. */
export const GRACE_PERIOD_DAYS = 7;

/**
 * Modules an allowlist can NEVER remove.
 *
 * These are the app's chassis (`is_system = 1` in the `modules` seed), not
 * features anyone buys. Gating `settings` would be self-defeating in the most
 * literal way: the licence key is entered THERE, so a shop locked out of
 * Settings could never fix its own subscription. `dashboard` is the landing
 * route, and `audit`/`closing` are how a shop reconciles money it has already
 * taken — withholding those turns a billing question into lost books.
 */
export const UNGATEABLE_MODULES: readonly string[] = [
  "dashboard",
  "settings",
  "audit",
  "closing",
];

/** Whether a module key is exempt from entitlement checks entirely. */
export function isUngateableModule(moduleKey: string): boolean {
  return UNGATEABLE_MODULES.includes(moduleKey);
}
