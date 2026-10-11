/**
 * Offline replay isolation (LIRA-306, R6, FR-018) — server-only (async_hooks).
 *
 * A replayed event runs in ONE transaction that must never interleave with
 * a web or phone write: better-sqlite3 is synchronous and Node runs one piece
 * of JavaScript at a time, so as long as the replay never yields to the event
 * loop nothing else can run inside it. This module makes that a guarantee,
 * not a hope:
 *   - while a replay window is open, `getDatabase()` refuses any statement
 *     from an async context that does not carry the replay's token
 *     (`REPLAY_IN_PROGRESS` — the other request fails visibly and the user
 *     saves again; it can never join or be undone with the replay);
 *   - the engine also arms a `setImmediate` sentinel and rolls the replay
 *     back if it fired (a binding awaited real I/O).
 * Limitation: a repository that cached a connection object before the window
 * bypasses `getDatabase()`; the sentinel still catches the yield itself.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";

export class ReplayInProgressError extends Error {
  readonly code = "REPLAY_IN_PROGRESS";
  constructor() {
    super("REPLAY_IN_PROGRESS: offline work is being booked right now — please save again in a moment.");
    this.name = "ReplayInProgressError";
  }
}

const replayAls = new AsyncLocalStorage<symbol>();
let activeToken: symbol | null = null;

/** Called by `getDatabase()` on every access; a cheap null check when idle. */
export function assertNotBlockedByReplay(): void {
  if (activeToken !== null && replayAls.getStore() !== activeToken) {
    throw new ReplayInProgressError();
  }
}

/** True inside a replay window (used by replay-only switches, e.g. stock). */
export function isOfflineReplay(): boolean {
  return activeToken !== null && replayAls.getStore() === activeToken;
}

/**
 * Run `fn` as THE replay window: one at a time per process; statements from
 * other async contexts are refused until it settles.
 */
export async function runReplayWindow<T>(fn: () => Promise<T>): Promise<T> {
  if (activeToken !== null) throw new ReplayInProgressError();
  const token = Symbol("offline-replay");
  activeToken = token;
  try {
    return await replayAls.run(token, fn);
  } finally {
    activeToken = null;
  }
}

/** Explicit transaction control for an async binding (db.transaction() refuses promises). */
export function beginReplayTransaction(db: Database.Database): void {
  db.exec("BEGIN IMMEDIATE");
}
export function commitReplayTransaction(db: Database.Database): void {
  db.exec("COMMIT");
}
export function rollbackReplayTransaction(db: Database.Database): void {
  if (db.inTransaction) db.exec("ROLLBACK");
}
