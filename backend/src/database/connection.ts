import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  resolveDatabasePath,
  resolveDatabaseKey,
  applySqlCipherKey,
  initDatabase as initCoreDatabase,
  runMigrations,
  runWithoutTenant,
  getUserRepository,
  hashPassword,
  validatePasswordComplexity,
  SUPER_ADMIN_USERNAME,
  SUPER_ADMIN_PASSWORD,
  setDatabaseResolver,
  setTenantDatabaseIdLister,
  setTenantStorageProvisioner,
  getTenantRepository,
  getSubscriptionRepository,
  TenantDatabasePool,
  checkPlatformSplitStatus,
} from "@liratek/core";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { dbLogger } from "@liratek/core";
import { buildTenantDbResolver } from "./tenantDbResolver.js";
import { startIdleSweep } from "./idleSweep.js";
import { openAndConfigure } from "./openAndConfigure.js";
import { listTenantDatabaseIdsFromDir } from "./tenantDirLister.js";
import { migrateAllTenants } from "./migrateAllTenants.js";
import { isPerTenantDbMode } from "./tenantDbMode.js";
import { createPerTenantStorageProvisioner } from "./perTenantStorageProvisioner.js";
import { checkTenantCompleteness } from "./tenantCompletenessCheck.js";

// Named to avoid shadowing the CommonJS module wrapper's own `__filename`/
// `__dirname` parameters — ts-jest keeps `import.meta.url` as-is (this
// project's TS `module` target is ESNext) but still runs test files inside
// Jest's CJS `require()` shim, where `__filename`/`__dirname` are already
// bound; redeclaring them with `const` in the same scope is a hard
// `SyntaxError`, not a warning. This module was previously only ever
// `jest.mock()`-ed away in backend tests, never required for real, so the
// collision went unnoticed until a test needed the real module (Phase A's
// `buildTenantDbResolver`).
const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirname = dirname(moduleFilename);

// Path: backend/src/database -> repo root -> electron-app/create_db.sql.
// Shared between `ensureSchema` (platform database bootstrap) and, in
// per-tenant mode, `installTenantDbRouting`'s wiring of the
// TenantStorageProvisioner (every shop file's build starts from the SAME
// SQL text) — one path, computed once (rule 14). Declared here, ahead of
// `installTenantDbRouting()`'s call near the bottom of this module's
// load-time code, since a `const` is not usable before its own declaration
// executes (unlike the function declarations around it).
const SCHEMA_SQL_PATH = path.join(
  moduleDirname,
  "../../../electron-app/create_db.sql",
);

// Database path
const resolved = resolveDatabasePath();
const DB_PATH = resolved.path;

// Optional SQLCipher key
const resolvedKey = resolveDatabaseKey();

/**
 * Per-tenant database mode (Phase A, `docs/plans/ongoing_plans/
 * PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.1).
 *
 * `shared` (default): today's single-file behaviour, byte-identical — no
 * resolver is installed in `@liratek/core`, so `getDatabase()` there falls
 * straight through to the single `db` exactly as before Phase A existed.
 *
 * `per-tenant`: every request whose `runWithTenant(id)` scope is active gets
 * routed to `<TENANT_DATABASES_DIR>/<id>.db` via `TenantDatabasePool`; a
 * bypass (`runWithoutTenant()`) or request with no tenant scope at all keeps
 * using this file's own platform database (`getDatabase()` below) — the
 * control-plane tables (`tenants`, super-admin users/sessions, platform
 * audit) never move.
 *
 * Read once, at import time, through `tenantDbMode.ts` — the ONE definition
 * of "is per-tenant mode on" (rule 14; `api/auth.ts` reads the same
 * function, at call time, for its own realm-fallback decision). Evaluating
 * it once here and freezing it into a constant is safe specifically BECAUSE
 * this module never re-checks it after `installTenantDbRouting()` runs at
 * load time — unlike `auth.ts`, nothing here needs a fresh read on every call.
 */
const TENANT_DB_MODE: "shared" | "per-tenant" = isPerTenantDbMode()
  ? "per-tenant"
  : "shared";

