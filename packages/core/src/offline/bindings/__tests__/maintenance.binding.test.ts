/**
 * LIRA-306 T092 — maintenance + warranty family: `maintenance:save`,
 * `maintenance:delete`, `maintenance:update-metadata`, `warranty:claim`,
 * `warranty:void-claim`. Replayed through the ReplayEngine they book exactly
 * what the services the REST routes call book online, per currency, on the
 * event's own day, at the PC's recorded rate, credited to the event's actor:
 *   POST   /api/maintenance/jobs             → saveJob(body, userId)
 *   DELETE /api/maintenance/jobs/:id         → deleteJob(id)
 *   POST   /api/maintenance/update-metadata  → updateMaintenanceMetadata(id, fields, username)
 *   POST   /api/warranty/claims              → createClaim(body, {userId, role})
 *   POST   /api/warranty/claims/:id/void     → voidClaim({claim_id}, {userId, role})
 *
 * Every run here acts as user 1 (admin): two channels are admin-only.
 */
import {
  saveMaintenanceJobSchema,
  maintenanceIdParamSchema,
  maintenanceUpdateMetadataSchema,
} from "../../../validators/maintenance";
import {
  createWarrantyClaimSchema,
  voidWarrantyClaimSchema,
} from "../../../validators/warranty";
import { recordedSchema } from "../../channelPolicy";
import {
  runOnline,
  runReplay,
  closeDb,
  tableState,
  daysOf,
  MONEY_TABLES,
  type Step,
} from "../../testHelpers/familyParity";
import {
  FIXTURES,
  MAINTENANCE_SEED_SQL,
} from "../../testHelpers/fixtures/maintenance";

const MOD = require.resolve("../maintenance");
const NAME = "MAINTENANCE_BINDINGS";
const ADMIN = 1;
const FAMILY_TABLES = [
  "maintenance",
  "maintenance_parts",
  "maintenance_status_history",
  "warranty_claims",
  "defective_items",
  "clients",
  "products",
  "product_stock_batches",
  "stock_batch_consumptions",
];
const TABLES = [...MONEY_TABLES, ...FAMILY_TABLES];
const seedSql = FIXTURES.map((f) => f.seedSql ?? "").join("\n");
const steps: Step[] = FIXTURES.map((f) => ({
  channel: f.channel,
  payload: f.payload,
}));

/** REPLACE a unit of the warranted sale line, then void that claim (10002 = next claim id after the seed). */
const replaceThenVoid: Step[] = [
  {
    channel: "warranty:claim",
    payload: {
      sale_item_id: 10001,
      action: "REPLACE",
      notes: "Dead on arrival",
      client_day: "2026-10-10",
    },
  },
  { channel: "warranty:void-claim", payload: { claim_id: 10002 } },
];

const rate = (sell: number) =>
  `UPDATE exchange_rates SET sell_rate = ${sell}, buy_rate = ${sell - 500}, market_rate = ${sell - 250} WHERE tenant_id = 1 AND to_code = 'LBP';`;

