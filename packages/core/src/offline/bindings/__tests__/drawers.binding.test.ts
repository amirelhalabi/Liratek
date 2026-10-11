/**
 * LIRA-306 T100 — drawers / hold-money family: `drawer-cashout:create`
 * (admin), `drawer-topup:create`, `drawer-topup:create-from-drawer`,
 * `drawer-topup:transfer`, `hold-money:create`, `hold-money:collect`,
 * `hold-money:void-pickup`. (`voucher:cancel` is online-only, O-impl-C-1.)
 * Replayed through the ReplayEngine they book exactly what the services the
 * REST routes call book online (backend/src/api/drawerCashout.ts,
 * drawerTopUp.ts, holdMoney.ts), per currency, on the event's own day, at the
 * PC's recorded rates (hold-money's stamped LBP rate, the EUR lot's cost).
 */
import { createDrawerCashoutSchema } from "../../../validators/drawerCashout";
import { drawerTopUpCreateSchema, drawerTopUpFromDrawerSchema } from "../../../validators/drawerTopUp";
import { createDrawerTransferSchema } from "../../../validators/drawerTransfer";
import { holdMoneyCreateSchema, holdMoneyCollectSchema, holdMoneyVoidPickupSchema } from "../../../validators/holdMoney";
import { recordedSchema } from "../../channelPolicy";
import { runOnline, runReplay, closeDb, tableState, daysOf, MONEY_TABLES, type Step } from "../../testHelpers/familyParity";
import { FIXTURES } from "../../testHelpers/fixtures/drawers";

const MOD = require.resolve("../drawers");
const NAME = "DRAWERS_BINDINGS";
const TABLES = [
  ...MONEY_TABLES,
  "drawer_topups",
  "drawer_transfers",
  "drawer_cashouts",
  "hold_money",
  "hold_money_pickups",
  "exchange_lots",
  "custom_services",
];
const steps: Step[] = FIXTURES.map((f) => ({ channel: f.channel, payload: f.payload }));
const ADMIN = 1; // drawer-cashout:create is admin-only

const lbpRate = (sell: number) =>
  `UPDATE exchange_rates SET sell_rate = ${sell}, buy_rate = ${sell - 500}, market_rate = ${sell - 250} WHERE tenant_id = 1 AND to_code = 'LBP';`;
const eurRate = (market: number) => `UPDATE exchange_rates SET market_rate = ${market} WHERE tenant_id = 1 AND to_code = 'EUR';`;
const LBP_90 = { sell: 90000, buy: 89500, market: 89750, direction: 1 };
// the harness records LBP_90; align the server row so createTransaction's
// market-rate snapshot is the same online and replayed
const seedSql = [lbpRate(90000), ...FIXTURES.map((f) => f.seedSql ?? "")].join("\n");

