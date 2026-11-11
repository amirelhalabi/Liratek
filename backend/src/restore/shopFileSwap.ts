/**
 * LIRA-377 T022/T023 — the backend implementation of core's `ShopFilePort`:
 * bring a candidate shop file to the current schema, then copy it INTO the
 * live `<tenantsDir>/<id>.db` while only that shop is paused.
 *
 * Why the copy is in place (research R3): renaming over a file Litestream
 * watches, or deleting its -wal/-shm, makes Litestream drop the database and
 * replication stops silently. better-sqlite3's online backup API
 * (`candidate.backup(livePath)`) writes pages into the existing file: same
 * inode, same WAL, replication carries on (proven on Fly, T001).
 *
 * Every Node/SQLite concern is injected (the opener, the migrate function,
 * the pool, the merge-round hold) the same way `perTenantStorageProvisioner`
 * does, so this file never imports better-sqlite3 at runtime and the test can
 * hand it the real library past backend jest's stub. No clock in the logic:
 * the before-copy stamp comes from the caller (rule 27).
 */
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { dbLogger, type ShopFilePort, type ShopFileSwapArgs } from "@liratek/core";

/** The subset of `TenantDatabasePool` the swap needs. */
export interface ShopFileSwapPool {
  block(tenantId: number): void;
  unblock(tenantId: number): void;
  resetPoisoned(tenantId: number): void;
}

/** `OfflineMergeProcessor`'s static hooks (hold/release/isRunning). */
export interface MergeRoundGate {
  hold(tenantId: number): void;
  release(tenantId: number): void;
  isRunning(tenantId: number): boolean;
}

export interface ShopFileSwapDeps {
  /** Directory holding the live `<tenantId>.db` files (the pool's `dir`). */
  tenantsDir: string;
  pool: ShopFileSwapPool;
  /** Opens a file and applies the connection contract (pragmas + SQLCipher key) — the pool's own opener. */
  openDatabase: (filePath: string) => Database.Database;
  /** The SAME migrate function the pool runs on open, so a migrated candidate can never be poisoned on reopen. */
  migrate: (db: Database.Database) => void;
  merge: MergeRoundGate;
  sleep?: (ms: number) => Promise<void>;
  /** Poll interval while waiting for a running merge round. Default 100 ms. */
  mergeWaitPollMs?: number;
  /** Polls before giving up (default 300, i.e. ~30 s at 100 ms). */
  mergeWaitMaxPolls?: number;
  /** `PRAGMA integrity_check` result; injectable for failure tests. */
  checkIntegrity?: (db: Database.Database) => string;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function defaultIntegrity(db: Database.Database): string {
  return String(db.pragma("integrity_check", { simple: true }));
}

/**
 * `message`/`code` of a thrown value, for logs. pino only serialises an
 * Error under the `err` key, so `{ error }` logged as `{}` and CI could not
 * tell what failed.
 */
function errorFields(error: unknown): { message: string; code?: string } {
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; code?: unknown };
    return {
      message: typeof e.message === "string" ? e.message : String(error),
      ...(typeof e.code === "string" ? { code: e.code } : {}),
    };
  }
  return { message: String(error) };
}

function closeQuietly(db: Database.Database | null): void {
  if (!db) return;
  try {
    db.close();
  } catch (error) {
    dbLogger.error({ error: errorFields(error) }, "shopFileSwap: error closing a connection");
  }
}

export function beforeCopyPathFor(beforeCopyDir: string, tenantId: number, stampUtc: string): string {
  return path.join(beforeCopyDir, String(tenantId), `before-${stampUtc}.sqlite`);
}

