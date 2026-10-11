/**
 * LIRA-306 T052 — the cross-PC merge (FR-017, R5, plan §D).
 *
 * Candidates are each PC's NEXT expected event; the one with the smallest
 * corrected instant goes first (ties: PC number, then sequence). A PC's own
 * order always wins over its clock; a late PC is processed when it arrives,
 * at its own times; a sequence conflict stops only that PC.
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import { runWithTenant } from "../../db/tenantContext";
import { getDatabase } from "../../db/connection";
import { requestNow } from "../../utils/requestNow";
import { clientDay } from "../../utils/requestDay";
import { OfflineMergeProcessor } from "../OfflineMergeProcessor";
import { OfflineEventService } from "../OfflineEventService";
import { ReplayEngine } from "../../offline/ReplayEngine";
import type { OfflineBinding } from "../../offline/bindings/types";
import { RATES, COPY_ID, addDevice, installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../../offline/testHelpers/replayHarness";
import type { offlineEventSchema, uploadEventsSchema } from "../../validators/offline";

const CH = "sales:update-metadata";
let db: Database.Database;
let pc1 = 0;
let pc2 = 0;
const order: string[] = [];
const bookedAt: Record<string, string> = {};
const bookedDay: Record<string, string> = {};
const binding: OfflineBinding = {
  channel: CH,
  run: (p) => {
    const tag = String(p.note);
    order.push(tag);
    bookedAt[tag] = requestNow();
    bookedDay[tag] = clientDay();
    getDatabase().prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, ?)`).run(tag);
    return { success: true };
  },
};
const round = () => new OfflineMergeProcessor({ engine: new ReplayEngine({ bindings: () => binding, duplicateHook: () => undefined }) }).runRound(1);

let n = 0;
const ev = (deviceId: number, tag: string, seq: number, hhmm: string, correctedAt: string | null = null) =>
  storeEvent({
    deviceId,
    channel: CH,
    payload: { id: 1, note: tag },
    seq,
    eventId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    occurredAt: `2026-10-10T${hhmm}:00.000Z`,
    correctedAt,
  });

beforeEach(() => {
  resetSeq();
  n = 0;
  order.length = 0;
  for (const k of Object.keys(bookedAt)) delete bookedAt[k];
  ({ db, deviceId: pc1 } = installReplayDb());
  pc2 = addDevice(2);
});
afterEach(() => uninstallReplayDb(db));

describe("OfflineMergeProcessor — several PCs (plan §D)", () => {
  it("earliest head first; PC 2's backward clock jump keeps its own order", async () => {
    ev(pc1, "P1.1", 1, "10:10");
    ev(pc1, "P1.2", 2, "10:12");
    ev(pc1, "P1.3", 3, "10:15");
    ev(pc1, "P1.4", 4, "10:20");
    ev(pc2, "P2.1", 1, "10:11");
    ev(pc2, "P2.2", 2, "10:13");
    ev(pc2, "P2.3", 3, "10:09");
    await round();
    expect(order).toEqual(["P1.1", "P2.1", "P1.2", "P2.2", "P2.3", "P1.3", "P1.4"]);
  });

  it("orders by the CORRECTED instant when one is stored", async () => {
    ev(pc1, "P1.1", 1, "10:10");
    // PC 2's clock was 5 min slow: recorded 10:06, really 10:11
    ev(pc2, "P2.1", 1, "10:06", "2026-10-10T10:11:00.000Z");
    ev(pc1, "P1.2", 2, "10:12");
    await round();
    expect(order).toEqual(["P1.1", "P2.1", "P1.2"]);
    expect(bookedAt["P2.1"]).toBe("2026-10-10 10:11:00");
  });

  it("a correction past midnight moves the booking DAY too (rule 27, FR-022)", async () => {
    // recorded 23:50 Beirut on the 10th; the PC was 20 min slow → 00:10 on the 11th
    ev(pc1, "P1.1", 1, "20:50", "2026-10-10T21:10:00.000Z");
    await round();
    expect(bookedAt["P1.1"]).toBe("2026-10-10 21:10:00");
    expect(bookedDay["P1.1"]).toBe("2026-10-11");
  });

  it("a late PC is processed when it arrives, at its own original times", async () => {
    ev(pc1, "P1.1", 1, "10:10");
    ev(pc1, "P1.2", 2, "10:20");
    await round();
    expect(order).toEqual(["P1.1", "P1.2"]);
    ev(pc2, "P2.1", 1, "10:05");
    await round();
    expect(order).toEqual(["P1.1", "P1.2", "P2.1"]);
    expect(bookedAt["P2.1"]).toBe("2026-10-10 10:05:00");
  });

  it("ties: PC number first (not the row id), then sequence", async () => {
    db.prepare(`UPDATE offline_devices SET device_no = 7 WHERE id = ?`).run(pc2);
    const pc3 = addDevice(3); // higher row id, lower PC number than pc2
    ev(pc2, "P7.1", 1, "10:10");
    ev(pc3, "P3.1", 1, "10:10");
    ev(pc1, "P1.1", 1, "10:10");
    await round();
    expect(order).toEqual(["P1.1", "P3.1", "P7.1"]);
  });

  it("a gap stops only that PC", async () => {
    ev(pc1, "P1.1", 1, "10:10");
    ev(pc2, "P2.1", 1, "10:11");
    ev(pc2, "P2.3", 3, "10:12");
    ev(pc1, "P1.2", 2, "10:13");
    await round();
    expect(order).toEqual(["P1.1", "P2.1", "P1.2"]);
  });

  it("SEQ_CONFLICT stops only that PC: the rest of its upload is not stored, the other PC carries on", async () => {
    const svc = new OfflineEventService({ serverSchemaVersion: () => 210 });
    const event = (seq: number, id: number, tag: string): z.input<typeof offlineEventSchema> => ({
      eventId: `00000000-0000-4000-8000-${String(900 + id).padStart(12, "0")}`,
      seq,
      channel: CH,
      payload: { id: 1, note: tag },
      actorUserId: 2,
      occurredAt: "2026-10-10T10:30:00.000Z",
      clientDay: "2026-10-10",
      clientTzOffsetMinutes: 180,
      copyId: COPY_ID,
      schemaShape: { type: "object" },
      rates: RATES,
      created: {},
      dependsOn: [],
    });
    const batch = (events: Array<z.input<typeof offlineEventSchema>>): z.input<typeof uploadEventsSchema> => ({
      appVersion: "1.0.0",
      schemaVersion: 210,
      pcClock: new Date().toISOString(),
      events,
    });
    ev(pc2, "P2.1", 1, "10:11");
    ev(pc1, "P1.1", 1, "10:10");
    // PC 2 lost its state: a NEW event under seq 1, then seq 2
    const r = runWithTenant(1, () => svc.upload(pc2, batch([event(1, 1, "X1"), event(2, 2, "X2")])));
    expect(r.data?.rejected.map((x) => x.code)).toEqual(["SEQ_CONFLICT", "SEQ_CONFLICT"]);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM offline_events WHERE device_id = ?`).get(pc2)).toEqual({ c: 1 });
    await round();
    expect(order).toEqual(["P1.1", "P2.1"]);
  });
});
