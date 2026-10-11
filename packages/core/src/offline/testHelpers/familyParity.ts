/**
 * Test helper (not a test) — run the same steps ONLINE (each binding called
 * directly: it calls the very service the REST route calls, on the server
 * clock, no event) and as a REPLAYED outage (stored events through the real
 * ReplayEngine), each on a fresh real-schema database with fresh module
 * singletons (`jest.isolateModules`, so no repository keeps a handle on the
 * previous database). Family bindings are injected, so a family test does not
 * depend on the registry (`bindings/index.ts`).
 */
import type Database from "better-sqlite3";
import type { OfflineBinding, BindingResult } from "../bindings/types";
import { parsedPayload } from "./bindingFixtures";

type Harness = typeof import("./replayHarness");
type Tenant = typeof import("../../db/tenantContext");
type Engine = typeof import("../ReplayEngine");

export interface Step {
  channel: string;
  payload: Record<string, unknown>;
}

export interface RunOptions {
  /** absolute module path of the family's bindings (e.g. require.resolve("../exchange")) */
  bindingsModule: string;
  /** its exported array (e.g. "EXCHANGE_BINDINGS") */
  exportName: string;
  seedSql?: string;
  steps: readonly Step[];
  actorUserId?: number;
  clientDay?: string;
}

export interface ReplayRunOptions extends RunOptions {
  occurredAt?: string;
  clientTzOffsetMinutes?: number;
  rates?: unknown;
  /** checkpoint channels: press Apply (bypass the N8 hold) */
  apply?: boolean;
}

function fresh(bindingsModule: string, exportName: string): {
  h: Harness;
  tc: Tenant;
  eng: Engine;
  list: readonly OfflineBinding[];
} {
  let out!: { h: Harness; tc: Tenant; eng: Engine; list: readonly OfflineBinding[] };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(bindingsModule) as Record<string, readonly OfflineBinding[]>;
    out = {
      h: require("./replayHarness"),
      tc: require("../../db/tenantContext"),
      eng: require("../ReplayEngine"),
      list: mod[exportName],
    };
  });
  if (!out.list) throw new Error(`${bindingsModule} has no export ${exportName}`);
  return out;
}

export async function runOnline(o: RunOptions): Promise<{ db: Database.Database; results: BindingResult[] }> {
  const { h, tc, list } = fresh(o.bindingsModule, o.exportName);
  const { db } = h.installReplayDb();
  if (o.seedSql) db.exec(o.seedSql);
  const results: BindingResult[] = [];
  for (const s of o.steps) {
    const b = list.find((x) => x.channel === s.channel);
    if (!b) throw new Error(`no binding for ${s.channel}`);
    results.push(
      await tc.runWithTenant(
        1,
        () => b.run(parsedPayload(s.channel, s.payload), { tenantId: 1, actorUserId: o.actorUserId ?? 2, eventId: "online", deviceId: 0 }),
        { clientDay: o.clientDay ?? "2026-10-10" },
      ),
    );
  }
  return { db, results };
}

export async function runReplay(
  o: ReplayRunOptions,
): Promise<{ db: Database.Database; outcomes: Array<{ status: string; error?: string | null }> }> {
  const { h, tc, eng, list } = fresh(o.bindingsModule, o.exportName);
  const { db, deviceId } = h.installReplayDb();
  h.resetSeq();
  if (o.seedSql) db.exec(o.seedSql);
  const engine = new eng.ReplayEngine({ bindings: (c) => list.find((x) => x.channel === c) });
  const outcomes: Array<{ status: string; error?: string | null }> = [];
  for (const s of o.steps) {
    const row = h.storeEvent({
      deviceId,
      channel: s.channel,
      payload: s.payload,
      actorUserId: o.actorUserId,
      occurredAt: o.occurredAt,
      clientDay: o.clientDay,
      clientTzOffsetMinutes: o.clientTzOffsetMinutes,
      rates: o.rates,
    });
    const out = await tc.runWithTenant(1, () =>
      engine.process(row, o.apply ? { mode: "apply", bypass: { checkpoint: true } } : { mode: "auto" }),
    );
    outcomes.push({ status: out.status, error: out.error });
  }
  return { db, outcomes };
}

export function closeDb(db: Database.Database): void {
  delete (globalThis as { __LIRATEK_TEST_DB__?: unknown }).__LIRATEK_TEST_DB__;
  db.close();
}

const TIME_COLUMN = /(^|_)(at|date|time|timestamp)$|^created|^updated/;

/** Rows of the given tables, every column except `id` and timestamps. */
export function tableState(db: Database.Database, tables: readonly string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[])
      .map((c) => c.name)
      .filter((c) => c !== "id" && !TIME_COLUMN.test(c));
    const list = cols.map((c) => `"${c}"`).join(", ");
    out[t] = db.prepare(`SELECT ${list} FROM "${t}" WHERE tenant_id = 1 ORDER BY ${list}`).all();
  }
  return out;
}

/** The money tables every family touches (drawers, legs, unified rows, debt, supplier ledger). */
export const MONEY_TABLES = ["drawer_balances", "payments", "transactions", "debt_ledger", "supplier_ledger"] as const;

/** Distinct `DATE(col)` values of a table (for replay-time assertions). */
export function daysOf(db: Database.Database, table: string, col = "created_at", where = "1 = 1"): string[] {
  return (db.prepare(`SELECT DISTINCT DATE(${col}) AS d FROM ${table} WHERE ${col} IS NOT NULL AND (${where}) ORDER BY d`).all() as { d: string }[]).map(
    (r) => r.d,
  );
}
