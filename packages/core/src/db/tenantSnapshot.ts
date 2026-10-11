/**
 * LIRA-306 (FR-005, research R15) — the shop copy a paired PC downloads.
 *
 * `buildTenantSnapshot()` makes a single-shop SQLite file from the server's
 * database WITHOUT touching it (only `VACUUM INTO`, which reads):
 *  1. `VACUUM INTO` a temp file in a fresh `mkdtemp` directory;
 *  2. `narrowToTenant(copy, tenantId, { keepOwnSubscriptionRow: true })` —
 *     the SAME narrowing the Phase D split uses (rule 14), including its
 *     hard-fail on any table that would ride along unfiltered;
 *  3. per-table high-water marks = the shop's own `MAX(id)` for every table
 *     in `OFFLINE_ID_TABLES`, taken BEFORE stripping so a stripped table
 *     still reports the shop's real maximum;
 *  4. strips sign-in material: empties `SNAPSHOT_STRIPPED_TABLES`, nulls
 *     `SNAPSHOT_NULLED_COLUMNS` (the licence key), deletes secret
 *     `system_settings` keys — password hashes are KEPT (offline sign-in);
 *  5. writes the one `offline_copy_meta` row (copy id, built at, schema
 *     version, high-water marks);
 *  6. resets `sqlite_sequence` to each table's own `MAX(id)` — the
 *     platform-wide counters would reveal every other shop's lifetime row
 *     counts (the leak `tenantSplitSqliteSequenceLeak.characterization`
 *     documents for the split; safe here because copy ids never flow back,
 *     offline rows use the far id range);
 *  7. verifies: no row of another shop, every table without `tenant_id`
 *     empty unless allowed, exactly the shop's own `tenants` row; then
 *     `VACUUM` and `integrity_check = ok` (refuses otherwise).
 *     `foreign_key_check` violations are COUNTED and logged, not fatal: a
 *     dangling reference already in the shop's data must not make offline
 *     mode unavailable.
 * The temp directory is removed in `finally`, on success and on failure; the
 * result carries the gzip bytes, so no file outlives the call.
 *
 * Uses `fs`/`os`/`zlib`/`better-sqlite3`: exported from `index.ts` ONLY,
 * never reachable from `browser.ts` (rule 29).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { getDatabase } from "./connection.js";
import { getCurrentVersion } from "./migrations/index.js";
import {
  discoverTenantScopedTables,
  narrowToTenant,
  PLATFORM_ONLY_TABLES,
  quoteIdent,
} from "./tenantSplit.js";
import { OFFLINE_ID_EXCLUDED_TABLES, OFFLINE_ID_TABLES } from "../offline/idRange.js";
import { PROFITS_PASSWORD_SETTING_KEY } from "../constants/profitsAccess.js";
import { dbLogger } from "../utils/logger.js";

/** Emptied in every copy: sign-in material, replay bookkeeping, server
 * plumbing. The platform-only tables are already emptied by the narrowing;
 * listed again so the classification guard sees one complete list. */
export const SNAPSHOT_STRIPPED_TABLES: readonly string[] = [
  ...OFFLINE_ID_EXCLUDED_TABLES,
  "sessions",
  "idempotency_keys",
  "user_invitations",
  "password_reset_tokens",
  "email_verification_tokens",
  "user_identities",
  "sync_queue",
  "sync_errors",
  ...PLATFORM_ONLY_TABLES,
];

/** Tables whose NAME looks like sign-in material but which are business
 * data the cashier needs offline. */
export const SNAPSHOT_KEPT_TABLES: Readonly<Record<string, string>> = {
  customer_sessions: "customer baskets/tabs — business data, not a sign-in session",
  customer_session_transactions: "lines of a customer basket — business data",
  session_cart_items: "items in a customer basket — business data",
};

/** Tables WITHOUT `tenant_id` allowed to hold rows in a copy. */
export const SNAPSHOT_GLOBAL_TABLES_ALLOWED: Readonly<Record<string, string>> = {
  tenants: "exactly the shop's own row (its real shop id)",
  schema_migrations: "the data version the PC compares against its app",
};

/** Columns set to NULL in every copy. */
export const SNAPSHOT_NULLED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  tenant_subscriptions: ["license_key"],
};

