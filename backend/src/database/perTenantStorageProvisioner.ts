/**
 * Per-tenant-mode implementation of core's `TenantStorageProvisioner` port
 * (Phase C, `docs/plans/ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 12.2/12.3, table rows #9/#10).
 *
 * Split into its own leaf module for the same reason every other file in
 * this directory is: `connection.ts` uses `import.meta.url` and can never be
 * `require()`-d for real under backend jest. Every filesystem/db-opening
 * concern is INJECTED (dir, pool, raw-open factory, connection configurer,
 * migration runner, the create_db.sql text itself) so this is unit-testable
 * against real temp directories without needing `connection.ts`'s own
 * module-load-time wiring.
 *
 * ── createTenant() — § 12.2's two-step provisioning ──
 *
 *   a. Compute `maxIdOnDisk` from the tenants directory (every live
 *      `<id>.db` AND every archived `<id>-<timestamp>.db` under `archive/`).
 *      ONE platform transaction: raise `tenants`' own AUTOINCREMENT floor
 *      above `maxIdOnDisk` (`TenantRepository.raiseSequenceFloor`, BEFORE the
 *      insert below), insert the `tenants` row (status 'provisioning',
 *      migration v187) + the `tenant_subscriptions` row. The floor raise is
 *      the id-reuse-after-restore fix: the platform file and the `tenants/`
 *      directory are two SEPARATE Litestream replicas (§ 12.4), so a
 *      platform-only restore can roll `sqlite_sequence` back to an older
 *      snapshot while shop files newer than that snapshot are untouched on
 *      disk — without this, the very next ordinary provisioning call would
 *      silently reissue one of those ids
 *      (`tenantIdReuseAfterRestore.adversarial.test.ts`).
 *   b. Build the shop's database at a TEMP path inside the tenants dir,
 *      named so the directory lister (`^[1-9]\d*\.db$`) never sees it:
 *      open + configure (pragmas, SQLCipher key), exec create_db.sql,
 *      correct its desktop-only seed (delete the `tenants(id=1,'Default')`
 *      and `tenant_subscriptions(tenant_id=1)` rows create_db.sql always
 *      writes; insert ONE local `tenants` row at the REAL id/name/slug and
 *      NO `tenant_subscriptions` rows — that table lives in the platform
 *      file only, § 12.2), `runMigrations`, `TenantRepository(tempDb).
 *      seedConfig(id, name)` (explicit db override — Phase A kept this on
 *      `TenantRepository`/`SubscriptionRepository`, just not on
 *      `UserRepository`, which is why the admin row below is a raw
 *      parameterized INSERT rather than going through `UserRepository`),
 *      then the first admin user, then `PRAGMA foreign_key_check`.
 *   c. Close. Immediately before the rename: refuse (throw) if `<id>.db` (or
 *      its -wal/-shm) already exists, or if an archived file already exists
 *      for this id under `archive/` — belt-and-braces against the floor
 *      raise in (a) ever being bypassed, since `fs.renameSync` on both
 *      Windows and Linux SILENTLY REPLACES an existing destination file
 *      (POSIX rename() semantics), which is exactly how this bug
 *      overwrote a live shop's database with no error. Both checks and the
 *      rename are synchronous fs calls with no `await` between them, so
 *      there is no window for another operation in this process to create
 *      the destination in between. Otherwise atomically rename temp ->
 *      `<id>.db`, flip the platform row to 'active'.
 *   d. On ANY failure after (a): close/delete the temp file (+ -wal/-shm),
 *      delete the platform rows from (a), rethrow. Also removes a
 *      would-be-final `<id>.db` if THIS attempt is the one that renamed onto
 *      it (a failure happened AFTER the rename but before the status flip)
 *      — "on ANY failure" must leave nothing routable behind for an id whose
 *      platform row is about to vanish, but must NEVER touch a pre-existing
 *      file that belongs to another tenant (the refusal case in (c)).
 *
 * ── deleteTenant() — B-D4 ──
 *
 * Evicts any pooled connection (checkpoint + close), opens the file itself
 * briefly to count rows (for the same `{tablesCleared, rowsDeleted}` shape
 * `deleteTenantCascade` reports in shared mode) and force a checkpoint,
 * moves `<id>.db` (+ -wal/-shm) to `<tenantsDir>/archive/<id>-<UTC
 * timestamp>.db`, and ONLY THEN removes the platform `tenants` +
 * `tenant_subscriptions` rows — if the archive move throws, execution never
 * reaches that last step, so the platform rows are untouched.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  TenantRepository,
  type TenantEntity,
  type TenantStorageProvisioner,
  type CreateTenantStorageInput,
  type TenantStorageDeleteResult,
  type SubscriptionStatus,
} from "@liratek/core";
import { dbLogger } from "@liratek/core";
import {
  listTenantDatabaseIdsFromDir,
  listArchivedTenantDatabaseIdsFromDir,
} from "./tenantDirLister.js";

/** The subset of `TenantDatabasePool` this provisioner needs. */
export interface PerTenantPoolLike {
  evict(tenantId: number): boolean;
}

