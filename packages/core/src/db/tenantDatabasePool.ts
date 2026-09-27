/**
 * Per-tenant database connection pool (Phase A, `docs/plans/ongoing_plans/
 * PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.1).
 *
 * Uses `fs` — reachable ONLY from `index.ts` (the Node entry point for
 * Electron main and the Fly backend), NEVER from `browser.ts` (rule 29). Do
 * not re-export this module from `browser.ts` or anything it reaches.
 *
 * Core does not know how a tenant's connection is opened, keyed, migrated or
 * how long it should stay open — every one of those is injected, so this
 * module has zero knowledge of SQLCipher, pragmas, or the migration runner.
 * Only `backend/src/database/connection.ts` constructs one of these today.
 */
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { dbLogger } from "../utils/logger.js";

export interface TenantDatabasePoolOptions {
  /** Directory holding one file per tenant, named `<tenantId>.db`. */
  dir: string;
  /**
   * Opens an already-existing file at `filePath` and returns a ready
   * connection (pragmas + SQLCipher key already applied). Never called for a
   * missing file — `get()` checks existence itself first.
   */
  openDatabase: (filePath: string) => Database.Database;
  /**
   * Brings `db` to the current schema version. Called exactly once per
   * connection, immediately after `openDatabase` and before the connection is
   * ever handed back to a caller — so a query can never observe a
   * not-yet-migrated file. A throw here poisons this tenant only (see
   * `get()`); every other tenant keeps serving.
   */
  migrate: (db: Database.Database) => void;
  /**
   * Soft cap on simultaneously open connections. When exceeded, the least
   * recently used connection NOT currently inside a transaction is closed.
   * Default 20.
   */
  maxOpen?: number;
  /**
   * A connection idle for at least this long (no `get()` call) becomes a
   * candidate for `closeIdle()`. Default 5 minutes.
   */
  idleMs?: number;
  /** Injectable clock, for deterministic idle-close tests. Default `Date.now`. */
  clock?: () => number;
}

interface PoolEntry {
  db: Database.Database;
  lastUsedAt: number;
}

/**
 * Opens, caches and migrates one SQLite connection per tenant id. Databases
 * are named by tenant **id**, never slug, so a slug rename stays free (§ 3).
 */
export class TenantDatabasePool {
  private readonly dir: string;
  private readonly openDatabaseFn: (filePath: string) => Database.Database;
  private readonly migrateFn: (db: Database.Database) => void;
  private readonly maxOpen: number;
  private readonly idleMs: number;
  private readonly clock: () => number;

  private readonly entries = new Map<number, PoolEntry>();
  /**
   * A tenant whose migration threw. Kept forever (until process restart, or
   * `resetPoisoned()` in tests) so every subsequent `get()` for that tenant
   * repeats the SAME failure instead of retrying a migration that is likely
   * to fail identically and repeatedly stall requests — "throw it for that
   * tenant's requests until restart" (§ 11.1).
   */
  private readonly poisoned = new Map<number, Error>();

  constructor(options: TenantDatabasePoolOptions) {
    this.dir = options.dir;
    this.openDatabaseFn = options.openDatabase;
    this.migrateFn = options.migrate;
    this.maxOpen = options.maxOpen ?? 20;
    this.idleMs = options.idleMs ?? 5 * 60 * 1000;
    this.clock = options.clock ?? (() => Date.now());
  }

  private filePath(tenantId: number): string {
    return path.join(this.dir, `${tenantId}.db`);
  }

