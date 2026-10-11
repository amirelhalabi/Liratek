/**
 * LIRA-306 T084 — recharge + carrier lines family: `recharge:process`,
 * `recharge:top-up-from-client`, `recharge:update-metadata`,
 * `carrier-lines:record-usage`, `carrier-lines:mark-owed-delivery-sent`.
 * Replayed through the ReplayEngine each books what the REST route's service
 * call books online (drawers, payment lines, transactions, line credits,
 * movements, expenses per currency — SC-001), at the event's own time
 * (FR-021, 23:50 day N replayed later), validated by the route's schema.
 * No channel here needed a lift (all were core schemas already).
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../../db/tenantContext";
import {
  createRechargeSchema,
  topUpFromClientSchema,
  updateRechargeMetadataSchema,
} from "../../../validators/recharge";
import { recordCarrierLineUsageSchema, markCarrierLineOwedDeliverySentSchema } from "../../../validators/carrierLine";
import { recordedSchema } from "../../channelPolicy";
import { getRechargeService, resetRechargeService } from "../../../services/RechargeService";
import { getCarrierLineService, resetCarrierLineService } from "../../../services/CarrierLineService";
import { resetRechargeRepository } from "../../../repositories/RechargeRepository";
import { resetCarrierLineRepository } from "../../../repositories/CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../../../repositories/CarrierLineMovementRepository";
import { resetCarrierLineOwedDeliveryRepository } from "../../../repositories/CarrierLineOwedDeliveryRepository";
import { resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { resetExpenseRepository } from "../../../repositories/ExpenseRepository";
import { RECHARGE_BINDINGS } from "../recharge";
import { bindingLookup, runParity, tableState, createdValues, EVENT_DAY, type ParityCase } from "../../testHelpers/familyHarness";

const bindings = bindingLookup(RECHARGE_BINDINGS);

function reset(): void {
  resetRechargeService();
  resetCarrierLineService();
  resetRechargeRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineOwedDeliveryRepository();
  resetTransactionRepository();
  resetExpenseRepository();
}

const SEED_RECHARGE = {
  provider: "MTC",
  type: "CREDIT_TRANSFER",
  amount: 5,
  cost: 4.5,
  price: 6,
  currency: "USD",
  phoneNumber: "03999001",
  payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
  client_day: "2026-10-09",
};

function seed(db: Database.Database): void {
  db.exec(`
    UPDATE exchange_rates SET market_rate = 89750, buy_rate = 89500, sell_rate = 90000 WHERE tenant_id = 1 AND to_code = 'LBP';
    INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES
      (1, 'MTC', 'USD', 500), (1, 'Alfa', 'USD', 500), (1, 'General', 'USD', 5000),
      (1, 'General', 'LBP', 500000000), (1, 'Whish_App', 'USD', 1000);
    INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number, label, credits, validity_expires_at, is_active, is_primary)
      VALUES (1, 1, 'mtc', '03123456', 'Shop MTC', 500, '2099-01-01', 1, 1),
             (2, 1, 'alfa', '71123456', 'Shop Alfa', 500, '2099-01-01', 1, 1);
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami', '70123456');
    INSERT INTO carrier_line_owed_deliveries (id, tenant_id, carrier_line_id, client_id, client_name, days_owed, status)
      VALUES (1, 1, 1, 7, 'Rami', 30, 'PENDING');
  `);
  runWithTenant(1, () => {
    const r = getRechargeService().processRecharge({ ...createRechargeSchema.parse(SEED_RECHARGE), userId: 1 } as never);
    if (!r.success) throw new Error(r.error);
  });
}

const TABLES = ["recharges", "carrier_lines", "carrier_line_movements", "carrier_line_owed_deliveries", "expenses", "debt_ledger"];
/** `expense_date` (auto SMS-fee / Line_Usage expenses) and `due_date` derive
 *  from "now" — compared on the replay side against the event's day instead. */
const state = (db: Database.Database) => tableState(db, TABLES, ["expense_date", "due_date"]);

/** Business dates the booking derived from "now": all on the event's day. */
const replayDays = (db: Database.Database, outcome: Parameters<typeof createdValues>[1]) => ({
  expense_date: createdValues(db, outcome, "expenses", "expense_date").map((v) => String(v).slice(0, 10)),
  due_date: createdValues(db, outcome, "debt_ledger", "due_date").map((v) => String(v).slice(0, 10)),
});

function c(over: Partial<ParityCase> & Pick<ParityCase, "channel" | "payload" | "online">): ParityCase {
  return { seed, reset, bindings, state, replayCheck: replayDays, ...over };
}

const recharge = (p: Record<string, unknown>) =>
  c({
    channel: "recharge:process",
    payload: p,
    online: () => getRechargeService().processRecharge({ ...createRechargeSchema.parse(p), userId: 1 } as never),
  });

