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
} from "@liratek/core";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { dbLogger } from "@liratek/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database path
const resolved = resolveDatabasePath();
const DB_PATH = resolved.path;

// Optional SQLCipher key
const resolvedKey = resolveDatabaseKey();

let dbInstance: Database.Database | null = null;

function ensureSchema(db: Database.Database): void {
  // If core tables are missing, bootstrap schema from the Electron SQL file.
  const hasUsers = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    )
    .get();

  if (hasUsers) return;

  // Path: backend/src/database -> repo root -> electron-app/create_db.sql
  const schemaPath = path.join(
    __dirname,
    "../../../electron-app/create_db.sql",
  );
  const sql = fs.readFileSync(schemaPath, "utf-8");

  db.exec(sql);
  dbLogger.info({ schemaPath }, "Database schema initialized");
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
    const keyResult = applySqlCipherKey(dbInstance, resolvedKey.key);

    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");
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
    dbLogger.info(
      {
        keySource: resolvedKey.source,
        applied: keyResult.applied,
        supported: keyResult.supported,
        error: keyResult.error,
      },
      "SQLCipher key status",
    );

    if (resolvedKey.source !== "none" && !keyResult.applied) {
      throw new Error(
        keyResult.supported
          ? `SQLCipher key could not be applied: ${keyResult.error || "unknown error"}`
          : `SQLCipher is not supported by this SQLite build. Provide a SQLCipher-enabled build of SQLite/better-sqlite3. (details: ${keyResult.error || "unknown"})`,
      );
    }
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

    if (userRepo.usernameExists(username)) {
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
}

// Graceful shutdown
process.on("SIGTERM", closeDatabase);
process.on("SIGINT", closeDatabase);
