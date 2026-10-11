/**
 * LIRA-306 T104 — combined scenario (SC-001, SC-002). Written FIRST, next to
 * T077; it FAILS until every family has landed (fixtures + registered
 * bindings).
 *
 * PENDING when written (2026-10-11): every family's fixture module
 * (`offline/testHelpers/fixtures/<family>.ts`, convention in
 * `testHelpers/bindingFixtures.ts`) and registration in `bindings/index.ts`:
 * clients, transactions, sales, sessions, financial, recharge, debts,
 * expenses (Agents A/B); exchange, maintenance, customServices, loto, stock,
 * drawers, checkpoints (Agent C).
 *
 * One shop, one recorded outage holding at least one event of EVERY family
 * (all fixtures, in family-module order), replayed through the real
 * ReplayEngine — versus the same actions done online: each binding calls the
 * very service the REST route calls, so running the binding outside a replay
 * (server clock, no recorded time, no event) IS the online action.
 * Checkpoint-class events are applied (bypass the N8 hold) so they compare
 * too. Then every event is sent a second and third time: nothing changes.
 *
 * Compared: every business table, every column except row ids and
 * timestamps (the replayed rows carry the event's time by design).
 */
import type Database from "better-sqlite3";
import { CHANNEL_POLICY, type ChannelFamily } from "../channelPolicy";
import { loadAllFixtures, fixtureActor, parsedPayload, MATCH_RECORDED_RATES_SQL, type BindingFixture } from "../testHelpers/bindingFixtures";

type Harness = typeof import("../testHelpers/replayHarness");
type Tenant = typeof import("../../db/tenantContext");
type Engine = typeof import("../ReplayEngine");
type Registry = typeof import("../bindings/index");

const EXCLUDED_TABLE = /^(sqlite_|offline_|audit_log|activity_log|user_sessions|sync_|schema_)/;
const TIME_COLUMN = /(^|_)(at|date|time|timestamp|day)$|^created|^updated/;

function businessState(db: Database.Database): Record<string, unknown[]> {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[])
    .map((t) => t.name)
    .filter((n) => !EXCLUDED_TABLE.test(n));
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[])
      .map((c) => c.name)
      .filter((c) => c !== "id" && !TIME_COLUMN.test(c));
    if (cols.length === 0) continue;
    const list = cols.map((c) => `"${c}"`).join(", ");
    const rows = db.prepare(`SELECT ${list} FROM "${t}" ORDER BY ${list}`).all();
    if (rows.length) out[t] = rows;
  }
  return out;
}

function freshCore(): { h: Harness; tc: Tenant; eng: Engine; reg: Registry } {
  let mods!: { h: Harness; tc: Tenant; eng: Engine; reg: Registry };
  jest.isolateModules(() => {
    mods = {
      h: require("../testHelpers/replayHarness"),
      tc: require("../../db/tenantContext"),
      eng: require("../ReplayEngine"),
      reg: require("../bindings/index"),
    };
  });
  return mods;
}

const families = new Set(
  CHANNEL_POLICY.filter((e) => e.cls === "offline" || e.cls === "checkpoint").map((e) => e.family as ChannelFamily),
);

describe("all families — one outage replayed equals the same work online (T104)", () => {
  const byFamily = loadAllFixtures();
  const fixtures: BindingFixture[] = Object.values(byFamily).flat();

  const uncovered = (): string[] => {
    const policyFamily = new Map(CHANNEL_POLICY.map((e) => [e.channel, e.family]));
    const covered = new Set(fixtures.map((f) => policyFamily.get(f.channel)));
    return [...families].filter((f) => !covered.has(f)).sort();
  };

  it("has at least one fixture event of every family", () => {
    expect(uncovered()).toEqual([]);
  });

  it("replayed outage == online, per table; resent twice → unchanged", async () => {
    // never vacuous: an outage missing a family proves nothing about it
    expect(uncovered()).toEqual([]);
    // ---- online
    const on = freshCore();
    const online = on.h.installReplayDb();
    online.db.exec(MATCH_RECORDED_RATES_SQL);
    for (const f of fixtures) if (f.seedSql) online.db.exec(f.seedSql);
    const onlineFailures: string[] = [];
    for (const f of fixtures) {
      const b = on.reg.getOfflineBinding(f.channel);
      if (!b) {
        onlineFailures.push(`${f.channel}: no binding`);
        continue;
      }
      try {
        const res = await on.tc.runWithTenant(1, () => b.run(parsedPayload(f.channel, f.payload), { tenantId: 1, actorUserId: fixtureActor(f), eventId: "online", deviceId: 0 }), {
          clientDay: "2026-10-10",
        });
        if (!res || res.success !== true) onlineFailures.push(`${f.channel}: ${res?.error ?? "refused"}`);
      } catch (e) {
        onlineFailures.push(`${f.channel}: threw ${(e as Error).message}`);
      }
    }
    const expected = businessState(online.db);
    on.h.uninstallReplayDb(online.db);
    expect(onlineFailures).toEqual([]);

    // ---- replay
    const off = freshCore();
    const offline = off.h.installReplayDb();
    off.h.resetSeq();
    offline.db.exec(MATCH_RECORDED_RATES_SQL);
    for (const f of fixtures) if (f.seedSql) offline.db.exec(f.seedSql);
    const engine = new off.eng.ReplayEngine();
    const stored = fixtures.map((f) => off.h.storeEvent({ deviceId: offline.deviceId, channel: f.channel, payload: f.payload, actorUserId: fixtureActor(f) }));
    const replayFailures: string[] = [];
    for (const row of stored) {
      const out = await off.tc.runWithTenant(1, () => engine.process(row, { mode: "apply", bypass: { checkpoint: true } }));
      if (out.status !== "booked" && out.status !== "applied") replayFailures.push(`${row.channel}: ${out.status} ${out.error ?? ""}`);
    }
    expect(replayFailures).toEqual([]);
    const afterFirst = businessState(offline.db);
    expect(afterFirst).toEqual(expected);

    // ---- resent twice (same event ids): skipped, nothing changes
    for (let round = 0; round < 2; round++) {
      for (const row of stored) {
        const again = off.h.storeEvent({
          deviceId: offline.deviceId,
          channel: row.channel,
          payload: JSON.parse(row.payload_json) as Record<string, unknown>,
          actorUserId: row.actor_user_id,
          eventId: row.event_id,
          seq: row.device_seq,
        });
        await off.tc.runWithTenant(1, () => engine.process(again, { mode: "auto" }));
      }
    }
    expect(businessState(offline.db)).toEqual(afterFirst);
    off.h.uninstallReplayDb(offline.db);
  });
});