/** The subset of `TenantRepository` this provisioner needs on the PLATFORM
 * connection (ambient `getDatabase()` — the caller is always already inside
 * `runWithoutTenant()`, admin.ts/auth.ts's existing contract). Narrowed to an
 * interface so tests can inject a fake instead of a real repository. */
export interface PlatformTenantRepoLike {
  runInTransaction<R>(fn: () => R): R;
  create(data: {
    name: string;
    slug: string;
    contact_name: string | null;
    contact_phone: string | null;
    notes: string | null;
  }): TenantEntity;
  update(
    id: number,
    data: { status: "provisioning" | "active" },
  ): TenantEntity | null;
  deleteRegistryRow(id: number): void;
  raiseSequenceFloor(minId: number): void;
}

export interface PlatformSubscriptionRepoLike {
  createForTenant(
    tenantId: number,
    data: {
      plan: string;
      status: SubscriptionStatus;
      current_period_end: string | null;
      entitled_modules: string | null;
    },
  ): unknown;
  deleteForTenant(tenantId: number): void;
}

export interface PerTenantStorageProvisionerOptions {
  /** Directory holding one file per tenant, named `<tenantId>.db`. */
  tenantsDir: string;
  pool: PerTenantPoolLike;
  /** Opens a raw (unconfigured) connection to a file — `(fp) => new Database(fp)`. */
  openRawDatabase: (filePath: string) => Database.Database;
  /** Pragmas + SQLCipher key — the SAME function `connection.ts` applies to
   * every connection it opens (`configureConnection`), so a tenant file is
   * never held to a different contract than the platform file. */
  configureConnection: (db: Database.Database) => void;
  /** `runMigrations` from `@liratek/core`. */
  runMigrations: (db: Database.Database) => void;
  /** The verbatim contents of `electron-app/create_db.sql`, injected so this
   * module needs no filesystem path resolution of its own (that concern
   * stays in `connection.ts`, which already reads this file for the
   * platform database's own fresh-install bootstrap). */
  createDbSql: string;
  platformTenantRepo: PlatformTenantRepoLike;
  platformSubscriptionRepo: PlatformSubscriptionRepoLike;
  /** Injectable clock for deterministic archive-filename tests. */
  clock?: () => Date;
}

const TENANT_SCOPED_STATS_EXCLUDED_TABLES = new Set([
  "tenants",
  "tenant_subscriptions",
  "schema_migrations",
]);