export function createShopFileSwap(deps: ShopFileSwapDeps): ShopFilePort {
  const sleep = deps.sleep ?? defaultSleep;
  const pollMs = deps.mergeWaitPollMs ?? 100;
  const maxPolls = deps.mergeWaitMaxPolls ?? 300;
  const checkIntegrity = deps.checkIntegrity ?? defaultIntegrity;
  const livePathFor = (tenantId: number) => path.join(deps.tenantsDir, `${tenantId}.db`);

  /** Copies `sourcePath` into `livePath` in place (online backup), then checks it. */
  async function copyInto(sourcePath: string, livePath: string): Promise<void> {
    let source: Database.Database | null = null;
    try {
      source = deps.openDatabase(sourcePath);
      await source.backup(livePath);
    } finally {
      closeQuietly(source);
    }
  }

  function integrityOf(livePath: string): string {
    let db: Database.Database | null = null;
    try {
      db = deps.openDatabase(livePath);
      return checkIntegrity(db);
    } finally {
      closeQuietly(db);
    }
  }

  async function waitForMergeRound(tenantId: number): Promise<void> {
    let polls = 0;
    while (deps.merge.isRunning(tenantId)) {
      if (polls >= maxPolls) {
        throw new Error(
          `shopFileSwap: an offline merge round for shop ${tenantId} is still running — try the restore again shortly`,
        );
      }
      polls += 1;
      await sleep(pollMs);
    }
  }

  return {
    async migrateCandidate(candidatePath: string): Promise<void> {
      const started = performance.now();
      let db: Database.Database | null = null;
      try {
        db = deps.openDatabase(candidatePath);
        deps.migrate(db);
        db.pragma("wal_checkpoint(TRUNCATE)");
      } finally {
        closeQuietly(db);
      }
      dbLogger.info(
        { candidatePath, ms: Math.round(performance.now() - started) },
        "shopFileSwap: candidate migrated",
      );
    },

    async swap({ tenantId, candidatePath, beforeCopyDir, stampUtc }: ShopFileSwapArgs) {
      const started = performance.now();
      const livePath = livePathFor(tenantId);
      const beforeCopyPath = beforeCopyPathFor(beforeCopyDir, tenantId, stampUtc);
      if (!fs.existsSync(livePath)) {
        throw new Error(`shopFileSwap: no live file for shop ${tenantId}`);
      }
      if (!fs.existsSync(candidatePath)) {
        throw new Error(`shopFileSwap: candidate file missing for shop ${tenantId}`);
      }

      // A candidate that cannot be opened or read fails here, before the
      // shop is paused and long before the live file could be touched.
      // Re-thrown as our own Error: better-sqlite3's SqliteError belongs to
      // whichever context first loaded the native addon, so callers in
      // another context cannot rely on `instanceof Error` (jest workers do
      // exactly that).
      let probe: Database.Database | null = null;
      try {
        probe = deps.openDatabase(candidatePath);
        probe.pragma("schema_version", { simple: true });
      } catch (error) {
        const { message, code } = errorFields(error);
        throw new Error(
          `shopFileSwap: candidate file for shop ${tenantId} is not a readable database (${code ?? "error"}: ${message})`,
          { cause: error },
        );
      } finally {
        closeQuietly(probe);
      }

      // Hold first: no new merge round can start while we wait for the
      // running one, so there is no gap between the wait and the block.
      deps.merge.hold(tenantId);
      let blocked = false;
      try {
        await waitForMergeRound(tenantId);
        deps.pool.block(tenantId); // evicts; throws (not blocked) mid-transaction
        blocked = true;

        // (3) before-copy of the live file, taken on its own connection.
        fs.mkdirSync(path.dirname(beforeCopyPath), { recursive: true });
        let live: Database.Database | null = null;
        try {
          live = deps.openDatabase(livePath);
          live.prepare("VACUUM INTO ?").run(beforeCopyPath);
        } finally {
          closeQuietly(live);
        }

        // (4)+(5) copy in place, then check. From here on the live file may
        // have changed, so any failure puts the before-copy back.
        try {
          await copyInto(candidatePath, livePath);
          const result = integrityOf(livePath);
          if (result !== "ok") {
            throw new Error(`shopFileSwap: integrity check failed after copy: ${result}`);
          }
        } catch (error) {
          dbLogger.error(
            { tenantId, error: errorFields(error) },
            "shopFileSwap: copy failed — putting the before-restore copy back",
          );
          try {
            await copyInto(beforeCopyPath, livePath);
            const back = integrityOf(livePath);
            if (back !== "ok") throw new Error(`integrity after putting back: ${back}`);
          } catch (restoreError) {
            dbLogger.error(
              { tenantId, error: errorFields(restoreError), beforeCopyPath },
              "shopFileSwap: putting the before-restore copy back FAILED — shop file needs manual recovery",
            );
          }
          throw error;
        }

        // (6) a shop poisoned by an earlier failed migration gets a fresh try
        // on the new file (the candidate is already at the current schema).
        deps.pool.resetPoisoned(tenantId);
        dbLogger.info(
          { tenantId, beforeCopyPath, ms: Math.round(performance.now() - started) },
          "shopFileSwap: shop file swapped",
        );
        return { beforeCopyPath };
      } finally {
        if (blocked) deps.pool.unblock(tenantId);
        deps.merge.release(tenantId);
      }
    },
  };
}
