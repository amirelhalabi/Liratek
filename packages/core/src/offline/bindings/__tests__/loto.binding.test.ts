/**
 * LIRA-306 T096 — loto family: `loto:sell`, `loto:update`,
 * `loto:cash-prize:create`, `loto:update-metadata`. Replayed through the
 * ReplayEngine they book exactly what the services the REST routes
 * (backend/src/api/loto.ts) call book online, per currency, on the event's
 * own day, at the PC's recorded rate, credited to the event's actor.
 *
 * `loto:update-metadata` has NO monthly-fee side effect on either transport:
 * `checkAndRecordMonthlyFee` runs only at desktop start-up (main.ts →
 * checkLotoMonthlyFee). `loto_monthly_fees` is in TABLES so parity pins
 * "no fee row on either side".
 */
import {
  lotoSellSchema,
  lotoTicketUpdateSchema,
  lotoCashPrizeSchema,
  lotoUpdateMetadataSchema,
} from "../../../validators/loto";
import { recordedSchema, objectShapeOf } from "../../channelPolicy";
import { runOnline, runReplay, closeDb, tableState, daysOf, MONEY_TABLES, type Step } from "../../testHelpers/familyParity";
import { FIXTURES } from "../../testHelpers/fixtures/loto";

const MOD = require.resolve("../loto");
const NAME = "LOTO_BINDINGS";
const TABLES = [...MONEY_TABLES, "loto_tickets", "loto_cash_prizes", "loto_monthly_fees", "suppliers"];
/** most channels here are admin-only (the engine re-checks roles); user 1 is the seeded admin */
const ADMIN = 1;
/** a second admin, to prove the actor comes from the event */
const ACTOR_SQL = `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (__ID__, 1, 'second-admin', '', 'admin', 1);`;
const seedSql = FIXTURES.map((f) => f.seedSql ?? "").join("\n");
const steps: Step[] = FIXTURES.map((f) => ({ channel: f.channel, payload: f.payload }));

describe("loto bindings (T096)", () => {
  it("record with the routes' schema objects", () => {
    expect(recordedSchema("loto:sell")).toBe(lotoSellSchema);
    expect(recordedSchema("loto:cash-prize:create")).toBe(lotoCashPrizeSchema);
    expect(recordedSchema("loto:update-metadata")).toBe(lotoUpdateMetadataSchema);
    // positional id + spread body: the route's body schema in an { id } envelope
    const shape = objectShapeOf(recordedSchema("loto:update")!)!;
    expect(Object.keys(shape).sort()).toEqual([...Object.keys(lotoTicketUpdateSchema.shape), "id"].sort());
    for (const k of Object.keys(lotoTicketUpdateSchema.shape)) {
      expect(shape[k]).toBe((lotoTicketUpdateSchema.shape as Record<string, unknown>)[k]);
    }
    expect(recordedSchema("loto:update")!.parse({ id: 12001, note: "n" })).toEqual({ id: 12001, note: "n" });
  });

  it("replay == online, per table and currency", async () => {
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: ADMIN });
    expect(on.results.map((r) => r.success)).toEqual(steps.map(() => true));
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);

    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: ADMIN });
    expect(off.outcomes.map((o) => o.status)).toEqual(steps.map(() => "booked"));
    expect(tableState(off.db, TABLES)).toEqual(expected);
    // not vacuous
    expect(off.db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger WHERE client_id = 12001`).get()).toEqual({ n: 1 });
    expect(off.db.prepare(`SELECT ticket_number, note FROM loto_tickets WHERE id = 12001`).get()).toEqual({
      ticket_number: "T-1B",
      note: "edited offline",
    });
    expect(off.db.prepare(`SELECT COUNT(*) AS n FROM loto_cash_prizes`).get()).toEqual({ n: 1 });
    expect(off.db.prepare(`SELECT COUNT(*) AS n FROM loto_monthly_fees`).get()).toEqual({ n: 0 });
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
    expect(daysOf(off.db, "loto_tickets", "created_at", "id <> 12001")).toEqual(["2026-10-01"]);
    expect(daysOf(off.db, "loto_tickets", "sale_date", "id <> 12001")).toEqual(["2026-10-01"]);
    expect(daysOf(off.db, "loto_cash_prizes", "created_at")).toEqual(["2026-10-01"]);
    expect(daysOf(off.db, "loto_cash_prizes", "prize_date")).toEqual(["2026-10-01"]);
    for (const t of ["transactions", "payments", "debt_ledger", "supplier_ledger"]) {
      expect({ t, days: daysOf(off.db, t) }).toEqual({ t, days: ["2026-10-01"] });
    }
    closeDb(off.db);
  });

  it("converts an LBP ticket paid in USD at the PC's recorded rate", async () => {
    const rate = (sell: number) =>
      `UPDATE exchange_rates SET sell_rate = ${sell}, buy_rate = ${sell - 500}, market_rate = ${sell - 250} WHERE tenant_id = 1 AND to_code = 'LBP';`;
    const cross: Step[] = [
      {
        channel: "loto:sell",
        payload: { sale_amount: 900000, currency: "LBP", payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }] },
      },
    ];
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql: rate(90000), steps: cross, actorUserId: ADMIN });
    expect(on.results[0]).toMatchObject({ success: true });
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);
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

  it("sale, prize and note are credited to the event's actor, never a payload field", async () => {
    const withForged: Step[] = steps.map((s) => ({ ...s, payload: { ...s.payload, userId: 1 } }));
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: seedSql + ACTOR_SQL.replace("__ID__", "12900"),
      steps: withForged,
      actorUserId: 12900,
    });
    expect(off.outcomes.map((o) => o.status)).toEqual(steps.map(() => "booked"));
    const users = off.db
      .prepare(`SELECT DISTINCT user_id FROM transactions WHERE source_table IN ('loto_tickets', 'loto_cash_prizes')`)
      .all();
    expect(users).toEqual([{ user_id: 12900 }]);
    expect(off.db.prepare(`SELECT edited_by FROM loto_tickets WHERE id = 12001`).get()).toEqual({ edited_by: "second-admin" });
    closeDb(off.db);
  });
});
