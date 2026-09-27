/**
 * Shop-id listing contract (Phase B–D prep, `docs/plans/ongoing_plans/
 * PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.2/§ 12.3 W3).
 *
 * Core needs a way to ask "which tenant ids have their own database file
 * right now" without knowing what a file system is — no Node imports here,
 * this module is reachable from BOTH entry points in principle, but is only
 * ever exported from `index.ts` (rule 29's discipline still applies: keep it
 * pure so it COULD be reached from `browser.ts` without breaking the bundle,
 * even though nothing currently re-exports it there).
 *
 * Only the web backend, in `TENANT_DB_MODE=per-tenant`, ever installs a
 * lister (`backend/src/database/connection.ts`, reading the tenants
 * directory via `tenantDirLister.ts`). Desktop and shared-mode web never do,
 * so `listTenantDatabaseIds()` returns `null` there — every caller MUST
 * treat `null` as "no per-tenant fan-out is possible here", not as "zero
 * tenants". Wave-2 consumers (admin tenant list, session sweeps, any
 * cross-tenant fan-out per § 12.2) read this instead of querying the
 * platform `tenants` table for the id list, because in per-tenant mode a
 * shop can exist as a platform `tenants` row without its file having been
 * created yet (a provisioning failure between the two writes, § 12.2's
 * two-step provisioning), or a stray file can exist with no matching
 * platform row after a bug — the lister answers "which files can actually
 * be opened right now", which is the only question a fan-out can safely act
 * on. It is not a substitute for the `tenants` table as the registry of
 * record.
 */

let lister: (() => number[]) | null = null;

/**
 * Install (or, with `null`, clear) the function that lists tenant database
 * ids. Exactly one installer exists in the process at a time — the last call
 * wins, matching `setDatabaseResolver`'s shape (§ 11.1) so the two seams stay
 * consistent. Only `backend/src/database/connection.ts` calls this, and only
 * in `per-tenant` mode; every other caller (desktop, shared-mode web, tests
 * that don't opt in) leaves it uninstalled.
 */
export function setTenantDatabaseIdLister(fn: (() => number[]) | null): void {
  lister = fn;
}

/**
 * Returns the current list of tenant ids with their own database file, or
 * `null` if no lister is installed (shared mode, desktop, or a test that
 * never called `setTenantDatabaseIdLister`). Never throws on "no lister" —
 * that is a normal, expected state, not an error.
 */
export function listTenantDatabaseIds(): number[] | null {
  if (!lister) return null;
  return lister();
}
