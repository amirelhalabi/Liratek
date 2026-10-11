/**
 * LIRA-306 T102 — checkpoints family (FR-032, N8, O-new-27):
 * `closing:create-checkpoint`, `closing:update-daily-closing`,
 * `loto:checkpoint:create`, `loto:checkpoint:update`, `loto:checkpoint:delete`,
 * `loto:checkpoint:create-scheduled`, `carrier-lines:update-balance`.
 *
 * Replay NEVER books them by itself (held_checkpoint); when an admin presses
 * Apply they book exactly what the REST route's service call books online, at
 * the event's own time. A drawer count is reconciled against the drawer AS OF
 * the event's time — the server recomputes the expected amount there (the PC
 * could not see web or other PCs' sales) and the result carries both figures.
 * No channel here converts with the shop rate → no recorded-rate test.
 */
import type Database from "better-sqlite3";
import { createCheckpointSchema, updateDailyClosingIpcSchema } from "../../../validators/closing";
import { lotoCheckpointCreateSchema, lotoCheckpointUpdateSchema } from "../../../validators/loto";
import * as lotoValidators from "../../../validators/loto";
import { carrierLineUpdateBalanceSchema } from "../../../validators/carrierLine";
import { recordedSchema, PENDING_LIFT, objectShapeOf } from "../../channelPolicy";
import { runOnline, runReplay, closeDb, tableState, daysOf, MONEY_TABLES, type Step } from "../../testHelpers/familyParity";
import { FIXTURES } from "../../testHelpers/fixtures/checkpoints";

const MOD = require.resolve("../checkpoints");
const NAME = "CHECKPOINT_BINDINGS";
const ADMIN = 1;
const OWN_TABLES = [
  "daily_closings",
  "daily_closing_amounts",
  "daily_closing_carrier_lines",
  "loto_checkpoints",
  "carrier_lines",
  "carrier_line_movements",
];
const TABLES = [...MONEY_TABLES, ...OWN_TABLES];
// the server's rate row = the rate the harness records with each event, so the
// transactions.exchange_rate snapshot agrees online and replayed (O-new-24)
const RATE_SQL = `UPDATE exchange_rates SET market_rate = 89750, buy_rate = 89500, sell_rate = 90000 WHERE tenant_id = 1 AND to_code = 'LBP';`;
const seedSql = [RATE_SQL, ...FIXTURES.map((f) => f.seedSql ?? "")].join("\n");
const steps: Step[] = FIXTURES.map((f) => ({ channel: f.channel, payload: f.payload }));
const LIFTED = ["closing:create-checkpoint", "loto:checkpoint:delete", "loto:checkpoint:create-scheduled"];

function resultOf(db: Database.Database, channel: string): Record<string, unknown> {
  const row = db.prepare(`SELECT result_json FROM offline_events WHERE channel = ? ORDER BY id DESC LIMIT 1`).get(channel) as
    | { result_json: string | null }
    | undefined;
  // the engine stores { result: <binding envelope>, serverIds }
  return row?.result_json ? ((JSON.parse(row.result_json) as { result: Record<string, unknown> }).result ?? {}) : {};
}

function balance(db: Database.Database, drawer: string, currency = "USD"): number {
  const r = db.prepare(`SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = ? AND currency_code = ?`).get(drawer, currency) as
    | { balance: number }
    | undefined;
  return r?.balance ?? 0;
}

