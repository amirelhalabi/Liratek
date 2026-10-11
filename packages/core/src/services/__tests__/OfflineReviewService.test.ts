/**
 * LIRA-306 T068 — the review list behind the web page (FR-037, R13).
 *
 * List grouped by kind with plain labels and the matching row; Apply bypasses
 * ONLY the reason the item was held (checkpoint hold / duplicate check), a
 * refused item re-runs every check, and waiting dependants are then processed
 * in order; Apply is refused for a waiting item whose parent is open; Dismiss
 * books nothing and leaves non-duplicate dependants waiting "depends on a
 * dismissed item"; Mark reviewed closes notes; Book anyway is for certain
 * duplicates only; every action is idempotent and records who / when;
 * history shows the server rows and the offline receipt number.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { getDatabase } from "../../db/connection";
import { ReplayEngine } from "../../offline/ReplayEngine";
import type { OfflineBinding } from "../../offline/bindings/types";
import { OFFLINE_REVIEW_KIND_LABELS } from "../../offline/reviewKinds";
import { encodeOfflineId, offlineTableIndex } from "../../offline/idRange";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { OfflineReviewService } from "../OfflineReviewService";
import { installReplayDb, storeEvent, uninstallReplayDb, resetSeq } from "../../offline/testHelpers/replayHarness";

let db: Database.Database;
let pc1 = 0;
let n = 0;
let refuseNext = 0;
const booked: string[] = [];

/** stub bindings: every booking inserts a client row named after the event's note */
const stub = (channel: string): OfflineBinding => ({
  channel,
  run: (p) => {
    if (refuseNext > 0) {
      refuseNext -= 1;
      return { success: false, error: "Refused by the service (stub)" };
    }
    booked.push(String(p.note ?? p.id));
    const r = getDatabase().prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, ?)`).run(String(p.note ?? channel));
    return { success: true, id: Number(r.lastInsertRowid) };
  },
  mainRow: (r) => (typeof r.id === "number" ? { table: "clients", id: r.id } : null),
});
const engine = () => new ReplayEngine({ bindings: (ch) => stub(ch), duplicateHook: () => undefined });
const svc = () => new OfflineReviewService({ engine: engine() });

beforeEach(() => {
  resetSeq();
  n = 0;
  refuseNext = 0;
  booked.length = 0;
  ({ db, deviceId: pc1 } = installReplayDb());
});
afterEach(() => uninstallReplayDb(db));

const eventId = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
const store = (channel: string, payload: Record<string, unknown>, extra: { created?: Record<string, number[]>; dependsOn?: string[]; actorUserId?: number } = {}) => {
  n += 1;
  // every stub booking creates one client: the PC created one too (no "came out differently")
  return storeEvent({ deviceId: pc1, channel, payload, seq: n, eventId: eventId(n), created: { clients: [pcClient(100 + n)] }, ...extra });
};
const auto = async () => {
  const events = new OfflineEventRepository();
  for (let s = 1; s <= n; s++) {
    const row = runWithTenant(1, () => events.findBySeq(pc1, s))!;
    if (row.status === "received") await runWithTenant(1, () => engine().process(row, { mode: "auto" }));
  }
};
const status = (k: number) => runWithTenant(1, () => new OfflineEventRepository().findByEventId(eventId(k))!.status);
const open = () => runWithTenant(1, () => new OfflineReviewRepository().list({ state: "open" }));
const itemOf = (kind: string, k?: number) =>
  runWithTenant(1, () => {
    const items = new OfflineReviewRepository().list({ state: "open" }).filter((i) => i.kind === kind);
    if (k === undefined) return items[0];
    const ev = new OfflineEventRepository().findByEventId(eventId(k))!;
    return items.find((i) => i.event_row_id === ev.id)!;
  });
const pcClient = (k: number) => encodeOfflineId(1, offlineTableIndex("clients"), k);
const CHECKPOINT = "carrier-lines:update-balance";
const NOTE_CH = "sales:update-metadata";

describe("OfflineReviewService.list", () => {
  it("groups open items by kind with plain labels, the event and its PC", async () => {
    store(CHECKPOINT, { id: 1, credits: 5 }, { actorUserId: 1 });
    refuseNext = 1;
    store(NOTE_CH, { id: 1, note: "refused one" });
    await auto();
    const r = runWithTenant(1, () => svc().list({ state: "open" }));
    expect(r.success).toBe(true);
    const kinds = r.data!.items.map((i) => i.kind).sort();
    expect(kinds).toEqual(["held_checkpoint", "refused"]);
    const item = r.data!.items.find((i) => i.kind === "refused")!;
    expect(item.label).toBe(OFFLINE_REVIEW_KIND_LABELS.refused);
    expect(item).toMatchObject({ deviceNo: 1, channel: NOTE_CH, eventId: eventId(2), actions: ["apply", "dismiss"] });
    expect(item.reason).toMatch(/Refused by the service/);
    expect(r.data!.groups).toEqual(
      expect.arrayContaining([{ kind: "held_checkpoint", label: OFFLINE_REVIEW_KIND_LABELS.held_checkpoint, count: 1 }]),
    );
  });
});

describe("Apply", () => {
  it("a held checkpoint: books it (the hold is bypassed) at the event's time, once; repeat is idempotent; who/when recorded", async () => {
    store(CHECKPOINT, { id: 7, credits: 5 }, { actorUserId: 1 });
    await auto();
    const id = itemOf("held_checkpoint").id;
    const r = await runWithTenant(1, () => svc().apply(id, 1));
    expect(r).toMatchObject({ success: true, data: { status: "applied" } });
    expect(booked).toEqual(["7"]);
    const again = await runWithTenant(1, () => svc().apply(id, 1));
    expect(again).toMatchObject({ success: true, data: { status: "applied" } });
    expect(booked).toEqual(["7"]);
    const item = runWithTenant(1, () => new OfflineReviewRepository().findById(id))!;
    expect(item).toMatchObject({ state: "applied", resolved_by: 1 });
    expect(item.resolved_at).toBeTruthy();
  });

  it("a refused item re-runs every check: refused again → stays open with the new reason; then booked", async () => {
    refuseNext = 1;
    store(NOTE_CH, { id: 1, note: "retry me" });
    await auto();
    const id = itemOf("refused").id;
    refuseNext = 1;
    // the first refusal's reason, then a different one on Apply
    db.prepare(`UPDATE offline_events SET error = 'old reason' WHERE event_id = ?`).run(eventId(1));
    refuseNext = 1;
    const r1 = await runWithTenant(1, () => svc().apply(id, 1));
    expect(r1.success).toBe(false);
    expect(status(1)).toBe("refused");
    expect(itemOf("refused").id).toBe(id);
    const shown = runWithTenant(1, () => svc().list({ state: "open" })).data!.items.find((i) => i.id === id)!;
    expect(shown.reason).toMatch(/Refused by the service/);
    const r2 = await runWithTenant(1, () => svc().apply(id, 1));
    expect(r2).toMatchObject({ success: true, data: { status: "applied" } });
    expect(open()).toEqual([]);
  });

  it("then processes the waiting dependants in their original order (transitively)", async () => {
    refuseNext = 1;
    store(NOTE_CH, { id: 1, note: "parent" }, { created: { clients: [pcClient(1)] } });
    store(NOTE_CH, { id: pcClient(1), note: "child" }, { dependsOn: [eventId(1)], created: { clients: [pcClient(2)] } });
    // (the stub ignores ids; sales:update-metadata's `id` is an id position, so it is rewritten)
    store(NOTE_CH, { id: pcClient(2), note: "grandchild" }, { dependsOn: [eventId(2)] });
    await auto();
    expect([status(1), status(2), status(3)]).toEqual(["refused", "held", "held"]);
    const early = await runWithTenant(1, () => svc().apply(itemOf("waiting", 2).id, 1));
    expect(early.success).toBe(false);
    expect(early.error).toMatch(/waits on an item that is still open/i);
    const r = await runWithTenant(1, () => svc().apply(itemOf("refused").id, 1));
    expect(r.success).toBe(true);
    expect([status(1), status(2), status(3)]).toEqual(["applied", "booked", "booked"]);
    expect(booked).toEqual(["parent", "child", "grandchild"]);
    expect(open()).toEqual([]);
  });

  it("a version refusal offers no Apply", async () => {
    store(NOTE_CH, { id: 1, note: "x" });
    db.prepare(`UPDATE offline_events SET schema_shape_json = '{"type":"string"}'`).run();
    await auto();
    const item = runWithTenant(1, () => svc().list({ state: "open" })).data!.items[0];
    expect(item.actions).toEqual(["dismiss"]);
    const r = await runWithTenant(1, () => svc().apply(item.id, 1));
    expect(r.success).toBe(false);
  });
});

describe("Dismiss / Mark reviewed / Book anyway", () => {
  it("Dismiss books nothing; dependants stay held with 'depends on a dismissed item'", async () => {
    refuseNext = 1;
    store(NOTE_CH, { id: 1, note: "parent" }, { created: { clients: [pcClient(1)] } });
    store(NOTE_CH, { id: pcClient(1), note: "child" }, { dependsOn: [eventId(1)] });
    await auto();
    const refusedId = itemOf("refused").id;
    const r = await runWithTenant(1, () => svc().dismiss(refusedId, 1, "typed twice"));
    expect(r).toMatchObject({ success: true, data: { state: "dismissed" } });
    expect(status(1)).toBe("dismissed");
    expect(status(2)).toBe("held");
    expect(booked).toEqual([]);
    expect(runWithTenant(1, () => new OfflineEventRepository().findByEventId(eventId(2))!.error)).toMatch(/depends on a dismissed item/i);
    // …and that is what the page shows for the waiting item
    const shown = runWithTenant(1, () => svc().list({ state: "open" })).data!.items.find((i) => i.kind === "waiting")!;
    expect(shown.reason).toMatch(/depends on a dismissed item/i);
    // idempotent: a repeat returns the current state
    expect(await runWithTenant(1, () => svc().dismiss(refusedId, 1))).toMatchObject({ success: true, data: { state: "dismissed" } });
  });

  it("Mark reviewed closes a note; not offered for a held item", async () => {
    store(NOTE_CH, { id: 1, note: "ok" });
    await auto();
    const ev = runWithTenant(1, () => new OfflineEventRepository().findByEventId(eventId(1))!);
    const noteId = runWithTenant(1, () => new OfflineReviewRepository().insert({ eventRowId: ev.id, deviceId: pc1, kind: "stock_count_off", details: { products: [] } }));
    expect(await runWithTenant(1, () => svc().markReviewed(noteId, 1))).toMatchObject({ success: true, data: { state: "reviewed" } });
    store(CHECKPOINT, { id: 1, credits: 5 }, { actorUserId: 1 });
    await auto();
    expect((await runWithTenant(1, () => svc().markReviewed(itemOf("held_checkpoint").id, 1))).success).toBe(false);
  });

  it("Book anyway is only for certain duplicates", async () => {
    store(CHECKPOINT, { id: 1, credits: 5 }, { actorUserId: 1 });
    await auto();
    expect((await runWithTenant(1, () => svc().bookAnyway(itemOf("held_checkpoint").id, 1))).success).toBe(false);
  });
});

describe("history", () => {
  it("lists processed events with the server rows and the offline receipt number of a sale", async () => {
    const pcSale = encodeOfflineId(1, offlineTableIndex("sales"), 5);
    store(NOTE_CH, { id: 1, note: "h" }, { created: { sales: [pcSale] } });
    await auto();
    const r = runWithTenant(1, () => svc().history({}));
    expect(r.success).toBe(true);
    expect(r.data!.events[0]).toMatchObject({ eventId: eventId(1), status: "booked", deviceNo: 1, receiptNumber: `RCP-${pcSale}` });
    expect(r.data!.events[0].serverIds).toEqual(expect.objectContaining({ clients: [expect.any(Number)] }));
  });
});