function removeFileAndSidecars(filePath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${filePath}${suffix}`;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (error) {
      dbLogger.error(
        { path: p, error },
        "perTenantStorageProvisioner: failed to remove leftover tenant db file during cleanup",
      );
    }
  }
}

export function createPerTenantStorageProvisioner(
  opts: PerTenantStorageProvisionerOptions,
): TenantStorageProvisioner {
  const clock = opts.clock ?? (() => new Date());

  function finalPathFor(tenantId: number): string {
    return path.join(opts.tenantsDir, `${tenantId}.db`);
  }

  function tempPathFor(tenantId: number): string {
    // Leading '.' AND no bare `<id>.db` shape: the dir lister's regex is
    // `^[1-9]\d*\.db$`, so this stays invisible to it while being built.
    return path.join(
      opts.tenantsDir,
      `.${tenantId}.db.provisioning-${randomUUID()}`,
    );
  }

  return {
    createTenant(input: CreateTenantStorageInput): TenantEntity {
      // AUTOINCREMENT floor (id-reuse-after-restore fix, part 2 of 2 — part 1
      // is the existence check right before the rename below): a platform-
      // only Litestream restore can roll `sqlite_sequence` back to an older
      // snapshot while the `tenants/` directory on disk (a SEPARATE replica)
      // still holds `<id>.db`/archived files for ids the restored platform
      // file no longer knows about. Computed from disk EVERY call (not
      // cached) and applied inside the SAME platform transaction that
      // inserts the new row, before that insert, so the id `create()` is
      // about to hand out is already forced above every id with a file.
      const liveIds = listTenantDatabaseIdsFromDir(opts.tenantsDir);
      const archivedIds = listArchivedTenantDatabaseIdsFromDir(
        path.join(opts.tenantsDir, "archive"),
      );
      const maxIdOnDisk = Math.max(0, ...liveIds, ...archivedIds);

      const created = opts.platformTenantRepo.runInTransaction(() => {
        opts.platformTenantRepo.raiseSequenceFloor(maxIdOnDisk);
        const row = opts.platformTenantRepo.create({
          name: input.name,
          slug: input.slug,
          contact_name: input.contactName,
          contact_phone: input.contactPhone,
          notes: input.notes,
        });
        const provisioning = opts.platformTenantRepo.update(row.id, {
          status: "provisioning",
        });
        opts.platformSubscriptionRepo.createForTenant(row.id, {
          plan: "standard",
          status: "active",
          current_period_end: null,
          entitled_modules: null,
        });
        return provisioning ?? row;
      });

      const tenantId = created.id;
      const finalPath = finalPathFor(tenantId);
      const tempPath = tempPathFor(tenantId);

      let tempDb: Database.Database | null = null;
      // Only true once THIS attempt has renamed its own temp file onto
      // `finalPath` — guards the cleanup below from ever deleting a
      // PRE-EXISTING file at `finalPath` that belongs to another tenant (the
      // exact file the existence check right before the rename refuses to
      // clobber). Never set when that check throws.
      let renamedToFinal = false;
      try {
        fs.mkdirSync(opts.tenantsDir, { recursive: true });

        tempDb = opts.openRawDatabase(tempPath);
        opts.configureConnection(tempDb);
        tempDb.exec(opts.createDbSql);

        // Correct create_db.sql's desktop-only seed (§ 12.2): this file
        // must hold exactly ONE local `tenants` row, at the REAL id, and NO
        // `tenant_subscriptions` rows — that table lives in the platform
        // file only. create_db.sql's tenant-1 seed is not just the
        // `tenants`/`tenant_subscriptions` rows: it also seeds a default
        // admin `users` row and sample data (suppliers, ...) all carrying
        // `tenant_id = 1`, and every one of those rows still references the
        // `tenants(id=1)` row via a foreign key — a plain `DELETE FROM
        // tenants` fails immediately (foreign_keys is ON) while any of them
        // still exists. `TenantRepository.deleteTenantCascade` already does
        // exactly this cleanup correctly (schema-discovered tenant-scoped
        // tables, `defer_foreign_keys` so table ORDER cannot matter), so it
        // is reused here rather than re-deriving a second, incomplete
        // version of the same "wipe tenant 1's seed" predicate (rule 14).
        new TenantRepository(tempDb).deleteTenantCascade(1);
        tempDb
          .prepare(
            `INSERT INTO tenants (id, name, slug, status, contact_name, contact_phone, notes, created_at, updated_at)
             VALUES (?, ?, ?, 'active', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .run(
            tenantId,
            input.name,
            input.slug,
            input.contactName,
            input.contactPhone,
            input.notes,
          );

        opts.runMigrations(tempDb);

        // Explicit db override (Phase A kept this on TenantRepository) —
        // NOT the ambient resolver, since this file is not routable yet.
        new TenantRepository(tempDb).seedConfig(tenantId, input.name);

        // UserRepository extends BaseRepository, which has no explicit-db
        // override (only TenantRepository/SubscriptionRepository do) — a
        // raw parameterized INSERT here rather than reaching for it. `users`
        // has no created_at/updated_at columns (pre-existing schema shape,
        // matching create_db.sql's own admin seed at tenant 1 — not
        // something to "fix" in passing here).
        tempDb
          .prepare(
            `INSERT INTO users (username, password_hash, role, is_active, tenant_id)
             VALUES (?, ?, 'admin', 1, ?)`,
          )
          .run(input.adminUsername, input.passwordHash, tenantId);

        const violations = tempDb.pragma("foreign_key_check") as unknown[];
        if (Array.isArray(violations) && violations.length > 0) {
          throw new Error(
            `Foreign key violations while building tenant ${tenantId}: ${JSON.stringify(violations)}`,
          );
        }

        tempDb.close();
        tempDb = null;

        // Never overwrite. This is the belt to the floor-raise's braces: the
        // floor raise (above) should already make `finalPath` impossible to
        // collide with, but `fs.renameSync` on both Windows and Linux
        // SILENTLY REPLACES an existing destination file — matching POSIX
        // rename() semantics, not "refuse if exists" — so if the floor raise
        // were ever bypassed (a bug, a manually-inserted `tenants` row, a
        // future caller of this class), this is the last line standing
        // between an ordinary provisioning call and clobbering another
        // shop's live database with no error surfaced anywhere. No await
        // between this check and the rename below — both are synchronous
        // fs calls, so there is no window for another operation in this
        // process to create `finalPath` in between.
        if (
          fs.existsSync(finalPath) ||
          fs.existsSync(`${finalPath}-wal`) ||
          fs.existsSync(`${finalPath}-shm`)
        ) {
          throw new Error(
            `Refusing to provision tenant ${tenantId}: a database file already exists at ${finalPath}. ` +
              `This means the AUTOINCREMENT floor raise was bypassed or the tenants directory is out of ` +
              `sync with the platform registry — provisioning this id would destroy an existing shop's data.`,
          );
        }
        const archiveDir = path.join(opts.tenantsDir, "archive");
        if (listArchivedTenantDatabaseIdsFromDir(archiveDir).includes(tenantId)) {
          throw new Error(
            `Refusing to provision tenant ${tenantId}: an archived database file already exists for this ` +
              `id under ${archiveDir}. This means the AUTOINCREMENT floor raise was bypassed — provisioning ` +
              `this id risks reusing a deleted shop's id.`,
          );
        }

        fs.renameSync(tempPath, finalPath);
        renamedToFinal = true;

        const active = opts.platformTenantRepo.update(tenantId, {
          status: "active",
        });
        if (!active) {
          throw new Error(
            `Tenant ${tenantId} registry row vanished while finalizing provisioning`,
          );
        }
        return active;
      } catch (error) {
        if (tempDb) {
          try {
            tempDb.close();
          } catch {
            // Already broken; nothing useful to do with a close failure here.
          }
        }
        removeFileAndSidecars(tempPath);
        // Only clean up `finalPath` if THIS attempt is the one that put a
        // file there (a failure between rename and the status flip) — never
        // leave a routable file behind for an id whose platform row is about
        // to be deleted. If `renamedToFinal` is false, `finalPath` (if it
        // exists at all) belongs to some OTHER tenant — most likely the
        // exact pre-existing file the existence check above just refused to
        // overwrite — and must be left completely untouched.
        if (renamedToFinal) {
          removeFileAndSidecars(finalPath);
        }

        try {
          opts.platformTenantRepo.runInTransaction(() => {
            opts.platformSubscriptionRepo.deleteForTenant(tenantId);
            opts.platformTenantRepo.deleteRegistryRow(tenantId);
          });
        } catch (cleanupError) {
          dbLogger.error(
            { tenantId, error: cleanupError },
            "perTenantStorageProvisioner.createTenant: failed to roll back platform rows after a provisioning failure — manual cleanup needed",
          );
        }

        throw error;
      }
    },

    deleteTenant(tenant: TenantEntity): TenantStorageDeleteResult {
      const dbPath = finalPathFor(tenant.id);
      if (!fs.existsSync(dbPath)) {
        throw new Error(
          `No database file for tenant ${tenant.id} at ${dbPath} — refusing to report a deletion that would delete nothing`,
        );
      }

      // Evict FIRST so nothing else can write through a pooled connection
      // while this counts rows / checkpoints / moves the file.
      opts.pool.evict(tenant.id);

      let tablesCleared = 0;
      let rowsDeleted = 0;
      const statsDb = opts.openRawDatabase(dbPath);
      try {
        opts.configureConnection(statsDb);
        const tables = statsDb
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
          )
          .all() as { name: string }[];
        for (const { name } of tables) {
          if (TENANT_SCOPED_STATS_EXCLUDED_TABLES.has(name)) continue;
          const row = statsDb
            .prepare(`SELECT COUNT(*) AS c FROM "${name}"`)
            .get() as { c: number };
          if (row.c > 0) {
            tablesCleared += 1;
            rowsDeleted += row.c;
          }
        }
        statsDb.pragma("wal_checkpoint(TRUNCATE)");
      } finally {
        statsDb.close();
      }

      const archiveDir = path.join(opts.tenantsDir, "archive");
      fs.mkdirSync(archiveDir, { recursive: true });
      const timestamp = clock().toISOString().replace(/[:.]/g, "-");
      const archivePath = path.join(
        archiveDir,
        `${tenant.id}-${timestamp}.db`,
      );

      // The point of no return: if this throws, execution never reaches the
      // platform-row removal below, so a failed move leaves the platform
      // rows untouched (B-D4's requirement).
      fs.renameSync(dbPath, archivePath);
      for (const suffix of ["-wal", "-shm"]) {
        const side = `${dbPath}${suffix}`;
        if (fs.existsSync(side)) {
          try {
            fs.renameSync(side, `${archivePath}${suffix}`);
          } catch (error) {
            dbLogger.error(
              { side, error },
              "perTenantStorageProvisioner.deleteTenant: failed to archive a tenant db sidecar file",
            );
          }
        }
      }

      opts.platformTenantRepo.runInTransaction(() => {
        opts.platformSubscriptionRepo.deleteForTenant(tenant.id);
        opts.platformTenantRepo.deleteRegistryRow(tenant.id);
      });

      return { tablesCleared, rowsDeleted };
    },
  };
}
