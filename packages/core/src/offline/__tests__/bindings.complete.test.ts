/**
 * LIRA-306 T077 — cross-family completeness guard (SC-006). Written FIRST, at
 * the start of Phase 6: it FAILS until every family has landed and the
 * parent has registered every family's bindings in `bindings/index.ts`.
 *
 * PENDING when written (2026-10-11): every family except `sales:process`
 * (Agent A) — i.e. clients, transactions, sales (rest), sessions, financial,
 * recharge, debts, expenses (Agents A/B) and exchange, maintenance,
 * customServices, loto, stock, drawers, checkpoints (Agent C). A red run here
 * names exactly which channels/files are still missing.
 *
 * It asserts, for every `offline`/`checkpoint` channel of the policy (the
 * set is read from CHANNEL_POLICY, never a hard-coded 78, so a channel moved
 * between classes needs no edit here):
 *   1. exactly one binding is registered (the registry throws on a second);
 *   2. its recorded schema exists and is the policy's core schema object
 *      (`toBe`, rule 14) — no channel left in PENDING_LIFT;
 *   3. its fixture (`testHelpers/fixtures/<family>.ts`, see
 *      `testHelpers/bindingFixtures.ts`) books through the real ReplayEngine
 *      without yielding to the event loop — a `setImmediate` sentinel would
 *      turn it into a technical failure (microtask-only awaits, pass 3 D2);
 *   4. T026's requestNow ratchet (`utils/__tests__/requestNow.guard.test.ts`
 *      `PENDING`) is empty.
 */
import fs from "node:fs";
import path from "node:path";
import { runWithTenant } from "../../db/tenantContext";
import * as validators from "../../validators/index";
import { CHANNEL_POLICY, PENDING_LIFT, recordedSchema, objectShapeOf } from "../channelPolicy";
import { boundChannels, getOfflineBinding } from "../bindings/index";
import { ReplayEngine } from "../ReplayEngine";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../testHelpers/replayHarness";
import { loadAllFixtures, fixtureActor, MATCH_RECORDED_RATES_SQL, type BindingFixture } from "../testHelpers/bindingFixtures";

const RECORDABLE = CHANNEL_POLICY.filter((e) => e.cls === "offline" || e.cls === "checkpoint");
const RECORDABLE_CHANNELS = RECORDABLE.map((e) => e.channel).sort();

describe("offline bindings — complete (T077, SC-006)", () => {
  it("PENDING_LIFT is empty (every recordable channel has a core schema)", () => {
    expect([...PENDING_LIFT]).toEqual([]);
  });

  it("every offline/checkpoint channel has exactly one binding, and nothing else is bound", () => {
    const missing = RECORDABLE_CHANNELS.filter((c) => !getOfflineBinding(c));
    const extra = boundChannels().filter((c) => !RECORDABLE_CHANNELS.includes(c));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("each channel's recorded schema is the policy's core schema object (toBe)", () => {
    const wrong: string[] = [];
    for (const e of RECORDABLE) {
      const schema = recordedSchema(e.channel);
      if (!schema || !e.coreSchema) {
        wrong.push(`${e.channel}: no core schema`);
        continue;
      }
      const core = (validators as Record<string, unknown>)[e.coreSchema];
      // envelope channels extend the core object — its keys must still be the core's
      const coreShape = objectShapeOf(core as never);
      const shape = objectShapeOf(schema);
      const same = schema === core || (!!coreShape && !!shape && Object.keys(coreShape).every((k) => shape[k] === coreShape[k]));
      if (!same) wrong.push(`${e.channel}: recorded schema is not ${e.coreSchema}`);
    }
    expect(wrong).toEqual([]);
  });

  it("T026's requestNow ratchet is empty", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../utils/__tests__/requestNow.guard.test.ts"), "utf8");
    const block = src.match(/const PENDING: Record<string, number> = \{([\s\S]*?)\};/);
    expect(block).not.toBeNull();
    const entries = (block![1].match(/"[^"]+":\s*\d+/g) ?? []);
    expect(entries).toEqual([]);
  });

  it("every channel has a fixture, and each fixture books without yielding (sentinel never fires)", async () => {
    const byFamily = loadAllFixtures();
    const fixtures: BindingFixture[] = Object.values(byFamily).flat();
    const withFixture = new Set(fixtures.map((f) => f.channel));
    const noFixture = RECORDABLE_CHANNELS.filter((c) => !withFixture.has(c));

    const { db, deviceId } = installReplayDb();
    resetSeq();
    try {
      db.exec(MATCH_RECORDED_RATES_SQL);
      for (const f of fixtures) if (f.seedSql) db.exec(f.seedSql);
      const failures: string[] = [];
      const engine = new ReplayEngine();
      for (const f of fixtures) {
        if (!getOfflineBinding(f.channel)) continue; // reported by the binding test above
        const row = storeEvent({ deviceId, channel: f.channel, payload: f.payload, actorUserId: fixtureActor(f) });
        const out = await runWithTenant(1, () => engine.process(row, { mode: "apply", bypass: { checkpoint: true } }));
        if (out.status !== "booked" && out.status !== "applied") failures.push(`${f.channel}: ${out.status} ${out.error ?? ""}`);
      }
      expect({ noFixture, failures }).toEqual({ noFixture: [], failures: [] });
    } finally {
      uninstallReplayDb(db);
    }
  });
});
