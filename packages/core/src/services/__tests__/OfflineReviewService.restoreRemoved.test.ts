/**
 * LIRA-377 T047 — Apply a `restore_removed` item with a replacement.
 *
 * A held offline sale pointed at a client a shop restore removed. The admin
 * picks another client (the stored payload is re-run with that reference —
 * and the name the PC showed — replaced) or books it as walk-in (no client:
 * the id becomes null and the removed name is dropped, so the sale service
 * cannot re-create the removed client from it). An item that points at
 * anything other than a client offers Dismiss only.
 *
 * The REAL `sales:process` binding (SalesService.processSale) books, so the
 * money side is the real one: a walk-in of an on-account sale is refused by
 * the service ("Cannot create debt for anonymous client"), never booked as a
 * debt with no client.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { ReplayEngine } from "../../offline/ReplayEngine";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { ShopRestoresRepository } from "../../repositories/ShopRestoresRepository";
import { OfflineReviewService } from "../OfflineReviewService";
import { reviewApplySchema } from "../../validators/offline";
import { MATCH_RECORDED_RATES_SQL } from "../../offline/testHelpers/bindingFixtures";
import { installReplayDb, storeEvent, uninstallReplayDb, resetSeq } from "../../offline/testHelpers/replayHarness";

const CH = "sales:process";
const OCCURRED = "2026-11-10T13:05:00.000Z";

let db: Database.Database;
let deviceId = 0;
const reviews = new OfflineReviewRepository();
const events = new OfflineEventRepository();
const svc = () => new OfflineReviewService({ engine: new ReplayEngine({ duplicateHook: () => undefined }) });

function addClient(name: string, phone: string | null = null): number {
  return Number(
    db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number, created_at) VALUES (1, ?, ?, '2026-11-10 13:00:00')`)
      .run(name, phone).lastInsertRowid,
  );
}

function sale(clientId: number, onAccount: boolean, productId = 3001): Record<string, unknown> {
  return {
    client_id: clientId,
    client_name: "Rami",
    client_phone: "70111222",
    items: [{ product_id: productId, quantity: 1, price: 5 }],
    total_amount: 5,
    discount: 0,
    final_amount: 5,
    payment_usd: onAccount ? 0 : 5,
    payment_lbp: 0,
    payments: [{ method: onAccount ? "CUSTOMER_ACCOUNT" : "CASH", currency_code: "USD", amount: 5 }],
    exchange_rate: 89500,
    status: "completed",
  };
}

function restore(): void {
  const repo = new ShopRestoresRepository();
  const r = repo.createPrepared({
    targetTenantId: 1,
    kind: "time",
    restoredTo: "2026-11-10T12:55:00.000Z",
    clientTzOffsetMin: 120,
    requestedByUserId: 1,
    requestedByName: "owner",
    candidatePath: null,
    previewJson: null,
    idFloorJson: null,
    preparedAt: "2026-11-10T13:15:00.000Z",
  });
  repo.markRunning(r.id, "2026-11-10T13:19:00.000Z");
  repo.markDone(r.id, { finishedAt: "2026-11-10T13:20:09Z", beforeCopyPath: null });
}

/** An offline sale on removed client Rami, held by the replay. */
async function heldSale(payloadFor: (rami: number) => Record<string, unknown>): Promise<{ itemId: number; eventRow: number }> {
  const rami = addClient("Rami", "70111222");
  const row = storeEvent({ deviceId, channel: CH, payload: payloadFor(rami), occurredAt: OCCURRED });
  db.prepare(`DELETE FROM clients WHERE id = ?`).run(rami);
  restore();
  const out = await runWithTenant(1, () => new ReplayEngine({ duplicateHook: () => undefined }).process(row, { mode: "auto" }));
  expect(out.status).toBe("held");
  const item = runWithTenant(1, () => reviews.list({ kind: "restore_removed" }))[0];
  return { itemId: item.id, eventRow: row.id };
}

const salesRows = () =>
  db
    .prepare(
      `SELECT s.client_id, t.client_name FROM sales s
         LEFT JOIN transactions t ON t.source_table = 'sales' AND t.source_id = s.id`,
    )
    .all() as Array<{ client_id: number | null; client_name: string | null }>;
