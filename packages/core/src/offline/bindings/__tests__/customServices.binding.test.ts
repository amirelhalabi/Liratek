/**
 * LIRA-306 T094 — custom-services family: `custom-services:add`,
 * `custom-services:delete`, `custom-services:update-metadata`,
 * `custom-services:advance-fulfillment`, `custom-services:set-work-status`.
 * Replayed through the ReplayEngine they book exactly what the services the
 * REST routes (backend/src/api/customServices.ts) call book online, per
 * currency, on the event's own day, at the PC's recorded rate.
 *
 * Actor note: `addService`/`deleteService` take no actor on EITHER transport
 * today (creator = fallback admin; the void is credited to the row's
 * creator) — the bindings keep that parity. Only update-metadata stamps a
 * user (`edited_by` = username).
 */
import {
  createCustomServiceSchema,
  customServiceIdParamSchema,
  customServiceUpdateMetadataSchema,
  updateCustomServiceFulfillmentSchema,
  updateCustomServiceWorkStatusSchema,
} from "../../../validators/customService";
import { recordedSchema } from "../../channelPolicy";
import { runOnline, runReplay, closeDb, tableState, daysOf, MONEY_TABLES, type Step } from "../../testHelpers/familyParity";
import { FIXTURES } from "../../testHelpers/fixtures/customServices";

const MOD = require.resolve("../customServices");
const NAME = "CUSTOM_SERVICES_BINDINGS";
const TABLES = [...MONEY_TABLES, "custom_services"];
/** most channels here are admin-only (the engine re-checks roles); user 1 is the seeded admin */
const ADMIN = 1;
/** a second admin, to prove the actor comes from the event */
const ACTOR_SQL = `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (__ID__, 1, 'second-admin', '', 'admin', 1);`;
const seedSql = FIXTURES.map((f) => f.seedSql ?? "").join("\n");
const steps: Step[] = FIXTURES.map((f) => ({ channel: f.channel, payload: f.payload }));

describe("custom-services bindings (T094)", () => {
  it("record with the routes' schema objects", () => {
    expect(recordedSchema("custom-services:add")).toBe(createCustomServiceSchema);
    expect(recordedSchema("custom-services:delete")).toBe(customServiceIdParamSchema);
    expect(recordedSchema("custom-services:update-metadata")).toBe(customServiceUpdateMetadataSchema);
    expect(recordedSchema("custom-services:advance-fulfillment")).toBe(updateCustomServiceFulfillmentSchema);
    expect(recordedSchema("custom-services:set-work-status")).toBe(updateCustomServiceWorkStatusSchema);
  });

  it("the add schema keeps every key the handler/route forward (rule 23)", () => {
    const parsed = createCustomServiceSchema.parse({
      description: "x",
      price_usd: 5,
      transaction_time: "2026-10-01T10:00:00.000Z",
      kept_change_usd: 1,
      kept_change_lbp: 1000,
      exchange_rate: 90000,
      partnerId: 3,
      partnerMode: "VIA",
      product_id: 4,
      fulfillment_status: "ORDERED",
      voucher_code: "V",
      category: "c",
    }) as Record<string, unknown>;
    for (const k of ["transaction_time", "kept_change_usd", "kept_change_lbp", "exchange_rate", "partnerId", "partnerMode", "product_id", "fulfillment_status", "voucher_code", "category"]) {
      expect({ k, kept: k in parsed }).toEqual({ k, kept: true });
    }
    expect(customServiceIdParamSchema.parse({ id: "7" })).toEqual({ id: 7 });
  });

  it("replay == online, per table and currency", async () => {
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: ADMIN });
    expect(on.results.map((r) => r.success)).toEqual(steps.map(() => true));
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);

    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: ADMIN });
    expect(off.outcomes.map((o) => o.status)).toEqual(steps.map(() => "booked"));
    expect(tableState(off.db, TABLES)).toEqual(expected);
    // not vacuous: the on-account service charged the client, the delete voided 11002
    expect(off.db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger WHERE client_id = 11001`).get()).toEqual({ n: 1 });
    expect(off.db.prepare(`SELECT status FROM custom_services WHERE id = 11002`).get()).toEqual({ status: "voided" });
    // the void reversed the seeded $6 CASH inflow (a negated leg, journal-style)
    expect(off.db.prepare(`SELECT SUM(amount) AS net FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = 11002) OR transaction_id IN (SELECT id FROM transactions WHERE reverses_id = 11001)`).get()).toEqual({ net: 0 });
    expect(off.db.prepare(`SELECT fulfillment_status, work_status FROM custom_services WHERE id = 11001`).get()).toEqual({
      fulfillment_status: "ISSUED",
      work_status: "In_Progress",
    });
    closeDb(off.db);
  });

  it("23:50 on day N, sent on day N+1 → every row on day N (no transaction_time)", async () => {
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql,
      steps,
      actorUserId: ADMIN,
      occurredAt: "2026-10-01T20:50:00.000Z", // 23:50 Beirut
      clientDay: "2026-10-01",
      clientTzOffsetMinutes: 180,
    });
    expect(off.outcomes.map((o) => o.status)).toEqual(steps.map(() => "booked"));
    expect({ t: "custom_services", days: daysOf(off.db, "custom_services", "created_at", "id NOT IN (11001, 11002, 11003)") }).toEqual({
      t: "custom_services",
      days: ["2026-10-01"],
    });
    for (const t of ["transactions", "payments", "debt_ledger"]) {
      // id 11001 = the seeded sale + its leg (2026-10-09); everything else — incl. the delete's reversal — is the event's
      expect({ t, days: daysOf(off.db, t, "created_at", "id <> 11001") }).toEqual({ t, days: ["2026-10-01"] });
    }
    closeDb(off.db);
  });

  it("converts LBP-priced service paid in USD at the PC's recorded rate", async () => {
    const rate = (sell: number) =>
      `UPDATE exchange_rates SET sell_rate = ${sell}, buy_rate = ${sell - 500}, market_rate = ${sell - 250} WHERE tenant_id = 1 AND to_code = 'LBP';`;
    const cross: Step[] = [
      {
        channel: "custom-services:add",
        payload: {
          description: "Visa form",
          cost_lbp: 300000,
          price_lbp: 900000,
          paid_by: "CASH",
          payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
        },
      },
    ];
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql: rate(90000), steps: cross, actorUserId: ADMIN });
    expect(on.results[0]).toMatchObject({ success: true });
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);
    // not vacuous: the same service at the server's new rate books differently
    const at95 = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql: rate(95000), steps: cross, actorUserId: ADMIN });
    expect(tableState(at95.db, TABLES)).not.toEqual(expected);
    closeDb(at95.db);

    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: rate(95000),
      steps: cross,
      actorUserId: ADMIN,
      rates: { LBP: { sell: 90000, buy: 89500, market: 89750, direction: 1 } },
    });
    expect(off.outcomes[0].status).toBe("booked");
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("update-metadata is credited to the event's actor, never a payload field", async () => {
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: seedSql + ACTOR_SQL.replace("__ID__", "11900"),
      steps,
      actorUserId: 11900,
    });
    expect(off.outcomes.map((o) => o.status)).toEqual(steps.map(() => "booked"));
    const row = off.db.prepare(`SELECT edited_by, note FROM custom_services WHERE id = 11001`).get();
    expect(row).toEqual({ edited_by: "second-admin", note: "edited offline" });
    closeDb(off.db);
  });
});