/** Columns whose NAME looks secret but which are kept, with the reason. */
export const SNAPSHOT_KEPT_COLUMNS: Readonly<Record<string, string>> = {
  "users.password_hash": "scrypt hash — the cashier signs in on the PC while offline",
  "users.has_password": "boolean flag, not a secret",
  "suppliers.module_key": "module identifier, not a secret",
  "currency_modules.module_key": "module identifier, not a secret",
  "financial_services.item_key": "catalogue item identifier, not a secret",
  "item_costs.item_key": "catalogue item identifier, not a secret",
  "voucher_images.item_key": "catalogue item identifier, not a secret",
};

/** `system_settings.key_name`s matching this are deleted from a copy… */
export const SNAPSHOT_SECRET_SETTING_PATTERN = /api_key|token|secret|password/i;

/** …except these (a hash, like `users.password_hash`). Deleting the profits
 * password hash would leave the Profits page with NO password on every
 * offline PC (`ProfitsAccessService.isPasswordSet()` reads its absence as
 * "not set"). */
export const SNAPSHOT_KEPT_SETTING_KEYS: Readonly<Record<string, string>> = {
  [PROFITS_PASSWORD_SETTING_KEY]: "scrypt hash; deleting it would unlock Profits offline",
};

export interface BuildTenantSnapshotOptions {
  tenantId: number;
  /** Connection to copy FROM. Default: `getDatabase()` (the caller runs in
   * the shop's tenant context). Only read, plus `VACUUM INTO`. */
  sourceDb?: Database.Database;
  /** Parent of the per-build temp directory. Default: `os.tmpdir()`. */
  tmpRoot?: string;
  /** Injectable for backend jest, which maps `better-sqlite3` to a mock. */
  DatabaseCtor?: typeof Database;
  now?: () => Date;
}

export interface TenantSnapshot {
  copyId: string;
  tenantId: number;
  builtAt: string;
  schemaVersion: number;
  /** `{ table: maxId }` for every table in `OFFLINE_ID_TABLES`. */
  highWater: Record<string, number>;
  /** gzip of the SQLite file — the snapshot route's body. */
  gzip: Buffer;
  /** Size of the uncompressed SQLite file. */
  sizeBytes: number;
  buildMs: number;
  foreignKeyViolations: number;
}

function tableExists(db: Database.Database, table: string): boolean {
  return (
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !==
    undefined
  );
}

function allTables(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as { name: string }[]).some(
    (c) => c.name === column,
  );
}

function maxRowId(db: Database.Database, table: string): number {
  return (
    db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS m FROM ${quoteIdent(table)}`).get() as { m: number }
  ).m;
}

function readHighWater(copy: Database.Database): Record<string, number> {
  const marks: Record<string, number> = {};
  for (const table of OFFLINE_ID_TABLES) {
    marks[table] = tableExists(copy, table) ? maxRowId(copy, table) : 0;
  }
  return marks;
}

function stripSecrets(copy: Database.Database): void {
  for (const table of SNAPSHOT_STRIPPED_TABLES) {
    if (tableExists(copy, table)) copy.exec(`DELETE FROM ${quoteIdent(table)}`);
  }
  for (const [table, cols] of Object.entries(SNAPSHOT_NULLED_COLUMNS)) {
    if (!tableExists(copy, table)) continue;
    for (const col of cols) {
      if (hasColumn(copy, table, col)) {
        copy.exec(`UPDATE ${quoteIdent(table)} SET ${quoteIdent(col)} = NULL`);
      }
    }
  }
  if (tableExists(copy, "system_settings")) {
    const keys = copy.prepare(`SELECT id, key_name FROM system_settings`).all() as {
      id: number;
      key_name: string;
    }[];
    const del = copy.prepare(`DELETE FROM system_settings WHERE id = ?`);
    for (const k of keys) {
      if (SNAPSHOT_SECRET_SETTING_PATTERN.test(k.key_name) && !(k.key_name in SNAPSHOT_KEPT_SETTING_KEYS)) {
        del.run(k.id);
      }
    }
  }
}

function resetSequences(copy: Database.Database): void {
  if (!tableExists(copy, "sqlite_sequence")) return;
  const names = (copy.prepare(`SELECT name FROM sqlite_sequence`).all() as { name: string }[]).map(
    (r) => r.name,
  );
  const set = copy.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`);
  const drop = copy.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`);
  for (const name of names) {
    if (tableExists(copy, name)) set.run(maxRowId(copy, name), name);
    else drop.run(name);
  }
}

/** Throws when anything that is not the shop's own data survived. */
function verifyOnlyOwnShop(copy: Database.Database, tenantId: number): void {
  const problems: string[] = [];
  const scoped = new Set(discoverTenantScopedTables(copy));
  for (const table of allTables(copy)) {
    if (scoped.has(table)) {
      const n = (
        copy
          .prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)} WHERE tenant_id IS NULL OR tenant_id != ?`)
          .get(tenantId) as { c: number }
      ).c;
      if (n > 0) problems.push(`${table}: ${n} row(s) of another shop`);
    } else if (table === "tenants") {
      const ids = (copy.prepare(`SELECT id FROM tenants`).all() as { id: number }[]).map((r) => r.id);
      if (ids.length !== 1 || ids[0] !== tenantId) problems.push(`tenants: ${JSON.stringify(ids)}`);
    } else if (!(table in SNAPSHOT_GLOBAL_TABLES_ALLOWED)) {
      const n = (copy.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get() as { c: number }).c;
      if (n > 0) problems.push(`${table}: ${n} global row(s)`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`buildTenantSnapshot: refusing copy of shop ${tenantId} — ${problems.join("; ")}`);
  }
}

