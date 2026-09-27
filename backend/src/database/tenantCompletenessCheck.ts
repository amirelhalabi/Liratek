/**
 * Tenant-file completeness check (`docs/plans/ongoing_plans/
 * PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.4, ticket item 2): compares
 * the platform's own `tenants` registry against the tenant ids the
 * per-tenant database directory lister actually found on disk, at boot.
 *
 * Pure function, zero imports — same reasoning as `migrateAllTenants.ts` /
 * `tenantDirLister.ts`: `connection.ts` uses `import.meta.url` and can never
 * be `require()`-d for real under this backend's CommonJS-mode ts-jest, so
 * anything it needs to call is pulled out here, where it CAN be unit-tested
 * directly instead of only ever mocked away.
 *
 * Status handling:
 *   - `active` / `suspended` tenants are EXPECTED to have their own file. No
 *     file for one of these ⇒ a hard finding (`missingIds`) — a shop whose
 *     customer can still try to log in, with nowhere for its data to live.
 *     This is the exact silent-outage the ticket opened with: flipping
 *     `TENANT_DB_MODE=per-tenant` before running the Phase D split leaves
 *     `/data/tenants` empty while the boot summary still says
 *     `{ok:0,failed:0}` — because there is nothing to migrate when nothing
 *     was found, `migrateAllTenants()` alone can never notice a tenant that
 *     ought to exist but doesn't. This check is what notices it.
 *   - `provisioning` is a transient, PLATFORM-ONLY status: a two-step
 *     provision (§ 12.2) writes the `tenants` row FIRST and builds the shop
 *     file SECOND, so a tenant can legitimately sit in `provisioning` with
 *     no file yet for the normal, few-hundred-millisecond span between those
 *     two writes — and indefinitely if that second step crashed. Neither
 *     case is a boot-time failure: excluded from `missingIds` entirely, and
 *     reported separately (`provisioningIds`) as its own, warning-level
 *     finding worth an operator's attention.
 *   - `archived` is EXCLUDED from the expected set on purpose: deleting a
 *     shop archives its file OUT of the tenants directory (B-D4, to
 *     `archive/<id>-<timestamp>.db`), so "no file at `<id>.db`" is exactly
 *     the correct, intended end state for an archived tenant, not a gap.
 *
 * A file whose id matches NO platform tenant row at all, of any status, is
 * an orphan (`orphanIds`) — reported as a warning, never a failure: it does
 * not mean a shop is down, only that disk and registry disagree (e.g. a
 * stray file left over from a bug), which is worth a human's eyes but
 * blocks nobody.
 */

/** Tenant statuses expected to have their own database file. Exported so a
 * caller can log a matching, explicit rationale rather than re-deriving
 * which statuses "count" from this module's behaviour alone (rule 14: one
 * definition, reused). */
export const EXPECTED_TENANT_STATUSES = ["active", "suspended"] as const;

export interface TenantStatusRow {
  id: number;
  status: string;
}

export interface TenantCompletenessResult {
  /** Expected (active/suspended) tenant ids with no file found on disk. */
  missingIds: number[];
  /** Files found with no matching platform tenant row of ANY status. */
  orphanIds: number[];
  /** Tenants currently in 'provisioning' — always reported, never counted
   * as missing regardless of whether their file exists yet. */
  provisioningIds: number[];
}

/**
 * `tenantRows`: every row from the platform `tenants` table (e.g.
 * `TenantRepository.listAllRows()`). `foundIds`: the tenant ids with a
 * `<id>.db` file, from the directory lister
 * (`listTenantDatabaseIdsFromDir()`).
 */
export function checkTenantCompleteness(
  tenantRows: TenantStatusRow[],
  foundIds: number[],
): TenantCompletenessResult {
  const foundSet = new Set(foundIds);
  const knownIds = new Set(tenantRows.map((t) => t.id));
  const expectedStatuses: readonly string[] = EXPECTED_TENANT_STATUSES;

  const missingIds = tenantRows
    .filter((t) => expectedStatuses.includes(t.status) && !foundSet.has(t.id))
    .map((t) => t.id)
    .sort((a, b) => a - b);

  const provisioningIds = tenantRows
    .filter((t) => t.status === "provisioning")
    .map((t) => t.id)
    .sort((a, b) => a - b);

  const orphanIds = foundIds
    .filter((id) => !knownIds.has(id))
    .sort((a, b) => a - b);

  return { missingIds, orphanIds, provisioningIds };
}