describe("checkpoints bindings (T102)", () => {
  it("record with the routes' schema objects; the three lifts left PENDING_LIFT", () => {
    expect(recordedSchema("closing:create-checkpoint")).toBe(createCheckpointSchema);
    expect(recordedSchema("closing:update-daily-closing")).toBe(updateDailyClosingIpcSchema);
    expect(recordedSchema("loto:checkpoint:create")).toBe(lotoCheckpointCreateSchema);
    expect(recordedSchema("carrier-lines:update-balance")).toBe(carrierLineUpdateBalanceSchema);
    const v = lotoValidators as unknown as Record<string, unknown>;
    expect(recordedSchema("loto:checkpoint:delete")).toBe(v.lotoCheckpointDeleteSchema);
    expect(recordedSchema("loto:checkpoint:create-scheduled")).toBe(v.lotoCheckpointCreateScheduledSchema);
    // positional id + spread body: the route's body schema, extended with the id envelope key
    const core = objectShapeOf(lotoCheckpointUpdateSchema)!;
    const rec = objectShapeOf(recordedSchema("loto:checkpoint:update")!)!;
    for (const k of Object.keys(core)) expect({ k, same: rec[k] === core[k] }).toEqual({ k, same: true });
    expect(Object.keys(rec).sort()).toEqual([...Object.keys(core), "id"].sort());
    expect(LIFTED.filter((c) => PENDING_LIFT.includes(c))).toEqual([]);
  });

  it("auto replay holds every checkpoint (held_checkpoint) and books nothing (N8)", async () => {
    const base = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql, steps: [] });
    const before = tableState(base.db, TABLES);
    closeDb(base.db);

    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: ADMIN });
    expect(off.outcomes.map((o) => o.status)).toEqual(steps.map(() => "held"));
    const kinds = off.db.prepare(`SELECT kind, state FROM offline_review_items ORDER BY id`).all();
    expect(kinds).toEqual(steps.map(() => ({ kind: "held_checkpoint", state: "open" })));
    expect(tableState(off.db, TABLES)).toEqual(before);
    closeDb(off.db);
  });

  it("Apply == online, per table and currency", async () => {
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: ADMIN });
    expect(on.results.map((r) => [r.success, r.error ?? null])).toEqual(steps.map(() => [true, null]));
    const expected = tableState(on.db, TABLES);
    closeDb(on.db);

    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: ADMIN, apply: true });
    expect(off.outcomes.map((o) => [o.status, o.error ?? null])).toEqual(steps.map(() => ["applied", null]));
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("23:50 on day N, applied later → every row on day N (no transaction_time; closing day from the event)", async () => {
    const dayN: Step[] = steps.map((s) => {
      if (s.channel !== "closing:create-checkpoint") return s;
      const { closing_date: _omit, ...rest } = s.payload;
      void _omit;
      // also count the SIM line, so the per-line snapshot row is stamped too
      return { channel: s.channel, payload: { ...rest, carrier_lines: [{ carrier_line_id: 15001, counted_credits: 55 }] } };
    });
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql,
      steps: dayN,
      actorUserId: ADMIN,
      apply: true,
      occurredAt: "2026-10-01T20:50:00.000Z", // 23:50 Beirut
      clientDay: "2026-10-01",
      clientTzOffsetMinutes: 180,
    });
    expect(off.outcomes.map((o) => o.status)).toEqual(dayN.map(() => "applied"));
    for (const t of ["daily_closings", "daily_closing_carrier_lines", "loto_checkpoints", "transactions", "payments", "carrier_line_movements"]) {
      expect({ t, days: daysOf(off.db, t, "created_at", "created_at NOT LIKE '2026-09-%'") }).toEqual({ t, days: ["2026-10-01"] });
    }
    expect(daysOf(off.db, "daily_closings", "closing_date", "id <> 15001")).toEqual(["2026-10-01"]);
    closeDb(off.db);
  });

  it("O-new-27: Apply reconciles against the drawer AS OF the event; result carries the PC's and the server's expected", async () => {
    const seed = `
      INSERT INTO payments (id, tenant_id, method, drawer_name, currency_code, amount, note, created_by, created_at) VALUES
        (15101, 1, 'CASH', 'Safe', 'USD', 100, 'known to the PC copy', 1, '2026-09-01 09:00:00'),
        (15102, 1, 'CASH', 'Safe', 'USD', 20, 'web sale after the PC copy, before the count', 1, '2026-10-01 18:00:00'),
        (15103, 1, 'CASH', 'Safe', 'USD', 7, 'web sale after the count, before Apply', 1, '2026-10-02 09:00:00');
      INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Safe', 'USD', 127);`;
    const count: Step[] = [
      {
        channel: "closing:create-checkpoint",
        payload: {
          drawer_name: "Safe",
          closing_date: "2026-10-01",
          amounts: [{ drawer_name: "Safe", currency_code: "USD", expected_amount: 100, physical_amount: 118 }],
        },
      },
    ];
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: seed,
      steps: count,
      actorUserId: ADMIN,
      apply: true,
      occurredAt: "2026-10-01T20:50:00.000Z",
      clientDay: "2026-10-01",
    });
    expect(off.outcomes[0].status).toBe("applied");
    // drawer at 20:50 was 120 (100 + the 18:00 web sale); counted 118 → −2; the 09:00 next-day sale survives
    expect(balance(off.db, "Safe")).toBe(125);
    const adj = off.db.prepare(`SELECT amount, created_at FROM payments WHERE drawer_name = 'Safe' AND id > 15103`).all();
    expect(adj).toEqual([{ amount: -2, created_at: "2026-10-01 20:50:00" }]);
    const snap = off.db.prepare(`SELECT opening_amount, physical_amount FROM daily_closing_amounts WHERE drawer_name = 'Safe'`).all();
    expect(snap).toEqual([{ opening_amount: 120, physical_amount: 118 }]);
    expect(resultOf(off.db, "closing:create-checkpoint").expected).toEqual([
      { drawer_name: "Safe", currency_code: "USD", pc_expected: 100, server_expected: 120, physical: 118 },
    ]);
    closeDb(off.db);
  });

  it("online, the result's server figure is the live balance (same envelope shape the review screen reads)", async () => {
    const on = await runOnline({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Safe', 'USD', 40);`,
      steps: [
        {
          channel: "closing:create-checkpoint",
          payload: { drawer_name: "Safe", amounts: [{ drawer_name: "Safe", currency_code: "USD", expected_amount: 35, physical_amount: 40 }] },
        },
      ],
      actorUserId: ADMIN,
    });
    expect(on.results[0].expected).toEqual([{ drawer_name: "Safe", currency_code: "USD", pc_expected: 35, server_expected: 40, physical: 40 }]);
    expect(balance(on.db, "Safe")).toBe(40);
    closeDb(on.db);
  });

  it("every write is credited to the event's actor, never a payload field", async () => {
    const withUser: Step[] = steps.map((s) =>
      s.channel === "closing:create-checkpoint" ? { channel: s.channel, payload: { ...s.payload, user_id: 2 } } : s,
    );
    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps: withUser, actorUserId: ADMIN, apply: true });
    expect(off.outcomes.map((o) => o.status)).toEqual(withUser.map(() => "applied"));
    expect(off.db.prepare(`SELECT DISTINCT created_by FROM daily_closings WHERE id <> 15001`).all()).toEqual([{ created_by: ADMIN }]);
    expect(off.db.prepare(`SELECT updated_by FROM daily_closings WHERE id = 15001`).get()).toEqual({ updated_by: ADMIN });
    expect(off.db.prepare(`SELECT DISTINCT user_id FROM transactions`).all()).toEqual([{ user_id: ADMIN }]);
    closeDb(off.db);
  });

  it("PIN (not failing-first) — a scheduled loto checkpoint replayed after the web already made one for that day is booked again, empty", async () => {
    const seed = `INSERT INTO loto_checkpoints (id, tenant_id, checkpoint_date, period_start, period_end, note, created_at, updated_at)
      VALUES (15201, 1, '2026-10-10', '2026-10-01', '2026-10-10', 'made on the web', '2026-10-10 21:00:00', '2026-10-10 21:00:00');`;
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: seed,
      steps: [{ channel: "loto:checkpoint:create-scheduled", payload: { checkpointDate: "2026-10-10" } }],
      actorUserId: ADMIN,
      apply: true,
    });
    expect(off.outcomes[0].status).toBe("applied");
    const rows = off.db.prepare(`SELECT checkpoint_date, period_start, period_end, total_tickets FROM loto_checkpoints ORDER BY id`).all();
    expect(rows).toEqual([
      { checkpoint_date: "2026-10-10", period_start: "2026-10-01", period_end: "2026-10-10", total_tickets: 0 },
      { checkpoint_date: "2026-10-10", period_start: "2026-10-11", period_end: "2026-10-10", total_tickets: 0 },
    ]);
    closeDb(off.db);
  });

  it("PIN (not failing-first) — a line balance reading applied after later usage overwrites the line with the old reading", async () => {
    const seed = `INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number, credits, is_active, is_primary, created_at, updated_at)
        VALUES (15301, 1, 'alfa', '71150301', 80, 1, 0, '2026-09-01 08:00:00', '2026-09-01 08:00:00');
      INSERT INTO carrier_line_movements (id, tenant_id, carrier_line_id, credits_delta, reason, created_at, updated_at)
        VALUES (15301, 1, 15301, -20, 'usage after the reading', '2026-10-02 09:00:00', '2026-10-02 09:00:00');`;
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql: seed,
      steps: [{ channel: "carrier-lines:update-balance", payload: { id: 15301, credits: 100 } }],
      actorUserId: ADMIN,
      apply: true,
      occurredAt: "2026-10-01T20:50:00.000Z",
      clientDay: "2026-10-01",
    });
    expect(off.outcomes[0].status).toBe("applied");
    // the 20 credits used after the reading are put back (today's absolute overwrite — reported, not fixed)
    expect(off.db.prepare(`SELECT credits FROM carrier_lines WHERE id = 15301`).get()).toEqual({ credits: 100 });
    closeDb(off.db);
  });
});
