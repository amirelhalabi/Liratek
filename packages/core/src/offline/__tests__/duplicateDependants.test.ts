/**
 * LIRA-306 T058 — events that depend on a duplicate (FR-026, FR-034,
 * O-new-20, O-new-28):
 *   - dependants of a SKIPPED certain duplicate stay `waiting`;
 *   - Mark reviewed → the duplicate's MAIN row is linked to the existing row
 *     and the dependants are processed (onto the existing row);
 *   - Book anyway → the duplicate is booked, mapped to its new rows, and the
 *     dependants are processed (onto the new row);
 *   - dependants of a HELD likely duplicate wait until Apply / Dismiss.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { ReplayEngine } from "../ReplayEngine";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { OfflineIdMapRepository } from "../../repositories/OfflineIdMapRepository";
import { RowCaptureRepository } from "../../repositories/RowCaptureRepository";
import { OfflineReviewService } from "../../services/OfflineReviewService";
import { insertCopy, installReplayDb, storeEvent, uninstallReplayDb, resetSeq } from "../testHelpers/replayHarness";
import { DUP_SEED_SQL, OMT_SEND, SALE, bookOnline, pcCreatedLike } from "../testHelpers/dupHarness";

let db: Database.Database;
let pc1 = 0;
let n = 0;
beforeEach(() => {
  resetSeq();
  n = 0;
  ({ db, deviceId: pc1 } = installReplayDb());
  db.exec(DUP_SEED_SQL);
  insertCopy("2026-10-10T10:00:00.000Z", runWithTenant(1, () => new RowCaptureRepository().highWaterMarks()));
});
afterEach(() => uninstallReplayDb(db));

const eventId = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
const store = (channel: string, payload: Record<string, unknown>, at: string, extra: { created?: Record<string, number[]>; dependsOn?: string[] } = {}) => {
  n += 1;
  return storeEvent({ deviceId: pc1, channel, payload, seq: n, eventId: eventId(n), occurredAt: at, ...extra });
};
const run = async () => {
  const events = new OfflineEventRepository();
  const out: string[] = [];
  for (let s = 1; s <= n; s++) {
    const row = runWithTenant(1, () => events.findBySeq(pc1, s))!;
    out.push((await runWithTenant(1, () => new ReplayEngine().process(row, { mode: "auto" }))).status);
  }
  return out;
};
const status = (k: number) => runWithTenant(1, () => new OfflineEventRepository().findByEventId(eventId(k))!.status);
const itemOf = (kind: string) =>
  runWithTenant(1, () => new OfflineReviewRepository().list({ state: "open" }).find((i) => i.kind === kind)!);
const svc = () => new OfflineReviewService();
const note = (table: string, id: number) =>
  (db.prepare(`SELECT note FROM ${table} WHERE id = ?`).get(id) as { note: string | null } | undefined)?.note ?? null;

/** e1: OMT send (certain duplicate of an online one); e2: a note edit on it. */
async function certainScenario() {
  const online = bookOnline("omt:add-transaction", OMT_SEND(), "2026-10-10T10:06:00.000Z");
  const pc = pcCreatedLike(online.created, 1, 1);
  store("omt:add-transaction", OMT_SEND(), "2026-10-10T10:40:00.000Z", { created: pc });
  store("financial:update-metadata", { id: pc.financial_services[0], note: "edited offline" }, "2026-10-10T10:41:00.000Z", { dependsOn: [eventId(1)] });
  expect(await run()).toEqual(["skipped", "held"]);
  expect(itemOf("waiting")).toBeTruthy();
  return { onlineFs: online.created.financial_services[0], pcFs: pc.financial_services[0] };
}

describe("dependants of a certain duplicate", () => {
  it("Mark reviewed links the MAIN row to the existing transfer and releases the dependant onto it", async () => {
    const { onlineFs, pcFs } = await certainScenario();
    const r = await runWithTenant(1, () => svc().markReviewed(itemOf("certain_duplicate").id, 1));
    expect(r.success).toBe(true);
    expect(runWithTenant(1, () => new OfflineIdMapRepository().findRow(pcFs))).toMatchObject({ server_id: onlineFs, link_kind: "linked_existing" });
    expect(status(1)).toBe("skipped");
    expect(status(2)).toBe("booked");
    expect(note("financial_services", onlineFs)).toBe("edited offline");
    expect(db.prepare(`SELECT COUNT(*) AS c FROM financial_services`).get()).toEqual({ c: 1 });
  });

  it("Book anyway books it, maps the new rows and releases the dependant onto the NEW transfer", async () => {
    const { onlineFs, pcFs } = await certainScenario();
    const r = await runWithTenant(1, () => svc().bookAnyway(itemOf("certain_duplicate").id, 1));
    expect(r.success).toBe(true);
    const newFs = runWithTenant(1, () => new OfflineIdMapRepository().lookup(pcFs))!;
    expect(newFs).not.toBe(onlineFs);
    expect(status(1)).toBe("applied");
    expect(status(2)).toBe("booked");
    expect(note("financial_services", newFs)).toBe("edited offline");
    expect(note("financial_services", onlineFs)).toBeNull();
  });
});

describe("dependants of a likely duplicate", () => {
  async function likelyScenario() {
    const online = bookOnline("sales:process", SALE(), "2026-10-10T10:12:00.000Z");
    const pc = pcCreatedLike(online.created, 1, 1);
    store("sales:process", SALE(), "2026-10-10T10:10:00.000Z", { created: pc });
    store("sales:update-metadata", { id: pc.sales[0], note: "edited offline" }, "2026-10-10T10:11:00.000Z", { dependsOn: [eventId(1)] });
    expect(await run()).toEqual(["held", "held"]);
    return { onlineSale: online.created.sales[0], pcSale: pc.sales[0] };
  }

  it("wait until Apply — then booked onto the applied sale", async () => {
    const { pcSale } = await likelyScenario();
    // the waiting item cannot be applied on its own while its parent is open
    const early = await runWithTenant(1, () => svc().apply(itemOf("waiting").id, 1));
    expect(early.success).toBe(false);
    const r = await runWithTenant(1, () => svc().apply(itemOf("possible_duplicate").id, 1));
    expect(r.success).toBe(true);
    expect(status(1)).toBe("applied");
    expect(status(2)).toBe("booked");
    const newSale = runWithTenant(1, () => new OfflineIdMapRepository().lookup(pcSale))!;
    expect(note("sales", newSale)).toBe("edited offline");
  });

  it("wait until Dismiss — then booked onto the matching (existing) sale", async () => {
    const { onlineSale, pcSale } = await likelyScenario();
    const r = await runWithTenant(1, () => svc().dismiss(itemOf("possible_duplicate").id, 1));
    expect(r.success).toBe(true);
    expect(status(1)).toBe("dismissed");
    expect(runWithTenant(1, () => new OfflineIdMapRepository().lookup(pcSale))).toBe(onlineSale);
    expect(status(2)).toBe("booked");
    expect(note("sales", onlineSale)).toBe("edited offline");
    expect(db.prepare(`SELECT COUNT(*) AS c FROM sales`).get()).toEqual({ c: 1 });
  });
});
