/**
 * Reads the tenant databases directory and returns the tenant ids that have
 * their own file (Phase B–D prep, `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 12.2/§ 12.3 W3). Split out of `connection.ts` into its own leaf module
 * for the same reason `tenantDbResolver.ts`/`idleSweep.ts`/
 * `openAndConfigure.ts` are: `connection.ts` uses `import.meta.url` and can
 * never be `require()`-d for real under backend jest (see
 * `tenantDbResolver.ts`'s header). Zero imports here that trip that
 * limitation, so this is unit-testable directly against real temp
 * directories instead of only ever mocked away.
 *
 * Installed as `@liratek/core`'s `setTenantDatabaseIdLister` in per-tenant
 * mode only (`connection.ts`); this module itself has no opinion on mode.
 */
import fs from "node:fs";

/** Matches `<positive integer>.db` exactly — no leading zero (`0.db` is not
 * a positive integer), no `-wal`/`-shm` (no `.db` suffix on those), no
 * `archive/…` (that is a subdirectory, and this only reads files at the top
 * level — `fs.readdirSync` is deliberately non-recursive here), no temp
 * files (`.db.tmp`, `.db-journal`, anything without the exact `.db` tail). */
const TENANT_DB_FILENAME = /^([1-9]\d*)\.db$/;

/**
 * Lists the tenant ids with a database file directly inside `dir`, sorted
 * ascending. A missing directory is treated as "no tenants yet" (`[]`), not
 * an error — this is exactly the state of a brand-new per-tenant deployment
 * before Phase D has moved anything, or a fresh volume before the first
 * shop file is restored/provisioned. Any other read failure (permissions,
 * `dir` being a file, …) propagates, since that is a real misconfiguration
 * worth failing loudly on rather than silently reporting zero tenants.
 */
export function listTenantDatabaseIdsFromDir(dir: string): number[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const ids: number[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue; // skips `archive/` and any other subdirectory
    const match = TENANT_DB_FILENAME.exec(entry.name);
    if (!match) continue;
    ids.push(Number(match[1]));
  }
  return ids.sort((a, b) => a - b);
}

/** Matches `perTenantStorageProvisioner.ts`'s `deleteTenant()` archive
 * filename shape exactly: `<tenantId>-<ISO timestamp with `:`/`.` turned into
 * `-`>.db` (e.g. `5-2026-09-27T12-00-00-000Z.db`). Deliberately requires the
 * `.db` tail so a sidecar renamed alongside it (`…db-wal`, `…db-shm`) never
 * matches — those don't end in `.db`. */
const ARCHIVED_TENANT_DB_FILENAME = /^([1-9]\d*)-.+\.db$/;

/**
 * Lists the tenant ids that have at least one ARCHIVED database file
 * directly inside `archiveDir` (`<tenantsDir>/archive/`), sorted ascending.
 * A missing directory is "no archives yet" (`[]`), same convention as
 * `listTenantDatabaseIdsFromDir`.
 *
 * Used solely to compute the AUTOINCREMENT floor a new tenant id must clear
 * (`perTenantStorageProvisioner.ts`'s `createTenant()`): a deleted tenant's
 * archived file still occupies its id on disk even though the tenant is gone
 * from the registry, so a restored platform file must never hand that id
 * back out either.
 */
export function listArchivedTenantDatabaseIdsFromDir(
  archiveDir: string,
): number[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(archiveDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const ids: number[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = ARCHIVED_TENANT_DB_FILENAME.exec(entry.name);
    if (!match) continue;
    ids.push(Number(match[1]));
  }
  return ids.sort((a, b) => a - b);
}