/**
 * Directory holding one file per tenant (`<id>.db`), used only in
 * `per-tenant` mode. Defaults to a `tenants/` directory next to the platform
 * DB_PATH (e.g. `/data/tenants` alongside Fly's `/data/liratek.db`) rather
 * than a hardcoded `/data/tenants`, so the default keeps working under any
 * DATABASE_PATH — including local dev, where `/data` does not exist.
 */
const TENANT_DATABASES_DIR =
  process.env.TENANT_DATABASES_DIR ?? path.join(path.dirname(DB_PATH), "tenants");

/**
 * How often `TenantDatabasePool.closeIdle()` sweeps for connections idle
 * longer than the pool's own `idleMs` (default 5 min — see
 * `TenantDatabasePoolOptions.idleMs`). `closeIdle()` existed with nothing
 * ever calling it (Phase A review finding); this is that schedule, installed
 * only in `per-tenant` mode.
 */
const IDLE_SWEEP_INTERVAL_MS = 60_000;

let dbInstance: Database.Database | null = null;
let tenantPool: TenantDatabasePool | null = null;
let stopIdleSweep: (() => void) | null = null;

/**
 * Pragmas + SQLCipher key applied to EVERY connection this backend opens —
 * the platform database and, in `per-tenant` mode, every tenant file. Kept
 * as one function so the two call sites can never drift (rule 14).
 */
function configureConnection(db: Database.Database): void {
  const keyResult = applySqlCipherKey(db, resolvedKey.key);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Wait for the write lock instead of failing instantly under concurrent
  // requests (matches the desktop app; harmless with a single connection).
  db.pragma("busy_timeout = 5000");

  if (resolvedKey.source !== "none" && !keyResult.applied) {
    throw new Error(
      keyResult.supported
        ? `SQLCipher key could not be applied: ${keyResult.error || "unknown error"}`
        : `SQLCipher is not supported by this SQLite build. Provide a SQLCipher-enabled build of SQLite/better-sqlite3. (details: ${keyResult.error || "unknown"})`,
    );
  }

  dbLogger.info(
    {
      keySource: resolvedKey.source,
      applied: keyResult.applied,
      supported: keyResult.supported,
      error: keyResult.error,
    },
    "SQLCipher key status",
  );
}

/**
 * Opens a tenant's own database file. The file must already exist —
 * provisioning one is Phase C's job, not this pool's (`TenantDatabasePool`
 * itself enforces "missing file throws, never bootstraps"; this factory is
 * only ever called after that check passes).
 */
function openTenantDatabase(filePath: string): Database.Database {
  return openAndConfigure(filePath, (fp) => new Database(fp), configureConnection);
}

/**
 * Installs (or, in `shared` mode, deliberately does NOT install) the
 * per-tenant connection resolver in `@liratek/core`. Called once at module
 * load.
 *
 * Safety lock (§ 12.4, ticket item 1): before installing anything, this
 * opens the platform database and checks whether the Phase D split has
 * actually run (`checkPlatformSplitStatus`). Flipping `TENANT_DB_MODE=
 * per-tenant` WITHOUT running the split leaves `/data/tenants` empty —
 * every shop request would fail ("no database file for tenant N"), yet
 * `migrateAllTenants()` alone would report `{ok:0, failed:0}` (there is
 * nothing to migrate when nothing was found) and the deploy verifier would
 * pass. If the platform file still holds shop data, this refuses to install
 * the resolver/lister/provisioner at all — behaving EXACTLY like `shared`
 * mode, so shops keep working off the platform file — and logs one
 * distinct ERROR marker the deploy verifier hard-fails on
 * (`scripts/deploy-api.mjs`). It deliberately does NOT throw: a crash-loop
 * on this single Fly machine would itself take every shop offline, which is
 * the exact outcome this exists to prevent.
 *
 * Opening the platform database here (`getDatabase()`, below) — instead of
 * only lazily, on first request, as this branch did before this guard
 * existed — is a deliberate change scoped to the per-tenant branch alone:
 * the check needs to read the platform file's own tables to decide, and
 * there is no way to decide without opening it. `shared` mode (the `return`
 * above) is completely untouched by this and stays byte-identical.
 */
