/**
 * LIRA-306 O-impl-A2-8 — the requestNow ratchet (`utils/__tests__/
 * requestNow.guard.test.ts`) exempts a few supplier / partner writers that
 * stamp the server clock because ONLY online-only channels reach them
 * (`ONLINE_ONLY_EXEMPT`). This guard keeps that premise true:
 *
 *   1. static — no offline binding module names an exempted method;
 *   2. dynamic — every recordable channel's fixture is replayed through the
 *      real ReplayEngine with every exempted method spied on; none is called;
 *   3. self-test — a binding that DOES reach an exempted method is caught
 *      (the guard is not vacuous).
 *
 * Limits: (2) covers the paths the fixtures exercise, not every branch of
 * every service; (1) catches only direct calls from bindings. Together with
 * the channel policy (these channels are `online_only`) that is the written
 * list's backing, not a proof over all code paths.
 */
import fs from "node:fs";
import path from "node:path";
import { runWithTenant } from "../../db/tenantContext";
import { ReplayEngine } from "../ReplayEngine";
import { getOfflineBinding } from "../bindings/index";
import type { OfflineBinding } from "../bindings/types";
import { CHANNEL_POLICY } from "../channelPolicy";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../testHelpers/replayHarness";
import { loadAllFixtures, fixtureActor, MATCH_RECORDED_RATES_SQL, type BindingFixture } from "../testHelpers/bindingFixtures";
import { SupplierRepository, getSupplierRepository } from "../../repositories/SupplierRepository";
import { PartnerRepository } from "../../repositories/PartnerRepository";
import { ONLINE_ONLY_EXEMPT } from "../testHelpers/onlineOnlyExempt";

const PROTOTYPES: Record<string, object> = {
  "SupplierRepository.ts": SupplierRepository.prototype,
  "PartnerRepository.ts": PartnerRepository.prototype,
};

function spyAll(): { calls: () => string[]; restore: () => void } {
  const spies: Array<{ name: string; spy: jest.SpyInstance }> = [];
  for (const [file, list] of Object.entries(ONLINE_ONLY_EXEMPT)) {
    const proto = PROTOTYPES[file] as Record<string, unknown>;
    for (const e of list) {
      if (typeof proto[e.method] !== "function") throw new Error(`${file}: ${e.method} is not a method`);
      // call-through spy: records the call, runs the real method
      spies.push({ name: `${file}#${e.method}`, spy: jest.spyOn(proto as never, e.method as never) });
    }
  }
  return {
    calls: () => spies.filter((s) => s.spy.mock.calls.length > 0).map((s) => s.name),
    restore: () => spies.forEach((s) => s.spy.mockRestore()),
  };
}

describe("online-only exemptions stay unreachable from recordable channels", () => {
  it("every exempted channel is online-only in the channel policy", () => {
    const wrong: string[] = [];
    for (const list of Object.values(ONLINE_ONLY_EXEMPT)) {
      for (const e of list) {
        for (const ch of e.channels) {
          const cls = CHANNEL_POLICY.find((p) => p.channel === ch)?.cls;
          if (cls !== "online_only") wrong.push(`${e.method} ← ${ch}: ${cls ?? "unknown"}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("no offline binding module names an exempted method", () => {
    const dir = path.join(__dirname, "../bindings");
    const hits: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const list of Object.values(ONLINE_ONLY_EXEMPT)) {
        for (const e of list) if (new RegExp(`\\.${e.method}\\s*\\(`).test(src)) hits.push(`${f} → ${e.method}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("replaying every recordable fixture never calls an exempted method", async () => {
    const fixtures: BindingFixture[] = Object.values(loadAllFixtures()).flat();
    const { db, deviceId } = installReplayDb();
    resetSeq();
    const spy = spyAll();
    try {
      db.exec(MATCH_RECORDED_RATES_SQL);
      for (const f of fixtures) if (f.seedSql) db.exec(f.seedSql);
      const engine = new ReplayEngine();
      let booked = 0;
      for (const f of fixtures) {
        if (!getOfflineBinding(f.channel)) continue;
        const row = storeEvent({ deviceId, channel: f.channel, payload: f.payload, actorUserId: fixtureActor(f) });
        const out = await runWithTenant(1, () => engine.process(row, { mode: "apply", bypass: { checkpoint: true } }));
        if (out.status === "booked" || out.status === "applied") booked += 1;
      }
      expect(booked).toBeGreaterThan(70); // the run really booked the fixtures
      expect(spy.calls()).toEqual([]);
    } finally {
      spy.restore();
      uninstallReplayDb(db);
    }
  });

  it("self-test: a binding that reaches an exempted method is caught", async () => {
    const { db, deviceId } = installReplayDb();
    resetSeq();
    const spy = spyAll();
    try {
      const bad: OfflineBinding = {
        channel: "sales:update-metadata",
        run: () => {
          try {
            getSupplierRepository().createSupplier({ name: "x" } as never);
          } catch {
            /* the spy records the call either way */
          }
          return { success: true };
        },
      };
      const row = storeEvent({ deviceId, channel: "sales:update-metadata", payload: { id: 1, note: "x" } });
      await runWithTenant(1, () => new ReplayEngine({ bindings: () => bad }).process(row, { mode: "auto" }));
      expect(spy.calls()).toEqual(["SupplierRepository.ts#createSupplier"]);
    } finally {
      spy.restore();
      uninstallReplayDb(db);
    }
  });
});