const debtUsd = (clientId: number) =>
  (db.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS s FROM debt_ledger WHERE client_id = ?`).get(clientId) as { s: number }).s;
const apply = (itemId: number, body: Record<string, unknown>) =>
  runWithTenant(1, () => svc().apply(itemId, 1, reviewApplySchema.parse(body)));

beforeEach(() => {
  ({ db, deviceId } = installReplayDb());
  resetSeq();
  db.exec(MATCH_RECORDED_RATES_SQL);
  db.exec(`INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
           VALUES (3001, 1, 'Cable', 'Product', 'General', 2, 5, 20)`);
});
afterEach(() => uninstallReplayDb(db));

describe("OfflineReviewService.apply — restore_removed (LIRA-377)", () => {
  it("lists Apply + Dismiss when every removed reference is a client", async () => {
    const { itemId } = await heldSale((rami) => sale(rami, true));
    const item = runWithTenant(1, () => svc().list({ kind: "restore_removed" })).data!.items.find((i) => i.id === itemId)!;
    expect(item.actions).toEqual(["apply", "dismiss"]);
  });

  it("Apply without a choice is refused (CHOICE_REQUIRED), nothing booked", async () => {
    const { itemId } = await heldSale((rami) => sale(rami, true));
    expect(await apply(itemId, {})).toMatchObject({ success: false, code: "CHOICE_REQUIRED" });
    expect(salesRows()).toHaveLength(0);
  });

  it("another client: the sale and its debt go to that client, with that client's name", async () => {
    const { itemId, eventRow } = await heldSale((rami) => sale(rami, true));
    const hadi = addClient("Hadi", "70999888");
    const out = await apply(itemId, { replacementClientId: hadi });
    expect(out).toMatchObject({ success: true, data: { status: "applied" } });
    expect(salesRows()).toEqual([{ client_id: hadi, client_name: "Hadi" }]);
    expect(debtUsd(hadi)).toBeCloseTo(5, 5);
    // the stored payload (and its hash) is never rewritten
    expect(JSON.parse(runWithTenant(1, () => events.findById(eventRow)!).payload_json).client_name).toBe("Rami");
    expect(runWithTenant(1, () => reviews.findById(itemId))!.state).toBe("applied");
  });

  it("a replacement client that does not exist is refused", async () => {
    const { itemId } = await heldSale((rami) => sale(rami, true));
    expect(await apply(itemId, { replacementClientId: 424242 })).toMatchObject({ success: false, code: "NOT_FOUND" });
    expect(salesRows()).toHaveLength(0);
  });

  it("walk-in of a cash sale books it with no client (the removed client is not re-created)", async () => {
    const { itemId } = await heldSale((rami) => sale(rami, false));
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM clients`).get() as { n: number }).n;
    const out = await apply(itemId, { walkIn: true });
    expect(out).toMatchObject({ success: true, data: { status: "applied" } });
    expect(salesRows()).toEqual([{ client_id: null, client_name: null }]);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM clients`).get() as { n: number }).n).toBe(before);
  });

  it("walk-in of an ON-ACCOUNT sale is refused by the sale service — no debt without a client", async () => {
    const { itemId } = await heldSale((rami) => sale(rami, true));
    const out = await apply(itemId, { walkIn: true });
    expect(out).toMatchObject({ success: false, code: "REFUSED" });
    expect(out.error).toMatch(/anonymous client/i);
    expect(salesRows()).toHaveLength(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger`).get() as { n: number }).n).toBe(0);
    expect(runWithTenant(1, () => reviews.findById(itemId))!.state).toBe("open");
  });

  it("a removed PRODUCT reference: Dismiss only, Apply refused", async () => {
    db.exec(`INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
             VALUES (3002, 1, 'Gone', 'Product', 'General', 2, 5, 20)`);
    const kept = addClient("Kept");
    const row = storeEvent({ deviceId, channel: CH, payload: sale(kept, false, 3002), occurredAt: OCCURRED });
    db.prepare(`DELETE FROM products WHERE id = 3002`).run();
    restore();
    await runWithTenant(1, () => new ReplayEngine({ duplicateHook: () => undefined }).process(row, { mode: "auto" }));
    const item = runWithTenant(1, () => svc().list({ kind: "restore_removed" })).data!.items[0];
    expect(item.details.removed).toEqual([{ table: "products", id: 3002, label: "#3002", path: "items[0].product_id" }]);
    expect(item.actions).toEqual(["dismiss"]);
    expect(await apply(item.id, { walkIn: true })).toMatchObject({ success: false, code: "NOT_APPLICABLE" });
    expect(await apply(item.id, {})).toMatchObject({ success: false, code: "NOT_APPLICABLE" });
    expect(salesRows()).toHaveLength(0);
  });

  it("a replacement choice on any other kind of item is refused", async () => {
    const row = storeEvent({ deviceId, channel: "closing:create-checkpoint", payload: {}, occurredAt: OCCURRED });
    const out = await runWithTenant(1, () => new ReplayEngine({ duplicateHook: () => undefined }).process(row, { mode: "auto" }));
    expect(out.notes).toEqual(["held_checkpoint"]);
    const item = runWithTenant(1, () => reviews.list({ kind: "held_checkpoint" }))[0];
    expect(await apply(item.id, { walkIn: true })).toMatchObject({ success: false, code: "NOT_APPLICABLE" });
  });

  it("walk-in of an action that always needs a client (debt repayment) is refused in plain words", async () => {
    const gone = addClient("Rami");
    const row = storeEvent({
      deviceId,
      channel: "debt:add-repayment",
      payload: { clientId: gone, amountUSD: 5, payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }] },
      occurredAt: OCCURRED,
    });
    db.prepare(`DELETE FROM clients WHERE id = ?`).run(gone);
    restore();
    await runWithTenant(1, () => new ReplayEngine({ duplicateHook: () => undefined }).process(row, { mode: "auto" }));
    const item = runWithTenant(1, () => reviews.list({ kind: "restore_removed" }))[0];
    expect(await apply(item.id, { walkIn: true })).toEqual({
      success: false,
      code: "CLIENT_REQUIRED",
      error: "This needs a client — pick one",
    });
  });
});
