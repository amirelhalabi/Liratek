/**
 * LIRA-377 T042 (rule 17, SC-003) — an offline event that points at a row a
 * shop restore removed is HELD (`restore_removed`), never booked — and never
 * booked to the row that took the next number afterwards.
 *
 * Real channel `sales:process` (its recorded schema carries `client_id` +
 * `client_name`, so Zod keeps the reference); the binding is a test double
 * that records every call, so "nothing booked" is observable.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { OfflineIdMapRepository } from "../../repositories/OfflineIdMapRepository";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { ShopRestoresRepository } from "../../repositories/ShopRestoresRepository";
import { ReplayEngine } from "../ReplayEngine";
import type { OfflineBinding } from "../bindings/types";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq, insertCopy } from "../testHelpers/replayHarness";

const CH = "sales:process";
const PC_CLIENT = 1_017_000_000_001; // PC 1, clients #1
const OCCURRED = "2026-11-10T13:05:00.000Z";

let db: Database.Database;
let deviceId = 0;
let calls: Array<Record<string, unknown>> = [];
const binding: OfflineBinding = {
  channel: CH,
  run: (payload) => {
    calls.push(payload);
    return { success: true };
  },
};
const engine = () => new ReplayEngine({ bindings: (c) => (c === CH ? binding : undefined) });
const events = new OfflineEventRepository();
const idMap = new OfflineIdMapRepository();
const reviews = new OfflineReviewRepository();
const restores = new ShopRestoresRepository();

function salePayload(clientId: number, name = "Rami"): Record<string, unknown> {
  return {
    client_id: clientId,
    client_name: name,
    items: [{ product_id: 3001, quantity: 1, price: 5 }],
    total_amount: 5,
    discount: 0,
    final_amount: 5,
    payment_usd: 0,
    payment_lbp: 0,
    payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 5 }],
    exchange_rate: 89500,
    status: "completed",
  };
}

function addClient(name: string): number {
  return Number(
    db.prepare(`INSERT INTO clients (tenant_id, full_name, created_at) VALUES (1, ?, '2026-11-10 13:00:00')`).run(name)
      .lastInsertRowid,
  );
}

/** What the restore does to the shop file + the platform record it leaves. */
function restore(removeClientIds: number[], finishedAt: string): number {
  for (const id of removeClientIds) db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);
  const row = restores.createPrepared({
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
  restores.markRunning(row.id, "2026-11-10T13:19:00.000Z");
  restores.markDone(row.id, { finishedAt, beforeCopyPath: null });
  return row.id;
}

const process = (row: ReturnType<typeof storeEvent>) => runWithTenant(1, () => engine().process(row, { mode: "auto" }));
const reload = (id: number) => runWithTenant(1, () => events.findById(id)!);
const clientName = (id: number) =>
  (db.prepare(`SELECT full_name FROM clients WHERE id = ?`).get(id) as { full_name: string } | undefined)?.full_name;

beforeEach(() => {
  ({ db, deviceId } = installReplayDb());
  resetSeq();
  calls = [];
  db.prepare(
    `INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
     VALUES (3001, 1, 'Cable', 'Product', 'General', 2, 5, 20)`,
  ).run();
});
afterEach(() => uninstallReplayDb(db));

describe("ReplayEngine — a reference the restore removed (LIRA-377 SC-003)", () => {
  it.each([
    ["a mapped offline id", true],
    ["a plain server id", false],
  ])("%s: held restore_removed, nothing booked, the next client untouched", async (_label, viaMap) => {
    const rami = addClient("Rami");
    if (viaMap) {
      runWithTenant(1, () =>
        idMap.insert({ offlineId: PC_CLIENT, deviceId, tableName: "clients", serverId: rami, eventId: "e-rami" }),
      );
    }
    const row = storeEvent({ deviceId, channel: CH, payload: salePayload(viaMap ? PC_CLIENT : rami), occurredAt: OCCURRED });

    const restoreId = restore([rami], "2026-11-10T13:20:09Z");
    const hadi = addClient("Hadi");
    expect(hadi).not.toBe(rami);

    const out = await process(row);

    expect(out.status).toBe("held");
    expect(out.notes).toEqual(["restore_removed"]);
    expect(calls).toHaveLength(0);
    expect(reload(row.id).status).toBe("held");
    const items = runWithTenant(1, () => reviews.list({ kind: "restore_removed" }));
    expect(items).toHaveLength(1);
    expect(JSON.parse(items[0].details_json)).toMatchObject({
      restoreId,
      restoredTo: "2026-11-10T12:55:00.000Z",
      removed: [{ table: "clients", id: rami, label: "Rami" }],
    });
    expect(clientName(hadi)).toBe("Hadi");
    expect((db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as { n: number }).n).toBe(0);
  });

  it("a missing row with NO restore keeps today's behaviour (the binding decides)", async () => {
    const row = storeEvent({ deviceId, channel: CH, payload: salePayload(999), occurredAt: OCCURRED });
    const out = await process(row);
    expect(out.status).toBe("booked");
    expect(calls).toHaveLength(1);
    expect(runWithTenant(1, () => reviews.list({ kind: "restore_removed" }))).toHaveLength(0);
  });

  it("a restore that finished BEFORE the event was recorded keeps today's behaviour", async () => {
    restore([], "2026-11-10T13:00:00Z");
    const row = storeEvent({ deviceId, channel: CH, payload: salePayload(999), occurredAt: OCCURRED });
    const out = await process(row);
    expect(out.status).toBe("booked");
    expect(calls).toHaveLength(1);
  });

  it("references that still exist are booked as usual after a restore", async () => {
    const kept = addClient("Kept");
    restore([], "2026-11-10T13:20:09Z");
    const row = storeEvent({ deviceId, channel: CH, payload: salePayload(kept, "Kept"), occurredAt: OCCURRED });
    const out = await process(row);
    expect(out.status).toBe("booked");
    expect(calls[0]?.client_id).toBe(kept);
  });

  // Spec US4 Case B: the till is offline 15:05–15:40, the restore finishes at
  // 15:20 — a sale rung up at 15:30 on the PRE-restore copy still points at
  // Rami. What decides is the copy the PC was working on, not the clock.
  it("an event recorded AFTER the restore on a copy built BEFORE it is held too", async () => {
    insertCopy("2026-11-10T13:00:00.000Z", {});
    const rami = addClient("Rami");
    restore([rami], "2026-11-10T13:20:09Z");
    const row = storeEvent({ deviceId, channel: CH, payload: salePayload(rami), occurredAt: "2026-11-10T13:30:00.000Z" });
    const out = await process(row);
    expect(out.status).toBe("held");
    expect(out.notes).toEqual(["restore_removed"]);
    expect(calls).toHaveLength(0);
  });

  it("an event recorded on a copy built AFTER the restore keeps today's behaviour", async () => {
    restore([], "2026-11-10T13:20:09Z");
    insertCopy("2026-11-10T13:25:00.000Z", {});
    const row = storeEvent({ deviceId, channel: CH, payload: salePayload(999), occurredAt: "2026-11-10T13:30:00.000Z" });
    const out = await process(row);
    expect(out.status).toBe("booked");
  });

  it("the hold keeps the payload, so the cashier can re-enter it from the details", async () => {
    const rami = addClient("Rami");
    const row = storeEvent({ deviceId, channel: CH, payload: salePayload(rami), occurredAt: OCCURRED });
    restore([rami], "2026-11-10T13:20:09Z");
    await process(row);
    const item = runWithTenant(1, () => reviews.list({ kind: "restore_removed" }))[0];
    expect(JSON.parse(item.details_json).payload).toMatchObject({ client_name: "Rami", final_amount: 5 });
  });
});
