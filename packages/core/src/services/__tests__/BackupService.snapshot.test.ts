/**
 * BackupService — the backup file must actually contain the data.
 *
 * These run against a REAL file-backed database in WAL mode, because that is
 * the only configuration in which the old bug appears. `:memory:` would hide
 * it completely: there is no wal file to strand anything in.
 *
 * WHAT WAS WRONG. createBackup() used to fs.copyFileSync the `.db`, then the
 * `-wal`, then the `-shm`, unlocked, against a live database. In WAL mode a
 * committed row lives in the `-wal` until a checkpoint folds it into the main
 * file — so the copied `.db`, ON ITS OWN, can be missing transactions that
 * were committed before the backup was taken. That file is exactly what
 * listBackups() shows and what a human restores. The failure is silent: every
 * copy "succeeds".
 *
 * "restores the .db alone" is not a strawman — it is the only thing the backup
 * UI offers, and the sibling files were written next to it with names
 * (`…db-wal`) that no restore flow reassembles.
 *
 * `no wal/shm siblings` is the direct regression guard: the old code created
 * them, this one cannot.
 */

import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { BackupService } from "../BackupService";
import { resetBackupRepository } from "../../repositories/BackupRepository";

const TEST_DB_GLOBAL = "__LIRATEK_TEST_DB__";

describe("BackupService — consistent snapshots", () => {
  let dir: string;
  let dbPath: string;
  let backupDir: string;
  let db: Database.Database;
  let service: BackupService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-backup-"));
    dbPath = path.join(dir, "liratek.db");
    backupDir = path.join(dir, "Backups");

    db = new Database(dbPath);
    // WAL is what production uses (backend/src/database/connection.ts) and is
    // the whole point of these tests.
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        amount REAL NOT NULL
      );
    `);

    (globalThis as unknown as Record<string, unknown>)[TEST_DB_GLOBAL] = db;
    resetBackupRepository();
    service = new BackupService(backupDir);
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)[TEST_DB_GLOBAL];
    resetBackupRepository();
    try {
      db.close();
    } catch {
      // already closed
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Open a backup file the way a restore would: that file, by itself. */
  function readBackupLabels(backupPath: string): string[] {
    const restored = new Database(backupPath, { readonly: true });
    try {
      return (
        restored
          .prepare(`SELECT label FROM transactions ORDER BY id`)
          .all() as { label: string }[]
      ).map((r) => r.label);
    } finally {
      restored.close();
    }
  }

  it("captures a transaction committed just before the backup", () => {
    // Committed, and still sitting in the -wal — no checkpoint has run.
    db.prepare(`INSERT INTO transactions (label, amount) VALUES (?, ?)`).run(
      "sale-before-backup",
      42.5,
    );

    const result = service.createBackup(dbPath);
    expect(result.success).toBe(true);

    // THE assertion. Under the old file-copy implementation the row was in the
    // -wal, not in this file, and restoring it lost the sale.
    expect(readBackupLabels(result.path!)).toEqual(["sale-before-backup"]);
  });

  it("writes ONE self-contained file — no -wal or -shm siblings", () => {
    db.prepare(`INSERT INTO transactions (label, amount) VALUES (?, ?)`).run(
      "x",
      1,
    );
    const result = service.createBackup(dbPath);

    expect(fs.existsSync(result.path!)).toBe(true);
    // The old code copied both. A stale -shm beside a mismatched -wal is worse
    // than neither, because SQLite will try to use it.
    expect(fs.existsSync(result.path! + "-wal")).toBe(false);
    expect(fs.existsSync(result.path! + "-shm")).toBe(false);
  });

  it("produces a structurally sound database", () => {
    db.prepare(`INSERT INTO transactions (label, amount) VALUES (?, ?)`).run(
      "y",
      2,
    );
    const result = service.createBackup(dbPath);

    const restored = new Database(result.path!, { readonly: true });
    try {
      const check = restored.pragma("integrity_check") as {
        integrity_check: string;
      }[];
      expect(check[0]!.integrity_check).toBe("ok");
    } finally {
      restored.close();
    }
  });

  it("is a point-in-time snapshot — later writes are not in it", () => {
    db.prepare(`INSERT INTO transactions (label, amount) VALUES (?, ?)`).run(
      "before",
      1,
    );
    const result = service.createBackup(dbPath);

    db.prepare(`INSERT INTO transactions (label, amount) VALUES (?, ?)`).run(
      "after",
      2,
    );

    // A backup that quietly grew after the fact would make "restore to the
    // 9am backup" meaningless.
    expect(readBackupLabels(result.path!)).toEqual(["before"]);
  });

  it("reports a missing database file instead of throwing", () => {
    const result = service.createBackup(path.join(dir, "nope.db"));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("lists the backup it just wrote", () => {
    db.prepare(`INSERT INTO transactions (label, amount) VALUES (?, ?)`).run(
      "z",
      3,
    );
    const result = service.createBackup(dbPath);

    // Returned [] for EVERY backup before the timestamp parse was fixed: the
    // filename reversed to `…T09:13:29:906Z`, an invalid date, and
    // toISOString() threw straight into the catch. Backups existed on disk
    // that the UI could never show or restore.
    const listed = service.listBackups();
    expect(listed.map((b) => b.path)).toContain(result.path);
    expect(listed[0]!.size).toBeGreaterThan(0);
  });

  it("recovers a real timestamp from the filename", () => {
    const result = service.createBackup(dbPath);
    const listed = service.listBackups();
    const row = listed.find((b) => b.path === result.path)!;

    // A valid instant, and the same one the filename encodes.
    expect(Number.isNaN(new Date(row.timestamp).getTime())).toBe(false);
    const fromName = path
      .basename(result.path!)
      .match(/-backup-(.+)\.db$/)![1]!;
    expect(row.timestamp.replace(/[:.]/g, "-")).toBe(fromName);
  });

  it("one unparseable filename does not blank the whole list", () => {
    const good = service.createBackup(dbPath);
    // A hand-renamed or third-party file sitting in the backup folder.
    fs.writeFileSync(path.join(backupDir, "weird-backup-nonsense.db"), "");

    const listed = service.listBackups();
    expect(listed.map((b) => b.path)).toContain(good.path);
    // Both are listed, and every timestamp is still a real instant.
    expect(listed.length).toBe(2);
    for (const b of listed) {
      expect(Number.isNaN(new Date(b.timestamp).getTime())).toBe(false);
    }
  });
});
