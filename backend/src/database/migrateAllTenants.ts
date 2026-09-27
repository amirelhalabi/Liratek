/**
 * Boot-time "migrate every tenant file" step (§ 12.2: "Every shop file is
 * migrated at boot, not only on first request. That makes the deploy
 * verifier meaningful. A failure is logged for that shop and not fatal.").
 *
 * Split out of `connection.ts` into its own leaf module for the same reason
 * every other file in this directory is: `connection.ts` uses
 * `import.meta.url` and can never be `require()`-d for real under backend
 * jest. Pure function — no imports at all — so it is unit-testable with a
 * fake pool and no real files or timers.
 */

/** The subset of `TenantDatabasePool` this step needs: `get(id)` opens (and,
 * on first open, migrates) the connection — the side effect this function
 * exists to trigger. The return value is never read; a throw is the only
 * signal this cares about. */
export interface MigratableTenantPool {
  get(tenantId: number): unknown;
}

export interface MigrateAllTenantsResult {
  ok: number;
  failed: number;
  failedIds: number[];
}

/**
 * Calls `pool.get(id)` for every id in `ids`, catching each failure
 * individually — one bad tenant file must never stop the others from being
 * migrated (the pool already poisons that one tenant for the rest of the
 * process; this loop's job is only to make sure `get()` is actually CALLED
 * for every id at boot, instead of lazily on that tenant's first request).
 * `onError` is called once per failure so the caller can log it with
 * whatever logger it has (this module has none, by design — see the header).
 */
export function migrateAllTenants(
  ids: number[],
  pool: MigratableTenantPool,
  onError: (tenantId: number, error: unknown) => void,
): MigrateAllTenantsResult {
  let ok = 0;
  const failedIds: number[] = [];

  for (const id of ids) {
    try {
      pool.get(id);
      ok += 1;
    } catch (error) {
      failedIds.push(id);
      onError(id, error);
    }
  }

  return { ok, failed: failedIds.length, failedIds };
}
