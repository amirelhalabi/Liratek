/**
 * Backup Repository
 *
 * Owns the one SQL statement that produces a CONSISTENT snapshot of the
 * database file. Exists so `BackupService` can take a real backup without
 * touching the database itself (rule 13).
 *
 * ── Why this replaced a file copy ──
 *
 * `BackupService.createBackup()` used to `fs.copyFileSync` the `.db`, then the
 * `-wal`, then the `-shm`, as three separate unlocked operations against a
 * LIVE database. In WAL mode the main file only changes during a checkpoint,
 * so if a checkpoint (or any commit) lands between those copies, the pieces do
 * not correspond: the `.db` is from before, the `-wal` from after. The result
 * is a backup that can be missing committed transactions or fail to open — and
 * nothing detects it, because writing the files always "succeeds".
 *
 * Copying `-shm` made it worse. That file is transient shared-memory state
 * describing the CURRENT wal; SQLite recreates it on open. Shipping a stale one
 * next to a mismatched wal is strictly worse than shipping neither.
 *
 * `VACUUM INTO` is SQLite's supported answer: it reads through the normal
 * transaction machinery, so it sees exactly one committed point in time, and
 * writes a single self-contained file with no wal/shm siblings. It is also
 * synchronous in better-sqlite3, unlike `db.backup()` which returns a Promise —
 * that matters because the callers (Electron IPC handlers) are synchronous, and
 * making them async would ripple through the preload and renderer for no gain.
 *
 * Trade-off, stated plainly: `VACUUM INTO` rewrites and defragments as it goes,
 * so it costs more CPU and time than a byte copy on a large database. For a POS
 * database (single-digit MB) that is irrelevant, and correctness is not
 * optional for the file you restore financial history from.
 */

import { getDatabase } from "../db/connection.js";

export class BackupRepository {
  /**
   * Write a consistent, self-contained snapshot of the whole database to
   * `destPath`.
   *
   * DELIBERATELY NOT tenant-scoped: a backup is a file-level operation that
   * must capture every tenant. Restoring a per-tenant subset would produce a
   * database whose foreign keys point at rows that are not there.
   *
   * SQLite refuses to overwrite, so `destPath` must not already exist — the
   * caller's timestamped filename is what keeps that true, and an existing
   * file is a real error rather than something to silently clobber.
   */
  snapshotTo(destPath: string): void {
    const db = getDatabase();

    // Bound as a parameter, not interpolated — a backup directory can contain
    // a quote as easily as any other path (rule 3).
    db.prepare(
      `/* tenant-exempt: whole-file snapshot — a backup must capture every tenant */
       VACUUM INTO ?`,
    ).run(destPath);
  }
}

// Singleton, matching every other repository in this package.
let instance: BackupRepository | null = null;

export function getBackupRepository(): BackupRepository {
  if (!instance) {
    instance = new BackupRepository();
  }
  return instance;
}

export function resetBackupRepository(): void {
  instance = null;
}