const CASES: Array<[string, ParityCase]> = [
  [
    "recharge:process walk-in MTC credit transfer, USD cash",
    recharge({ ...SEED_RECHARGE, amount: 3, cost: 2.7, price: 4, payments: [{ method: "CASH", currencyCode: "USD", amount: 4 }], client_day: "2026-10-10" }),
  ],
  [
    "recharge:process Alfa voucher, LBP cash",
    recharge({
      provider: "Alfa",
      type: "VOUCHER",
      amount: 10,
      cost: 810000,
      price: 990000,
      currency: "LBP",
      phoneNumber: "71999001",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 990000 }],
      client_day: "2026-10-10",
    }),
  ],
  [
    "recharge:process on the customer's account",
    recharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 2,
      cost: 1.8,
      price: 2.5,
      currency: "USD",
      phoneNumber: "03999002",
      clientId: 7,
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 2.5 }],
      client_day: "2026-10-10",
    }),
  ],
  [
    "recharge:top-up-from-client",
    (() => {
      const p = { amount: 100, fee: 5, currency: "USD", payments: [{ method: "CASH", currencyCode: "USD", amount: 95 }], clientId: 7, clientName: "Rami" };
      return c({
        channel: "recharge:top-up-from-client",
        payload: p,
        online: () => getRechargeService().topUpFromClient({ ...topUpFromClientSchema.parse(p), userId: 1 }),
      });
    })(),
  ],
  [
    "carrier-lines:record-usage",
    (() => {
      const p = { carrierLineId: 1, newCredits: 480, note: "shop calls" };
      return c({
        channel: "carrier-lines:record-usage",
        payload: p,
        online: () => getCarrierLineService().recordUsage(recordCarrierLineUsageSchema.parse(p), 1),
      });
    })(),
  ],
  [
    "carrier-lines:mark-owed-delivery-sent",
    c({
      channel: "carrier-lines:mark-owed-delivery-sent",
      payload: { deliveryId: 1 },
      online: () => getCarrierLineService().markOwedDeliverySent(1, 1),
    }),
  ],
];

describe("recharge + carrier lines bindings (T084)", () => {
  it("each channel validates with its REST route's schema object", () => {
    expect(recordedSchema("recharge:process")).toBe(createRechargeSchema);
    expect(recordedSchema("recharge:top-up-from-client")).toBe(topUpFromClientSchema);
    expect(recordedSchema("recharge:update-metadata")).toBe(updateRechargeMetadataSchema);
    expect(recordedSchema("carrier-lines:record-usage")).toBe(recordCarrierLineUsageSchema);
    expect(recordedSchema("carrier-lines:mark-owed-delivery-sent")).toBe(markCarrierLineOwedDeliverySentSchema);
  });

  it.each(CASES)("%s — replay equals online, every row at the event's time", async (_n, pc) => {
    const run = await runParity(pc);
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome).toMatchObject({ status: "booked" });
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
    const days = run.replay.check as { expense_date: string[]; due_date: string[] };
    for (const d of days.expense_date) expect(d).toBe(EVENT_DAY);
    for (const d of days.due_date) expect(d).toBe("2026-11-09"); // event day + 30, not today + 30
  });

  it("recharge:update-metadata — editedBy is the event actor, booked like online", async () => {
    const p = { id: 1, note: "wrong number", phone_number: "03999009" };
    const run = await runParity(
      c({
        channel: "recharge:update-metadata",
        payload: p,
        actorUserId: 2,
        online: () => getRechargeService().updateRechargeMetadata(1, { phone_number: "03999009", note: "wrong number" }, "cashier"),
      }),
    );
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(JSON.stringify(run.replay.state)).toContain('"edited_by":"cashier"');
  });

  it("a stale line reading is refused with the service's reason (no money moves)", async () => {
    const p = { carrierLineId: 1, newCredits: 480, expectedCurrentCredits: 450 };
    const run = await runParity(
      c({ channel: "carrier-lines:record-usage", payload: p, online: () => getCarrierLineService().recordUsage(recordCarrierLineUsageSchema.parse(p), 1) }),
    );
    expect(run.online.result).toMatchObject({ success: false });
    expect(run.replay.outcome.status).toBe("refused");
    expect(run.replay.outcome.error).toBe((run.online.result as { error: string }).error);
    expect(run.replay.state).toEqual(run.online.state);
  });
});

describe("auto expenses take the request's day (T104 finding, rule 27)", () => {
  /** expense_date and the transaction's metadata, which carries it too */
  const dayState = (db: Database.Database) => ({
    expenses: db.prepare(`SELECT category, expense_date FROM expenses WHERE id > 1 ORDER BY id`).all(),
    meta: db.prepare(`SELECT type, metadata_json FROM transactions WHERE type = 'EXPENSE' AND id > 2 ORDER BY id`).all(),
  });
  it.each([
    ["carrier-lines:record-usage (Line_Usage)", { channel: "carrier-lines:record-usage", payload: { carrierLineId: 1, newCredits: 480 }, online: () => getCarrierLineService().recordUsage(recordCarrierLineUsageSchema.parse({ carrierLineId: 1, newCredits: 480 }), 1) }],
    [
      "recharge:process (SMS_Transfer_Fee)",
      {
        channel: "recharge:process",
        payload: { ...SEED_RECHARGE, client_day: "2026-10-10" },
        online: () => getRechargeService().processRecharge({ ...createRechargeSchema.parse({ ...SEED_RECHARGE, client_day: "2026-10-10" }), userId: 1 } as never),
      },
    ],
  ] as const)("%s — online (client day 2026-10-10) and replay store the same expense_date", async (_n, over) => {
    const run = await runParity(c({ ...over, payload: { ...over.payload }, state: dayState } as never));
    expect(run.replay.outcome.status).toBe("booked");
    const on = run.online.state as { extra: { expenses: Array<{ expense_date: string }> } };
    expect(on.extra.expenses.length).toBeGreaterThan(0);
    expect(on.extra.expenses.every((e) => e.expense_date === "2026-10-10")).toBe(true);
    expect(run.replay.state).toEqual(run.online.state);
  });
});