describe("drawers / hold-money bindings (T100)", () => {
  it("record with the routes' schema objects", () => {
    expect(recordedSchema("drawer-cashout:create")).toBe(createDrawerCashoutSchema);
    expect(recordedSchema("drawer-topup:create")).toBe(drawerTopUpCreateSchema);
    expect(recordedSchema("drawer-topup:create-from-drawer")).toBe(drawerTopUpFromDrawerSchema);
    expect(recordedSchema("drawer-topup:transfer")).toBe(createDrawerTransferSchema);
    expect(recordedSchema("hold-money:create")).toBe(holdMoneyCreateSchema);
    expect(recordedSchema("hold-money:collect")).toBe(holdMoneyCollectSchema);
    expect(recordedSchema("hold-money:void-pickup")).toBe(holdMoneyVoidPickupSchema);
  });

  it("replay == online, per table and currency", async () => {
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: ADMIN });
    expect(on.results.map((r) => [r.success, r.error])).toEqual(steps.map(() => [true, undefined]));
    const expected = tableState(on.db, TABLES);
    // not vacuous: an EUR lot, a reversed pickup, a hold history row
    expect(expected.exchange_lots).toHaveLength(1);
    expect(expected.hold_money_pickups).toEqual(expect.arrayContaining([expect.objectContaining({ is_voided: 1 })]));
    expect(expected.custom_services).toHaveLength(1);
    closeDb(on.db);

    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: ADMIN });
    expect(off.outcomes.map((o) => [o.status, o.error ?? null])).toEqual(steps.map(() => ["booked", null]));
    expect(tableState(off.db, TABLES)).toEqual(expected);
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
    const checks: Array<[string, string, string]> = [
      ["drawer_topups", "created_at", "1 = 1"],
      ["drawer_transfers", "created_at", "1 = 1"],
      ["drawer_cashouts", "created_at", "1 = 1"],
      ["hold_money", "created_at", "id NOT IN (14001, 14002)"],
      ["hold_money", "collected_at", "1 = 1"],
      ["hold_money_pickups", "created_at", "id <> 14001"],
      ["hold_money_pickups", "voided_at", "1 = 1"],
      ["custom_services", "created_at", "1 = 1"],
      ["exchange_lots", "created_at", "1 = 1"],
      ["exchange_lots", "acquired_at", "1 = 1"],
      ["transactions", "created_at", "id <> 14001"],
      ["payments", "created_at", "id <> 14001"],
    ];
    for (const [t, col, where] of checks) {
      expect({ t, col, days: daysOf(off.db, t, col, where) }).toEqual({ t, col, days: ["2026-10-01"] });
    }
    closeDb(off.db);
  });

  it("hold money stamps the PC's recorded LBP rate although the server rate changed since", async () => {
    const hold: Step[] = [{ channel: "hold-money:create", payload: { client_name: "Rate hold", usd_amount: 40, lbp_amount: 0 } }];
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql: lbpRate(90000), steps: hold });
    expect(on.results[0].success).toBe(true);
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);
    // not vacuous: the same hold at the server's new rate books differently
    const at95 = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql: lbpRate(95000), steps: hold });
    expect(tableState(at95.db, TABLES)).not.toEqual(expected);
    closeDb(at95.db);

    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: lbpRate(95000),
      steps: hold,
      rates: { LBP: LBP_90 },
    });
    expect(off.outcomes[0].status).toBe("booked");
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("an EUR top-up's lot is costed at the PC's recorded EUR rate", async () => {
    const eur: Step[] = [{ channel: "drawer-topup:create", payload: { amount_usd: 0, amount_lbp: 0, extra_currencies: [{ currency_code: "EUR", amount: 100 }] } }];
    const at = (m: number) => lbpRate(90000) + eurRate(m);
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql: at(1.18), steps: eur });
    expect(on.results[0].success).toBe(true);
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);
    const at125 = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql: at(1.25), steps: eur });
    expect(tableState(at125.db, TABLES)).not.toEqual(expected);
    closeDb(at125.db);

    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: at(1.25),
      steps: eur,
      rates: { LBP: LBP_90, EUR: { sell: 1.2, buy: 1.16, market: 1.18, direction: -1 } },
    });
    expect(off.outcomes[0].status).toBe("booked");
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("every row is credited to the event's actor; a staff cash-out is refused (admin-only)", async () => {
    const staffSteps = steps.filter((s) => s.channel !== "drawer-cashout:create");
    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps: staffSteps, actorUserId: 2 });
    expect(off.outcomes.map((o) => o.status)).toEqual(staffSteps.map(() => "booked"));
    const one = (sql: string) => off.db.prepare(sql).all();
    expect(one(`SELECT DISTINCT created_by FROM drawer_topups`)).toEqual([{ created_by: 2 }]);
    expect(one(`SELECT DISTINCT created_by FROM drawer_transfers`)).toEqual([{ created_by: 2 }]);
    expect(one(`SELECT created_by FROM hold_money WHERE id NOT IN (14001, 14002)`)).toEqual([{ created_by: 2 }]);
    expect(one(`SELECT collected_by FROM hold_money WHERE id = 14001`)).toEqual([{ collected_by: 2 }]);
    expect(one(`SELECT voided_by FROM hold_money_pickups WHERE id = 14001`)).toEqual([{ voided_by: 2 }]);
    expect(one(`SELECT DISTINCT user_id FROM transactions WHERE id <> 14001`)).toEqual([{ user_id: 2 }]);
    closeDb(off.db);

    const cash = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql,
      steps: [steps[0], { channel: "drawer-cashout:create", payload: { amount_usd: 50, amount_lbp: 0, notes: "owner withdrawal" } }],
      actorUserId: 2,
    });
    expect(cash.outcomes.map((o) => o.status)).toEqual(["booked", "refused"]);
    expect(cash.db.prepare(`SELECT COUNT(*) AS n FROM drawer_cashouts`).get()).toEqual({ n: 0 });
    closeDb(cash.db);
  });
});