export function buildTenantSnapshot(opts: BuildTenantSnapshotOptions): TenantSnapshot {
  const started = Date.now();
  const { tenantId } = opts;
  const Ctor = opts.DatabaseCtor ?? Database;
  const sourceDb = opts.sourceDb ?? getDatabase();

  const known = sourceDb.prepare(`SELECT 1 FROM tenants WHERE id = ?`).get(tenantId);
  if (!known) throw new Error(`buildTenantSnapshot: unknown shop ${tenantId}`);

  const dir = fs.mkdtempSync(path.join(opts.tmpRoot ?? os.tmpdir(), "liratek-snapshot-"));
  try {
    const file = path.join(dir, "copy.db");
    sourceDb.prepare("VACUUM INTO ?").run(file);

    const copyId = crypto.randomUUID();
    const builtAt = (opts.now ? opts.now() : new Date()).toISOString();
    let schemaVersion = 0;
    let highWater: Record<string, number> = {};
    let foreignKeyViolations = 0;

    const copy = new Ctor(file);
    try {
      narrowToTenant(copy, tenantId, { sourceDb, keepOwnSubscriptionRow: true, label: "offline snapshot" });
      copy.transaction(() => {
        highWater = readHighWater(copy);
        stripSecrets(copy);
        schemaVersion = getCurrentVersion(copy);
        copy
          .prepare(
            `INSERT INTO offline_copy_meta (tenant_id, copy_id, built_at, schema_version, high_water_json, device_no, opened_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
          )
          .run(tenantId, copyId, builtAt, schemaVersion, JSON.stringify(highWater), builtAt, builtAt);
        resetSequences(copy);
      })();
      verifyOnlyOwnShop(copy, tenantId);
      copy.exec("VACUUM");
      const integrity = (copy.pragma("integrity_check") as { integrity_check: string }[])[0]
        ?.integrity_check;
      if (integrity !== "ok") {
        throw new Error(`buildTenantSnapshot: integrity_check failed for shop ${tenantId}: ${integrity}`);
      }
      foreignKeyViolations = (copy.pragma("foreign_key_check") as unknown[]).length;
    } finally {
      copy.close();
    }

    const raw = fs.readFileSync(file);
    const gzip = zlib.gzipSync(raw);
    const buildMs = Date.now() - started;
    if (foreignKeyViolations > 0) {
      dbLogger.warn({ tenantId, copyId, foreignKeyViolations }, "offline snapshot has dangling references");
    }
    dbLogger.info(
      { tenantId, copyId, schemaVersion, sizeBytes: raw.length, gzipBytes: gzip.length, buildMs },
      "offline snapshot built",
    );
    return {
      copyId,
      tenantId,
      builtAt,
      schemaVersion,
      highWater,
      gzip,
      sizeBytes: raw.length,
      buildMs,
      foreignKeyViolations,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
