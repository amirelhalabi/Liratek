/**
 * LIRA-306 T090 — exchange family: `exchange:add-transaction`,
 * `exchange:update-metadata`. Replayed through the ReplayEngine they book
 * exactly what the services the REST routes call book online
 * (POST /api/exchange/transactions → `addDirectTransaction(body)`;
 * POST /api/exchange/update-metadata → `updateExchangeMetadata(id, …, username)`),
 * per currency, on the event's own day, at the PC's recorded rate.
 */
import { exchangeSubmitSchema, updateExchangeMetadataSchema } from "../../../validators/exchange";
import { recordedSchema } from "../../channelPolicy";
import { runOnline, runReplay, closeDb, tableState, daysOf, MONEY_TABLES, type Step } from "../../testHelpers/familyParity";
import { FIXTURES } from "../../testHelpers/fixtures/exchange";

const MOD = require.resolve("../exchange");
const NAME = "EXCHANGE_BINDINGS";
const TABLES = [...MONEY_TABLES, "exchange_transactions", "exchange_lots", "exchange_lot_settlements"];
const seedSql = FIXTURES.map((f) => f.seedSql ?? "").join("\n");
const steps: Step[] = FIXTURES.map((f) => ({ channel: f.channel, payload: f.payload }));

describe("exchange bindings (T090)", () => {
  it("record with the routes' schema objects", () => {
    expect(recordedSchema("exchange:add-transaction")).toBe(exchangeSubmitSchema);
    expect(recordedSchema("exchange:update-metadata")).toBe(updateExchangeMetadataSchema);
  });

  it("replay == online, per table and currency", async () => {
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql, steps });
    expect(on.results.map((r) => r.success)).toEqual(steps.map(() => true));
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);

    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps });
    expect(off.outcomes.map((o) => o.status)).toEqual(steps.map(() => "booked"));
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("23:50 on day N, sent on day N+1 → every row on day N (no transaction_time)", async () => {
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql,
      steps,
      occurredAt: "2026-10-01T20:50:00.000Z", // 23:50 Beirut
      clientDay: "2026-10-01",
      clientTzOffsetMinutes: 180,
    });
    expect(off.outcomes.map((o) => o.status)).toEqual(steps.map(() => "booked"));
    for (const t of ["exchange_transactions", "exchange_lots", "exchange_lot_settlements", "transactions", "payments"]) {
      expect({ t, days: daysOf(off.db, t, "created_at", "id <> 9001") }).toEqual({ t, days: ["2026-10-01"] });
    }
    closeDb(off.db);
  });

  it("converts at the PC's recorded rate although the server rate changed since (kept LBP change → profit)", async () => {
    const rate = (sell: number) =>
      `UPDATE exchange_rates SET sell_rate = ${sell}, buy_rate = ${sell - 500}, market_rate = ${sell - 250} WHERE tenant_id = 1 AND to_code = 'LBP';`;
    const kept: Step[] = [
      {
        channel: "exchange:add-transaction",
        payload: {
          fromCurrency: "USD",
          toCurrency: "LBP",
          amountIn: 100,
          amountOut: 8950000,
          leg1Rate: 89500,
          leg1MarketRate: 89750,
          leg1ProfitUsd: 0.28,
          totalProfitUsd: 0.28,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 8900000 }],
          kept_change_lbp: 50000,
        },
      },
    ];
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql: rate(90000), steps: kept });
    expect(on.results[0].success).toBe(true);
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);
    // not vacuous: the same exchange at the server's new rate books differently
    const at95 = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql: rate(95000), steps: kept });
    expect(tableState(at95.db, TABLES)).not.toEqual(expected);
    closeDb(at95.db);

    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: rate(95000),
      steps: kept,
      rates: { LBP: { sell: 90000, buy: 89500, market: 89750, direction: 1 } },
    });
    expect(off.outcomes[0].status).toBe("booked");
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("update-metadata is credited to the event's actor, never a payload field", async () => {
    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: 2 });
    const row = off.db.prepare(`SELECT edited_by, note FROM exchange_transactions WHERE note = 'edited offline'`).get();
    expect(row).toEqual({ edited_by: "cashier", note: "edited offline" });
    closeDb(off.db);
  });
});
