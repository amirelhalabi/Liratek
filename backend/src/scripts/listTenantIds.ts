#!/usr/bin/env node
/**
 * Phase D per-tenant restore support — thin wrapper around
 * `@liratek/core`'s `listTenantIdsFromPlatformDb`
 * (`packages/core/src/db/listTenantIds.ts`). Runs INSIDE the Fly container
 * (ships in `backend/dist`, same as `tenantSplitCli.js`).
 *
 * `docker-entrypoint.sh`'s per-tenant restore-on-empty-volume step used to
 * require an operator-set `TENANT_DATABASE_IDS_HINT` for every restore. This
 * script lets it derive the same list on its own, from the platform
 * database's own `tenants` table, once that file is present (already
 * restored, or never lost in the first place) — `TENANT_DATABASE_IDS_HINT`
 * remains supported as an optional override (see the entrypoint script).
 *
 * Usage:
 *
 *   node dist/scripts/listTenantIds.js <platformDbPath>
 *
 * Prints one tenant id per line to stdout (never `console.log` — backend
 * lint's `no-console` is an ERROR with no `log` exception) and exits `0`.
 * Any failure (missing file, wrong/missing SQLCipher key, no `tenants`
 * table) is reported on stderr via `console.error` and exits `1` — the
 * CALLER (the entrypoint shell script) decides what a failure means; this
 * script never guesses "zero tenants" out of an error, because that would
 * be indistinguishable from a platform database that genuinely has none
 * yet.
 *
 * Opens the platform file READ-ONLY: this script only ever reads, and a
 * read-only handle can never be the thing that corrupts a live database
 * that some other process (the app itself, if it happens to already be up)
 * has open at the same time.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import {
  resolveDatabaseKey,
  applySqlCipherKey,
  listTenantIdsFromPlatformDb,
} from "@liratek/core";

function usage(): never {
  console.error("Usage: listTenantIds <platformDbPath>");
  process.exit(2);
}

function main(): void {
  const [platformDbPath] = process.argv.slice(2);
  if (!platformDbPath) usage();

  if (!fs.existsSync(platformDbPath)) {
    console.error(`listTenantIds: no database at ${platformDbPath}`);
    process.exit(1);
  }

  let db: Database.Database;
  try {
    db = new Database(platformDbPath, { readonly: true });
  } catch (error) {
    console.error(
      `listTenantIds: failed to open ${platformDbPath}: ${String(error)}`,
    );
    process.exit(1);
    return;
  }

  try {
    const resolvedKey = resolveDatabaseKey();
    const keyResult = applySqlCipherKey(db, resolvedKey.key);
    if (resolvedKey.key && !keyResult.applied) {
      console.error(
        `listTenantIds: SQLCipher key present but could not be applied to ${platformDbPath}: ${keyResult.error || "unknown error"}`,
      );
      process.exit(1);
      return;
    }

    const ids = listTenantIdsFromPlatformDb(db);
    process.stdout.write(ids.map((id) => `${id}\n`).join(""));
  } catch (error) {
    console.error(
      `listTenantIds: failed to read tenants from ${platformDbPath}: ${String(error)}`,
    );
    process.exit(1);
    return;
  } finally {
    db.close();
  }
}

main();
