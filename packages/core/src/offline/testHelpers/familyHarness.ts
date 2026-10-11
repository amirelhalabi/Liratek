/**
 * Test helper (not a test) for the Phase 6 family bindings (LIRA-306, Agent B
 * families): replay ONE event through the real ReplayEngine with a given
 * binding list (the registry in `bindings/index.ts` is not needed), compare
 * it with the same action done online, and check replay time.
 *
 * Replay time: the harness's events occur at 2026-10-10T20:50:00Z (23:50
 * Beirut, day N) and are replayed "now" (later), so every business row the
 * booking creates must carry `2026-10-10 20:50:00` — not the server's clock.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { ReplayEngine, type ReplayOutcome } from "../ReplayEngine";
import type { OfflineBinding } from "../bindings/types";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "./replayHarness";
import { moneyState } from "./parity";

export const EVENT_INSTANT = "2026-10-10T20:50:00.000Z";
export const EVENT_SQL_TIME = "2026-10-10 20:50:00";
export const EVENT_DAY = "2026-10-10";

/** Tables the engine itself writes (not the family's booking). */
const ENGINE_TABLES = new Set([
  "audit_log",
  "offline_events",
  "offline_id_map",
  "offline_review_items",
  "offline_devices",
]);

export function bindingLookup(...lists: ReadonlyArray<readonly OfflineBinding[]>): (ch: string) => OfflineBinding | undefined {
  const m = new Map<string, OfflineBinding>();
  for (const l of lists) for (const b of l) m.set(b.channel, b);
  return (ch) => m.get(ch);
}

export interface ReplayOneOptions {
  actorUserId?: number;
  created?: Record<string, number[]>;
}

/** Store + replay one event; returns the outcome. */
export async function replayOne(
  deviceId: number,
  channel: string,
  payload: Record<string, unknown>,
  bindings: (ch: string) => OfflineBinding | undefined,
  o: ReplayOneOptions = {},
): Promise<ReplayOutcome> {
  const row = storeEvent({
    deviceId,
    channel,
    payload,
    actorUserId: o.actorUserId ?? 1,
    occurredAt: EVENT_INSTANT,
    clientDay: EVENT_DAY,
    created: o.created,
  });
  return runWithTenant(1, () => new ReplayEngine({ bindings }).process(row, { mode: "auto" }));
}

/** created_at of every business row the booking created (engine tables excluded). */
export function createdTimes(db: Database.Database, serverIds: Record<string, number[]> | undefined): Array<{ table: string; id: number; created_at: unknown }> {
  const out: Array<{ table: string; id: number; created_at: unknown }> = [];
  for (const [table, ids] of Object.entries(serverIds ?? {})) {
    if (ENGINE_TABLES.has(table) || ids.length === 0) continue;
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes("created_at")) continue;
    for (const id of ids) {
      const r = db.prepare(`SELECT created_at FROM ${table} WHERE id = ?`).get(id) as { created_at: unknown } | undefined;
      if (r) out.push({ table, id, created_at: r.created_at });
    }
  }
  return out;
}

/** Values of `column` on the rows of `table` the booking created. */
export function createdValues(db: Database.Database, outcome: ReplayOutcome, table: string, column: string): unknown[] {
  const ids = outcome.serverIds?.[table] ?? [];
  return ids.map((id) => (db.prepare(`SELECT ${column} AS v FROM ${table} WHERE id = ?`).get(id) as { v: unknown } | undefined)?.v);
}

/** The rows whose created_at is NOT the event's instant (should be []). */
export function offTimeRows(db: Database.Database, serverIds: Record<string, number[]> | undefined): Array<{ table: string; id: number; created_at: unknown }> {
  return createdTimes(db, serverIds).filter((r) => r.created_at !== EVENT_SQL_TIME);
}

/**
 * Every row of the given tables, minus clock columns (`*_at`) — ids are kept:
 * both sides are fresh databases seeded identically, so a booking that matches
 * creates the same ids.
 */
export function tableState(
  db: Database.Database,
  tables: readonly string[],
  /** more clock-derived columns to leave out (checked separately on the replay side) */
  omit: readonly string[] = [],
): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>)
      .map((c) => c.name)
      .filter((c) => !/_at$/.test(c) && !omit.includes(c));
    out[t] = db.prepare(`SELECT ${cols.join(", ")} FROM ${t} ORDER BY id`).all();
  }
  return out;
}

export interface ParityCase {
  /** seeds a fresh DB (both sides) */
  seed: (db: Database.Database) => void | Promise<void>;
  /** what the REST route does, inside runWithTenant(1) */
  online: () => unknown;
  channel: string;
  /** a function is evaluated after the online side ran (ids known from seeding) */
  payload: Record<string, unknown> | (() => Record<string, unknown>);
  bindings: (ch: string) => OfflineBinding | undefined;
  /** extra state to compare (beyond moneyState) */
  state?: (db: Database.Database) => unknown;
  reset?: () => void;
  actorUserId?: number;
  /** runs on the replay database after the replay (e.g. business-day checks) */
  replayCheck?: (db: Database.Database, outcome: ReplayOutcome) => unknown;
}

export interface ParityRun {
  online: { result: unknown; state: unknown };
  replay: { outcome: ReplayOutcome; state: unknown; offTime: Array<{ table: string; id: number; created_at: unknown }>; check: unknown };
}

/** Same action online and replayed, on two fresh databases. */
export async function runParity(c: ParityCase): Promise<ParityRun> {
  const snapshot = (db: Database.Database) => ({ money: moneyState(db), extra: c.state ? c.state(db) : null });

  c.reset?.();
  const on = installReplayDb();
  await c.seed(on.db);
  let onlineResult: unknown;
  let onlineState: unknown;
  try {
    onlineResult = await runWithTenant(1, () => c.online(), { clientDay: EVENT_DAY });
    onlineState = snapshot(on.db);
  } finally {
    uninstallReplayDb(on.db);
  }

  c.reset?.();
  resetSeq();
  const off = installReplayDb();
  try {
    await c.seed(off.db);
    const payload = typeof c.payload === "function" ? c.payload() : c.payload;
    const outcome = await replayOne(off.deviceId, c.channel, payload, c.bindings, { actorUserId: c.actorUserId });
    return {
      online: { result: onlineResult, state: onlineState },
      replay: {
        outcome,
        state: snapshot(off.db),
        offTime: offTimeRows(off.db, outcome.serverIds),
        check: c.replayCheck ? c.replayCheck(off.db, outcome) : null,
      },
    };
  } finally {
    uninstallReplayDb(off.db);
  }
}
