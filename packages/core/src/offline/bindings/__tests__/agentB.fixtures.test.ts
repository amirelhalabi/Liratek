/**
 * LIRA-306 — the Agent B family fixtures (testHelpers/fixtures/{salesRest,
 * sessions,financial,recharge,debtsRest,expensesRest}.ts) book through the
 * real ReplayEngine with these families' bindings, in one shop seeded with
 * every one of their seeds — the same procedure T077 runs over the registry,
 * runnable before the bindings are registered there.
 */
import { runWithTenant } from "../../../db/tenantContext";
import { ReplayEngine } from "../../ReplayEngine";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../../testHelpers/replayHarness";
import { fixtureActor, MATCH_RECORDED_RATES_SQL, type BindingFixture } from "../../testHelpers/bindingFixtures";
import { bindingLookup } from "../../testHelpers/familyHarness";
import { CHANNEL_POLICY } from "../../channelPolicy";
import { SALES_REST_BINDINGS } from "../salesRest";
import { SESSIONS_BINDINGS } from "../sessions";
import { FINANCIAL_BINDINGS } from "../financial";
import { RECHARGE_BINDINGS } from "../recharge";
import { DEBTS_REST_BINDINGS } from "../debtsRest";
import { EXPENSES_REST_BINDINGS } from "../expensesRest";
import { FIXTURES as SALES } from "../../testHelpers/fixtures/salesRest";
import { FIXTURES as SESSIONS } from "../../testHelpers/fixtures/sessions";
import { FIXTURES as FINANCIAL } from "../../testHelpers/fixtures/financial";
import { FIXTURES as RECHARGE } from "../../testHelpers/fixtures/recharge";
import { FIXTURES as DEBTS } from "../../testHelpers/fixtures/debtsRest";
import { FIXTURES as EXPENSES } from "../../testHelpers/fixtures/expensesRest";

const LISTS = [SALES_REST_BINDINGS, SESSIONS_BINDINGS, FINANCIAL_BINDINGS, RECHARGE_BINDINGS, DEBTS_REST_BINDINGS, EXPENSES_REST_BINDINGS];
const bindings = bindingLookup(...LISTS);
const ALL: BindingFixture[] = [...SALES, ...SESSIONS, ...FINANCIAL, ...RECHARGE, ...DEBTS, ...EXPENSES];

describe("Agent B family fixtures", () => {
  it("cover every channel these bindings own (36), and nothing else", () => {
    const bound = LISTS.flat().map((b) => b.channel).sort();
    expect(bound).toHaveLength(36);
    expect([...new Set(ALL.map((f) => f.channel))].sort()).toEqual(bound);
    for (const ch of bound) expect(CHANNEL_POLICY.find((e) => e.channel === ch)?.cls).toBe("offline");
  });

  it("every fixture books, in one shop seeded with all six families", async () => {
    const { db, deviceId } = installReplayDb();
    resetSeq();
    try {
      db.exec(MATCH_RECORDED_RATES_SQL);
      for (const f of ALL) if (f.seedSql) db.exec(f.seedSql);
      // the seeds reference only rows that exist (checked with FKs on afterwards)
      expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
      const engine = new ReplayEngine({ bindings });
      const failures: string[] = [];
      for (const f of ALL) {
        const row = storeEvent({ deviceId, channel: f.channel, payload: f.payload, actorUserId: fixtureActor(f) });
        const out = await runWithTenant(1, () => engine.process(row, { mode: "auto" }));
        if (out.status !== "booked") failures.push(`${f.channel}: ${out.status} ${out.error ?? ""}`);
      }
      expect(failures).toEqual([]);
    } finally {
      uninstallReplayDb(db);
    }
  });
});