describe("maintenance + warranty bindings (T092)", () => {
  it("record with the routes' schema objects", () => {
    expect(recordedSchema("maintenance:save")).toBe(saveMaintenanceJobSchema);
    expect(recordedSchema("maintenance:delete")).toBe(maintenanceIdParamSchema);
    expect(recordedSchema("maintenance:update-metadata")).toBe(
      maintenanceUpdateMetadataSchema,
    );
    expect(recordedSchema("warranty:claim")).toBe(createWarrantyClaimSchema);
    expect(recordedSchema("warranty:void-claim")).toBe(voidWarrantyClaimSchema);
  });

  it("replay == online, per table and currency", async () => {
    const on = await runOnline({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql,
      steps,
      actorUserId: ADMIN,
    });
    expect(on.results.map((r) => [r.success, r.error])).toEqual(
      steps.map(() => [true, undefined]),
    );
    const expected = tableState(on.db, TABLES);
    // not vacuous: the checkout booked money in both currencies
    const legs = on.db
      .prepare(
        `SELECT currency_code, SUM(amount) AS a FROM payments GROUP BY currency_code ORDER BY currency_code`,
      )
      .all();
    expect(legs).toEqual([
      { currency_code: "LBP", a: 1080000 },
      { currency_code: "USD", a: 30 },
    ]);
    closeDb(on.db);

    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql,
      steps,
      actorUserId: ADMIN,
    });
    expect(off.outcomes.map((o) => [o.status, o.error ?? null])).toEqual(
      steps.map(() => ["booked", null]),
    );
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("REPLACE (stock out, defective held, warranty cost) then void: replay == online, and the void nets to zero", async () => {
    // server rate = the harness's recorded rate (market 89750): the cost row snapshots it
    const on = await runOnline({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: MAINTENANCE_SEED_SQL + rate(90000),
      steps: replaceThenVoid,
      actorUserId: ADMIN,
    });
    expect(on.results.map((r) => [r.success, r.error])).toEqual([
      [true, undefined],
      [true, undefined],
    ]);
    const expected = tableState(on.db, TABLES);
    expect(
      on.db
        .prepare(`SELECT stock_quantity FROM products WHERE id = 10001`)
        .get(),
    ).toEqual({ stock_quantity: 5 });
    expect(
      on.db
        .prepare(
          `SELECT ROUND(SUM(profit_usd), 2) AS p FROM transactions WHERE type = 'WARRANTY_COST' AND source_id = 10002`,
        )
        .get(),
    ).toEqual({ p: 0 });
    closeDb(on.db);

    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: MAINTENANCE_SEED_SQL + rate(90000),
      steps: replaceThenVoid,
      actorUserId: ADMIN,
    });
    expect(off.outcomes.map((o) => [o.status, o.error ?? null])).toEqual([
      ["booked", null],
      ["booked", null],
    ]);
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("23:50 on day N, sent on day N+1 → every row on day N (no transaction_time); repair warranty counted from day N", async () => {
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql,
      steps: [...steps, replaceThenVoid[0]], // REPLACE kept (its defective item stays HELD); claim 10001 voided by the fixtures
      actorUserId: ADMIN,
      occurredAt: "2026-10-01T20:50:00.000Z", // 23:50 Beirut
      clientDay: "2026-10-01",
      clientTzOffsetMinutes: 180,
    });
    expect(off.outcomes.map((o) => [o.status, o.error ?? null])).toEqual(
      [...steps, replaceThenVoid[0]].map(() => ["booked", null]),
    );
    const checks: Array<[string, string, string]> = [
      ["maintenance", "created_at", "id > 10005"],
      ["maintenance_status_history", "created_at", "1 = 1"],
      ["maintenance_parts", "created_at", "1 = 1"],
      ["clients", "created_at", "id > 10001"],
      ["warranty_claims", "created_at", "id > 10001"],
      ["warranty_claims", "voided_at", "1 = 1"],
      ["defective_items", "created_at", "1 = 1"],
      ["transactions", "created_at", "1 = 1"],
      ["payments", "created_at", "1 = 1"],
    ];
    for (const [t, col, where] of checks) {
      expect({ t, col, days: daysOf(off.db, t, col, where) }).toEqual({
        t,
        col,
        days: ["2026-10-01"],
      });
    }
    expect(
      off.db
        .prepare(`SELECT warranty_until FROM maintenance WHERE id = 10002`)
        .get(),
    ).toEqual({ warranty_until: "2027-01-01" });
    closeDb(off.db);
  });

  it("books the warranty cost at the PC's recorded rate although the server rate changed since", async () => {
    const replace = replaceThenVoid.slice(0, 1);
    const on = await runOnline({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: MAINTENANCE_SEED_SQL + rate(90000),
      steps: replace,
      actorUserId: ADMIN,
    });
    expect(on.results[0].success).toBe(true);
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);
    // not vacuous: the same claim at the server's new rate books differently
    const at95 = await runOnline({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: MAINTENANCE_SEED_SQL + rate(95000),
      steps: replace,
      actorUserId: ADMIN,
    });
    expect(tableState(at95.db, TABLES)).not.toEqual(expected);
    closeDb(at95.db);

    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: MAINTENANCE_SEED_SQL + rate(95000),
      steps: replace,
      actorUserId: ADMIN,
      rates: { LBP: { sell: 90000, buy: 89500, market: 89750, direction: 1 } },
    });
    expect(off.outcomes[0].status).toBe("booked");
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("credits the event's actor (username, user id, role) — never a payload field", async () => {
    const asStaff: Step[] = [
      {
        channel: "maintenance:update-metadata",
        payload: { id: 10001, note: "edited offline" },
      },
      {
        channel: "warranty:claim",
        payload: {
          maintenance_id: 10004,
          action: "REPAIR",
          client_day: "2026-10-10",
        },
      },
      // staff may not REPLACE: the role comes from the user record, not assumed
      replaceThenVoid[0],
    ];
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: MAINTENANCE_SEED_SQL,
      steps: asStaff,
      actorUserId: 2,
    });
    expect(off.outcomes.map((o) => o.status)).toEqual([
      "booked",
      "booked",
      "refused",
    ]);
    expect(off.outcomes[2].error).toMatch(
      /Only an admin can replace or refund/,
    );
    expect(
      off.db
        .prepare(`SELECT edited_by, note FROM maintenance WHERE id = 10001`)
        .get(),
    ).toEqual({ edited_by: "cashier", note: "edited offline" });
    expect(
      off.db
        .prepare(
          `SELECT user_id FROM warranty_claims WHERE maintenance_id = 10004`,
        )
        .get(),
    ).toEqual({ user_id: 2 });
    expect(
      off.db
        .prepare(
          `SELECT DISTINCT changed_by FROM maintenance_status_history h JOIN maintenance m ON m.id = h.maintenance_id WHERE m.warranty_claim_id IS NOT NULL AND m.id > 10005`,
        )
        .all(),
    ).toEqual([{ changed_by: 2 }]);
    closeDb(off.db);
  });
});
