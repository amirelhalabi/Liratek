/**
 * LIRA-306 T062 — outcomes when the shop changed online meanwhile (R7,
 * FR-028–FR-034, N6, O-new-3, O-new-4). Real schema, real services, per
 * ledger / per currency where money moves (rule 15).
 *
 * Cases that pin today's behaviour (not failing-first guards) say so.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { ReplayEngine } from "../ReplayEngine";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { OfflineIdMapRepository } from "../../repositories/OfflineIdMapRepository";
import { getTransactionService } from "../../services/TransactionService";
import { encodeOfflineId, offlineTableIndex } from "../idRange";
import { installReplayDb, storeEvent, uninstallReplayDb, resetSeq } from "../testHelpers/replayHarness";
import { DUP_SEED_SQL, SALE, bookOnline } from "../testHelpers/dupHarness";

let db: Database.Database;
let pc1 = 0;
let n = 0;
beforeEach(() => {
  resetSeq();
  n = 0;
  ({ db, deviceId: pc1 } = installReplayDb());
  db.exec(DUP_SEED_SQL);
});
afterEach(() => uninstallReplayDb(db));

const eventId = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
const AT = "2026-10-10T20:50:00.000Z";
const replay = async (channel: string, payload: Record<string, unknown>, extra: { created?: Record<string, number[]>; dependsOn?: string[]; actorUserId?: number } = {}) => {
  n += 1;
  const row = storeEvent({ deviceId: pc1, channel, payload, seq: n, eventId: eventId(n), occurredAt: AT, ...extra });
  return runWithTenant(1, () => new ReplayEngine().process(row, { mode: "auto" }));
};
const notesOf = (k: number) =>
  runWithTenant(1, () => {
    const ev = new OfflineEventRepository().findByEventId(eventId(k))!;
    return new OfflineReviewRepository().listForEvent(ev.id);
  });
const kinds = (k: number) => notesOf(k).map((i) => i.kind);
const pcId = (table: string, k: number) => encodeOfflineId(1, offlineTableIndex(table), k);
const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;

describe("stock (FR-028, N6)", () => {
  beforeEach(() => {
    db.exec(`
      INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
        VALUES (35, 1, 'Last case', 'Product', 'General', 2, 40, 0);
      UPDATE system_settings SET value = '0' WHERE key_name = 'allow_out_of_stock_sales';
    `);
  });
  const SHORT = SALE({ items: [{ product_id: 35, quantity: 1, price: 40 }] });

  it("a web sale with the setting off is still refused (web unchanged)", () => {
    expect(() => bookOnline("sales:process", SHORT, AT)).toThrow(/refused/);
  });

  it("a replayed sale short of stock is BOOKED via the out-of-stock path and flagged per product", async () => {
    const out = await replay("sales:process", SHORT);
    expect(out.status).toBe("booked");
    expect(one<{ s: number }>(`SELECT stock_quantity AS s FROM products WHERE id = 35`).s).toBe(-1);
    const note = notesOf(1).find((i) => i.kind === "stock_count_off")!;
    expect(note).toBeTruthy();
    expect(JSON.parse(note.details_json).products).toEqual([expect.objectContaining({ id: 35, stock: -1 })]);
  });

  it("a replayed stock use (expense) short of stock is booked and flagged too — written after the change, not proven failing-first", async () => {
    const out = await replay("expenses:add-stock-use", { source: "INVENTORY", item_id: 35, quantity: 2, category: "Shop use", expense_date: "2026-10-10" });
    expect(out.status).toBe("booked");
    expect(one<{ s: number }>(`SELECT stock_quantity AS s FROM products WHERE id = 35`).s).toBe(-2);
    expect(kinds(1)).toContain("stock_count_off");
  });

  it("a replayed sale WITH enough stock carries no stock note", async () => {
    await replay("sales:process", SALE());
    expect(kinds(1)).not.toContain("stock_count_off");
  });
});

describe("repayment whose ticked item was paid online meanwhile (FR-029, O-new-3)", () => {
  it("is booked without the ticks, noted, and only its main row is mapped", async () => {
    // a sale on account to the debtor, paid in full online
    const sale = bookOnline("sales:process", SALE({ client_id: 7001, payment_usd: 0, payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 40 }] }), "2026-10-10T10:00:00.000Z");
    const saleId = sale.created.sales[0];
    bookOnline("debt:add-repayment", { clientId: 7001, amountUSD: 40, payments: [{ method: "CASH", currencyCode: "USD", amount: 40 }], targets: [{ kind: "sale", id: saleId }] }, "2026-10-10T11:00:00.000Z");
    const debtBefore = one<{ usd: number }>(`SELECT ROUND(SUM(amount_usd), 2) AS usd FROM debt_ledger WHERE client_id = 7001`).usd;
    const cashBefore = one<{ b: number }>(`SELECT balance AS b FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'`).b;

    const out = await replay(
      "debt:add-repayment",
      { clientId: 7001, amountUSD: 10, payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }], targets: [{ kind: "sale", id: saleId }] },
      { created: { debt_ledger: [pcId("debt_ledger", 1)], transactions: [pcId("transactions", 1), pcId("transactions", 2)], payments: [pcId("payments", 1)] } },
    );
    expect(out.status).toBe("booked");
    expect(kinds(1)).toContain("ticks_dropped");
    expect(kinds(1)).not.toContain("came_out_differently");
    // money: +10 cash, debt −10
    expect(one<{ usd: number }>(`SELECT ROUND(SUM(amount_usd), 2) AS usd FROM debt_ledger WHERE client_id = 7001`).usd).toBeCloseTo(debtBefore - 10);
    expect(one<{ b: number }>(`SELECT balance AS b FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'`).b).toBeCloseTo(cashBefore + 10);
    // only the main row (the repayment's debt_ledger row) is mapped
    const map = db.prepare(`SELECT table_name FROM offline_id_map`).all();
    expect(map).toEqual([{ table_name: "debt_ledger" }]);
  });
});

describe("customer created offline whose phone exists (FR-030, O-new-4)", () => {
  it("is linked to the existing customer; later work uses it; noted", async () => {
    const pcClient = pcId("clients", 1);
    const out = await replay("clients:create", { full_name: "Debtor (PC)", phone_number: "70007001", whatsapp_opt_in: 0 }, { created: { clients: [pcClient], transactions: [pcId("transactions", 1)] } });
    expect(out.status).toBe("booked");
    expect(kinds(1)).toEqual(["customer_linked"]);
    expect(runWithTenant(1, () => new OfflineIdMapRepository().findRow(pcClient))).toMatchObject({ server_id: 7001, link_kind: "linked_existing", table_name: "clients" });
    expect(one<{ c: number }>(`SELECT COUNT(*) AS c FROM clients WHERE phone_number = '70007001'`).c).toBe(1);
    // a sale on account to the PC's customer lands on the existing one
    const sale = await replay("sales:process", SALE({ client_id: pcClient, payment_usd: 0, payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 40 }] }), { dependsOn: [eventId(1)] });
    expect(sale.status).toBe("booked");
    expect(one<{ client_id: number }>(`SELECT client_id FROM sales ORDER BY id DESC LIMIT 1`).client_id).toBe(7001);
  });
});

describe("refusals and holds (pin today's behaviour where marked)", () => {
  it("void of something already voided online → refused with the reason (pins today's behaviour)", async () => {
    const s = bookOnline("sales:process", SALE(), "2026-10-10T10:00:00.000Z");
    const tx = s.created.transactions[0];
    runWithTenant(1, () => getTransactionService().voidTransaction(tx, 1));
    const out = await replay("transactions:void", { transactionId: tx }, { actorUserId: 1 });
    expect(out.status).toBe("refused");
    expect(out.error).toMatch(/already|void/i);
  });

  it("checkout of a basket closed online → refused (pins today's behaviour)", async () => {
    db.exec(`INSERT INTO customer_sessions (id, tenant_id, customer_name, user_id, started_at, closed_at, started_by, closed_by, is_active)
      VALUES (90, 1, 'Closed basket', 1, '2026-10-10 10:00:00', '2026-10-10 11:00:00', 'admin', 'admin', 0)`);
    const out = await replay("session:checkout", {
      sessionId: 90,
      userId: 1,
      cartItems: [{ id: "l1", module: "custom_service", label: "Svc", amount: 20, currency: "USD", ipcChannel: "custom-services:add", formData: { description: "Svc", price_usd: 20, cost_usd: 5 } }],
      payments: [{ method: "CASH", currency_code: "USD", amount: 20, direction: "IN" }],
    }, { actorUserId: 1 });
    expect(out.status).toBe("refused");
  });

  it("a checkpoint channel is held, never booked (pins today's behaviour)", async () => {
    const out = await replay("carrier-lines:update-balance", { id: 1, credits: 10 }, { actorUserId: 1 });
    expect(out.status).toBe("held");
    expect(kinds(1)).toEqual(["held_checkpoint"]);
  });

  it("an event depending on a refused one waits (pins today's behaviour)", async () => {
    await replay("transactions:void", { transactionId: 999999 }, { actorUserId: 1 });
    const out = await replay("sales:update-metadata", { id: 1, note: "x" }, { dependsOn: [eventId(1)] });
    expect(out.status).toBe("held");
    expect(kinds(2)).toEqual(["waiting"]);
  });
});

describe("a day already closed online (FR-033)", () => {
  it("a booked event whose day has a completed closing after its time carries a note naming the day", async () => {
    db.exec(`INSERT INTO daily_closings (id, tenant_id, closing_date, drawer_name, created_by, created_at, updated_at)
      VALUES (70, 1, '2026-10-10', 'General', 1, '2026-10-10 21:30:00', '2026-10-10 21:30:00')`);
    const out = await replay("sales:process", SALE());
    expect(out.status).toBe("booked");
    const note = notesOf(1).find((i) => i.kind === "closed_day_changed")!;
    expect(JSON.parse(note.details_json)).toMatchObject({ day: "2026-10-10" });
  });

  it("a closing BEFORE the event's time is not a changed day", async () => {
    db.exec(`INSERT INTO daily_closings (id, tenant_id, closing_date, drawer_name, created_by, created_at, updated_at)
      VALUES (71, 1, '2026-10-10', 'General', 1, '2026-10-10 08:00:00', '2026-10-10 08:00:00')`);
    await replay("sales:process", SALE());
    expect(kinds(1)).not.toContain("closed_day_changed");
  });
});
