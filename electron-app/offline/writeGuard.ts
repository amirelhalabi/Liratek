/**
 * LIRA-306 — the working copy's write guard (R14, FR-036).
 *
 * In every paired mode with a working copy the connection runs with
 * `PRAGMA query_only = ON`: nothing can write except inside a window the
 * recorder (or a local channel such as sign-in) opens. A read screen that
 * tries to write is therefore refused by SQLite itself, and the attempt is
 * logged so the N5 manifest can report it (`ReadWriteLog`).
 */
import fs from "node:fs";
import type BetterSqlite3 from "better-sqlite3";

export class WriteGuard {
  private depth = 0;
  private locked = false;

  constructor(private readonly db: () => BetterSqlite3.Database) {}

  /** Make the connection read-only (paired modes with a working copy). */
  lockdown(): void {
    this.locked = true;
    this.db().pragma("query_only = ON");
  }

  /** Back to normal (standalone; tests). */
  release(): void {
    this.locked = false;
    this.depth = 0;
    this.db().pragma("query_only = OFF");
  }

  isLocked(): boolean {
    return this.locked;
  }

  open(): void {
    if (!this.locked) return;
    if (this.depth++ === 0) this.db().pragma("query_only = OFF");
  }

  close(): void {
    if (!this.locked || this.depth === 0) return;
    if (--this.depth === 0) this.db().pragma("query_only = ON");
  }

  /** Synchronous writable block (sign-in bookkeeping, outbox status). */
  withWritable<T>(fn: () => T): T {
    this.open();
    try {
      return fn();
    } finally {
      this.close();
    }
  }
}

/** True when an error is SQLite refusing a write under query_only. */
export function isReadOnlyRefusal(message: string | undefined | null): boolean {
  return (
    !!message && /readonly|read-only|query_only|attempt to write/i.test(message)
  );
}

/** Reads that tried to write, kept on disk for the manifest (FR-036). */
export class ReadWriteLog {
  private cache: Array<{ channel: string; changes: number }> | null = null;

  constructor(private readonly file: string) {}

  entries(): Array<{ channel: string; changes: number }> {
    if (this.cache) return [...this.cache];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as unknown;
      this.cache = Array.isArray(parsed)
        ? parsed.filter(
            (e): e is { channel: string; changes: number } =>
              !!e &&
              typeof e.channel === "string" &&
              typeof e.changes === "number",
          )
        : [];
    } catch {
      this.cache = [];
    }
    return [...this.cache];
  }

  record(channel: string, changes: number): void {
    const list = this.entries();
    const hit = list.find((e) => e.channel === channel);
    if (hit) hit.changes += changes;
    else list.push({ channel, changes });
    this.cache = list;
    try {
      fs.writeFileSync(this.file, JSON.stringify(list), "utf8");
    } catch {
      // best effort; the in-memory list still reaches the manifest
    }
  }

  clear(): void {
    this.cache = [];
    try {
      fs.unlinkSync(this.file);
    } catch {
      // not there
    }
  }
}