  /**
   * Return the cached connection for `tenantId`, opening (and migrating) it
   * on first use. Throws — without creating anything on disk — when no file
   * exists for this tenant: provisioning a tenant database is Phase C's job,
   * not this pool's. Also throws (the SAME error, every time) for a tenant
   * whose migration already failed once this process.
   */
  get(tenantId: number): Database.Database {
    const cached = this.entries.get(tenantId);
    if (cached) {
      cached.lastUsedAt = this.clock();
      return cached.db;
    }

    const poisonError = this.poisoned.get(tenantId);
    if (poisonError) {
      throw poisonError;
    }

    const filePath = this.filePath(tenantId);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `TenantDatabasePool: no database file for tenant ${tenantId} at ${filePath}. ` +
          `Provisioning a missing tenant database is out of scope here — this pool never creates one.`,
      );
    }

    const db = this.openDatabaseFn(filePath);
    try {
      this.migrateFn(db);
    } catch (rawError) {
      const error =
        rawError instanceof Error ? rawError : new Error(String(rawError));
      dbLogger.error(
        { tenantId, filePath, error },
        "TenantDatabasePool: migration failed — tenant poisoned for the rest of this process",
      );
      this.poisoned.set(tenantId, error);
      try {
        db.close();
      } catch {
        // Already broken; nothing useful to do with a close failure here.
      }
      throw error;
    }

    this.entries.set(tenantId, { db, lastUsedAt: this.clock() });
    this.enforceMaxOpen();
    return db;
  }

  /**
   * Closes the least-recently-used connection that is NOT inside a
   * transaction, if the pool is over `maxOpen`. A pool that is entirely busy
   * (every connection mid-transaction) is left over its cap rather than ever
   * closing a live transaction out from under a caller.
   */
  private enforceMaxOpen(): void {
    if (this.entries.size <= this.maxOpen) return;

    let lruTenantId: number | null = null;
    let lruEntry: PoolEntry | null = null;
    for (const [tenantId, entry] of this.entries) {
      if (entry.db.inTransaction) continue;
      if (!lruEntry || entry.lastUsedAt < lruEntry.lastUsedAt) {
        lruTenantId = tenantId;
        lruEntry = entry;
      }
    }
    if (lruTenantId !== null) {
      this.closeOne(lruTenantId);
    }
  }

  /**
   * Closes every connection idle for at least `idleMs`, skipping any handle
   * currently `inTransaction`. better-sqlite3 calls are synchronous, so a
   * transaction can never straddle this check — either it is mid-transaction
   * right now (skip) or it fully completed already (safe to close).
   */
  closeIdle(): void {
    const now = this.clock();
    for (const [tenantId, entry] of this.entries) {
      if (entry.db.inTransaction) continue;
      if (now - entry.lastUsedAt >= this.idleMs) {
        this.closeOne(tenantId);
      }
    }
  }

  private closeOne(tenantId: number): void {
    const entry = this.entries.get(tenantId);
    if (!entry) return;
    if (entry.db.inTransaction) return;
    try {
      entry.db.close();
    } catch (error) {
      dbLogger.error(
        { tenantId, error },
        "TenantDatabasePool: error closing idle tenant connection",
      );
    }
    this.entries.delete(tenantId);
  }

  /** Closes every open connection unconditionally. Shutdown path only. */
  closeAll(): void {
    for (const tenantId of Array.from(this.entries.keys())) {
      const entry = this.entries.get(tenantId);
      if (!entry) continue;
      try {
        entry.db.close();
      } catch (error) {
        dbLogger.error(
          { tenantId, error },
          "TenantDatabasePool: error closing tenant connection during shutdown",
        );
      }
      this.entries.delete(tenantId);
    }
  }

  /**
   * Force-closes `tenantId`'s connection right now, regardless of idle time
   * or `maxOpen` — the delete/archive path (Phase C, B-D4) needs the file
   * handle released and its WAL checkpointed BEFORE the file can be moved to
   * the archive directory, and cannot wait for an idle sweep.
   *
   * Refuses (throws) if the connection is `inTransaction`: forcing a close
   * mid-transaction could tear a write in progress, and the delete path
   * needs the checkpoint to reflect a truly settled database, not one
   * interrupted out from under a caller. Checkpoints WAL into the main file
   * before closing, so the file this leaves on disk is self-contained (a
   * later reader does not depend on also finding the -wal/-shm siblings —
   * though the archive step still moves them too, for the rare case the
   * checkpoint could not fully empty the WAL).
   *
   * Returns `true` if a cached connection was actually closed, `false` if
   * this tenant had none open (nothing to do — the caller's own delete path
   * still needs to checkpoint the ON-DISK file itself in that case, since no
   * process-local handle exists to have flushed it).
   */
  evict(tenantId: number): boolean {
    const entry = this.entries.get(tenantId);
    if (!entry) return false;
    if (entry.db.inTransaction) {
      throw new Error(
        `TenantDatabasePool: cannot evict tenant ${tenantId} while a transaction is in progress`,
      );
    }
    try {
      entry.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch (error) {
      dbLogger.error(
        { tenantId, error },
        "TenantDatabasePool: checkpoint before evict failed",
      );
    }
    try {
      entry.db.close();
    } catch (error) {
      dbLogger.error(
        { tenantId, error },
        "TenantDatabasePool: error closing connection during evict",
      );
    }
    this.entries.delete(tenantId);
    return true;
  }

  /** Test-only: how many connections are currently cached open. */
  openCount(): number {
    return this.entries.size;
  }

  /** Test-only: clears a poisoned tenant so its next `get()` retries migration. */
  resetPoisoned(tenantId: number): void {
    this.poisoned.delete(tenantId);
  }
}
