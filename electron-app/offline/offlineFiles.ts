/**
 * LIRA-306 — the PC's offline folder (data-model "PC files"):
 *
 *   <userData>/offline/
 *   ├── pairing.json
 *   ├── mirror-<ts>.db       newest 2 verified copies; never written
 *   ├── offline-work.db      working copy + outbox (go-offline → finishing)
 *   └── finished/offline-work-<ts>.db   newest 3 kept
 *
 * `<ts>` is a sortable UTC stamp (`20261011T100000123Z`), so name order is
 * age order. Reading a copy's identity opens it read-only and reads its one
 * `offline_copy_meta` row; a file that cannot be opened or has no row is not
 * a copy.
 */
import fs from "node:fs";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import type { CopyInfo } from "./bootDecision.js";

export type DatabaseCtor = typeof BetterSqlite3;

export const WORKING_COPY_FILE = "offline-work.db";
export const FINISHED_DIR = "finished";
export const MIRROR_RE = /^mirror-(\d{8}T\d{9}Z)\.db$/;
export const FINISHED_RE = /^offline-work-(\d{8}T\d{9}Z)\.db$/;
export const MIRRORS_KEPT = 2;
export const FINISHED_KEPT = 3;

/** `2026-10-11T10:00:00.123Z` → `20261011T100000123Z` */
export function fileStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:.]/g, "");
}

export function workingCopyPath(offlineDir: string): string {
  return path.join(offlineDir, WORKING_COPY_FILE);
}

export function finishedDir(offlineDir: string): string {
  return path.join(offlineDir, FINISHED_DIR);
}

/** The copy's identity, or null when it is not a readable copy. */
export function readCopyInfo(
  file: string,
  Ctor: DatabaseCtor,
): CopyInfo | null {
  if (!fs.existsSync(file)) return null;
  let db: BetterSqlite3.Database | null = null;
  try {
    db = new Ctor(file, { readonly: true, fileMustExist: true });
    const row = db
      .prepare(
        `SELECT copy_id, tenant_id, schema_version, built_at FROM offline_copy_meta ORDER BY id DESC LIMIT 1`,
      )
      .get() as
      | {
          copy_id: string;
          tenant_id: number;
          schema_version: number;
          built_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      file,
      copyId: row.copy_id,
      tenantId: row.tenant_id,
      schemaVersion: row.schema_version,
      builtAt: row.built_at,
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

/** True when SQLite's own integrity check passes. */
export function integrityOk(file: string, Ctor: DatabaseCtor): boolean {
  let db: BetterSqlite3.Database | null = null;
  try {
    db = new Ctor(file, { readonly: true, fileMustExist: true });
    return db.pragma("integrity_check", { simple: true }) === "ok";
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

function namesMatching(dir: string, re: RegExp): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => re.test(f))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Readable copies, newest first. */
export function listMirrors(
  offlineDir: string,
  Ctor: DatabaseCtor,
): CopyInfo[] {
  const out: CopyInfo[] = [];
  for (const name of namesMatching(offlineDir, MIRROR_RE)) {
    const info = readCopyInfo(path.join(offlineDir, name), Ctor);
    if (info) out.push(info);
  }
  return out;
}

export function listFinished(offlineDir: string): string[] {
  return namesMatching(finishedDir(offlineDir), FINISHED_RE).map((n) =>
    path.join(finishedDir(offlineDir), n),
  );
}

function removeDbFiles(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // not there
    }
  }
}

/** Keep the newest `keep` copies; never delete `openFile`. */
export function pruneMirrors(
  offlineDir: string,
  openFile: string | null,
  keep = MIRRORS_KEPT,
): void {
  const names = namesMatching(offlineDir, MIRROR_RE);
  const open = openFile ? path.resolve(openFile) : null;
  for (const name of names.slice(keep)) {
    const file = path.join(offlineDir, name);
    if (open && path.resolve(file) === open) continue;
    removeDbFiles(file);
  }
}

export function pruneFinished(offlineDir: string, keep = FINISHED_KEPT): void {
  for (const file of listFinished(offlineDir).slice(keep)) removeDbFiles(file);
}
