/**
 * Reads the tenant ids the PLATFORM database itself knows about — its own
 * `tenants` table — as opposed to `tenantDatabaseIds.ts` / the backend's
 * `tenantDirLister.ts`, which answer "which shop FILES already exist on
 * disk". This is the "which shops SHOULD have a file" side of that question
 * (plan `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.4, ticket item 2):
 * driving `docker-entrypoint.sh`'s per-tenant restore-on-empty-volume step
 * without a manually-set `TENANT_DATABASE_IDS_HINT`.
 *
 * Deliberately takes an already-open connection rather than a path: opening
 * the file (read-only, with whatever SQLCipher key applies) is
 * environment-specific plumbing that belongs in the thin CLI wrapper
 * (`backend/src/scripts/listTenantIds.ts`), not here — this function has
 * zero imports (not even `better-sqlite3`; the type below is erased at
 * compile time), so it is trivially testable in core jest against a real
 * temp database with no fs/subprocess involved.
 */
import type Database from "better-sqlite3";

export function listTenantIdsFromPlatformDb(db: Database.Database): number[] {
  const rows = db
    .prepare(`SELECT id FROM tenants ORDER BY id`)
    .all() as { id: number }[];
  return rows.map((r) => r.id);
}