function installTenantDbRouting(): void {
  if (TENANT_DB_MODE !== "per-tenant") {
    // Explicit no-op: byte-identical to today, nothing installed.
    setDatabaseResolver(null);
    setTenantDatabaseIdLister(null);
    setTenantStorageProvisioner(null);
    return;
  }

  const platformDb = getDatabase();
  const splitStatus = checkPlatformSplitStatus(platformDb);
  if (splitStatus.splitRequired) {
    dbLogger.error(
      {
        tablesWithShopRows: splitStatus.tablesWithShopRows,
        totalRows: splitStatus.totalRows,
      },
      "Per-tenant mode REFUSED: platform database still holds shop data — run the Phase D split first",
    );
    setDatabaseResolver(null);
    setTenantDatabaseIdLister(null);
    setTenantStorageProvisioner(null);
    return;
  }

  tenantPool = new TenantDatabasePool({
    dir: TENANT_DATABASES_DIR,
    openDatabase: openTenantDatabase,
    migrate: (db: Database.Database) => runMigrations(db),
  });

  setDatabaseResolver(buildTenantDbResolver(tenantPool, getDatabase));
  setTenantDatabaseIdLister(() => listTenantDatabaseIdsFromDir(TENANT_DATABASES_DIR));
  stopIdleSweep = startIdleSweep(tenantPool, IDLE_SWEEP_INTERVAL_MS);

  // Phase C (§ 12.2/12.3): provisioning builds a brand-new shop file, and
  // delete archives one — both need real fs/pool access, so the port
  // (`@liratek/core`'s TenantStorageProvisioner) is implemented here, not in
  // core. `createDbSql` is read ONCE, the same file `ensureSchema` below
  // bootstraps the platform database from.
  const createDbSql = fs.readFileSync(SCHEMA_SQL_PATH, "utf-8");
  setTenantStorageProvisioner(
    createPerTenantStorageProvisioner({
      tenantsDir: TENANT_DATABASES_DIR,
      pool: tenantPool,
      openRawDatabase: (fp) => new Database(fp),
      configureConnection,
      runMigrations: (db: Database.Database) => runMigrations(db),
      createDbSql,
      // Ambient getters, not captured instances: both resolve `getDatabase()`
      // with no explicit db, which — inside the runWithoutTenant() scope
      // admin.ts/auth.ts already wrap every provisionTenant()/deleteTenant()
      // call in — lands on the platform database via the per-tenant
      // resolver's bypass branch (buildTenantDbResolver above).
      platformTenantRepo: getTenantRepository(),
      platformSubscriptionRepo: getSubscriptionRepository(),
    }),
  );

  dbLogger.info(
    { tenantDatabasesDir: TENANT_DATABASES_DIR, idleSweepIntervalMs: IDLE_SWEEP_INTERVAL_MS },
    "Per-tenant database routing installed",
  );

  // Boot-time migrate-all (§ 12.2): every shop file is brought to the
  // current schema version at boot, not only lazily on its first request —
  // that is what makes the deploy verifier's "failed: 0" assertion mean
  // anything. A per-tenant failure is logged and does NOT stop the platform
  // from booting (the pool has already poisoned that one tenant; every
  // other tenant, and the platform database itself, keeps serving).
  const tenantIds = listTenantDatabaseIdsFromDir(TENANT_DATABASES_DIR);
  const summary = migrateAllTenants(tenantIds, tenantPool, (tenantId, error) => {
    dbLogger.error(
      { tenantId, error },
      "Tenant database boot migration failed",
    );
  });

  // Completeness check (§ 12.4, ticket item 2): migrateAllTenants() alone
  // only ever loops over ids the directory lister FOUND — a tenant that
  // ought to have a file but doesn't is invisible to it (see this
  // function's own header). Compare against the platform's own registry to
  // catch that.
  const tenantRows = runWithoutTenant(() => getTenantRepository().listAllRows());
  const completeness = checkTenantCompleteness(tenantRows, tenantIds);

  if (completeness.provisioningIds.length > 0) {
    dbLogger.warn(
      { provisioningIds: completeness.provisioningIds },
      "Tenant(s) stuck in 'provisioning' status at boot — either mid-provision or a crashed provisioning attempt; not counted as missing",
    );
  }
  if (completeness.orphanIds.length > 0) {
    dbLogger.warn(
      { orphanIds: completeness.orphanIds },
      "Tenant database file(s) found with no matching platform tenant row",
    );
  }
  if (completeness.missingIds.length > 0) {
    dbLogger.error(
      { missingIds: completeness.missingIds },
      "Tenant(s) expected to have a database file (status active/suspended), but none was found on disk",
    );
  }

  dbLogger.info(
    {
      total: tenantIds.length,
      ok: summary.ok,
      failed: summary.failed,
      failedIds: summary.failedIds,
      missing: completeness.missingIds.length,
      missingIds: completeness.missingIds,
    },
    "Tenant databases migrated",
  );
}

installTenantDbRouting();

function ensureSchema(db: Database.Database): void {
  // If core tables are missing, bootstrap schema from the Electron SQL file.
  const hasUsers = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    )
    .get();

  if (hasUsers) return;

  const sql = fs.readFileSync(SCHEMA_SQL_PATH, "utf-8");

  db.exec(sql);
  dbLogger.info({ schemaPath: SCHEMA_SQL_PATH }, "Database schema initialized");
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    // Ensure DB directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new Database(DB_PATH);

    // Apply SQLCipher key (if provided) BEFORE any other access
    configureConnection(dbInstance);
    ensureSchema(dbInstance);

    // Initialize the @liratek/core database singleton
    initCoreDatabase(dbInstance);

    // Run pending migrations (idempotent — skips already-applied versions).
    // The Electron main process has always done this (main.ts); the backend
    // previously only ever bootstrapped from create_db.sql on first run and
    // then never migrated again, silently missing every later migration on
    // an existing DB. This closes that gap.
    try {
      runMigrations(dbInstance);
      dbLogger.info("Database migrations applied");
    } catch (error) {
      dbLogger.error({ error }, "Database migrations failed");
      throw error;
    }

    // Super admin bootstrap (WP2): env-driven, web-only. Throws (killing
    // startup loudly) on a misconfigured credential rather than silently
    // leaving the platform without its control-plane account.
    ensureSuperAdmin();

    dbLogger.info(
      { path: DB_PATH, source: resolved.source },
      "Database connected",
    );
  }
  return dbInstance;
}

/**
 * Super admin bootstrap (plan §5 / WP2).
 *
 * If BOTH `SUPER_ADMIN_USERNAME` and `SUPER_ADMIN_PASSWORD` are set and no
 * active super_admin user exists yet, create one: role 'super_admin',
 * `tenant_id` NULL (platform realm), password hashed with the same scrypt
 * scheme AuthService uses. With the env vars absent this is a no-op — the
 * desktop product never sets them, so it never gets a platform account.
 *
 * Runs inside `runWithoutTenant()`: the users table is tenant-scoped for
 * BaseRepository's generic CRUD, and at startup there is no tenant context
 * (nor should there be — this is a control-plane write).
 */
export function ensureSuperAdmin(): void {
  const username = SUPER_ADMIN_USERNAME;
  const password = SUPER_ADMIN_PASSWORD;
  if (!username || !password) return;

  const userRepo = getUserRepository();
  runWithoutTenant(() => {
    if (userRepo.hasActiveSuperAdmin()) {
      dbLogger.debug("Super admin already present — bootstrap skipped");
      return;
    }

    // Platform realm (tenant_id NULL), not global: a tenant may legitimately
    // have a user with the same name as the super admin.
    if (userRepo.usernameExistsInRealm(username, null)) {
      throw new Error(
        `SUPER_ADMIN_USERNAME '${username}' is already taken by a non-super-admin user — pick a different username`,
      );
    }

    const complexity = validatePasswordComplexity(password);
    if (!complexity.valid) {
      throw new Error(
        `SUPER_ADMIN_PASSWORD rejected: ${complexity.errors.join(", ")}`,
      );
    }

    userRepo.createUser({
      username,
      password_hash: hashPassword(password),
      role: "super_admin",
      is_active: 1,
      tenant_id: null, // platform realm — explicitly outside every tenant
    });
    dbLogger.info({ username }, "Super admin bootstrapped from environment");
  });
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbLogger.info("Database closed");
  }
  if (stopIdleSweep) {
    stopIdleSweep();
    stopIdleSweep = null;
  }
  if (tenantPool) {
    tenantPool.closeAll();
    setTenantDatabaseIdLister(null);
    setTenantStorageProvisioner(null);
    dbLogger.info("Tenant database pool closed");
  }
}

// Graceful shutdown
process.on("SIGTERM", closeDatabase);
process.on("SIGINT", closeDatabase);
