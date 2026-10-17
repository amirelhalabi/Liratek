/**
 * LIRA-332 US5 (FR-019, owner decision D-332-A) — a paired PC's events and
 * an ENDED free trial.
 *
 *  - Events stamped (by `corrected_at ?? occurred_at`) BEFORE the end are
 *    booked as usual, whenever they are uploaded.
 *  - Events stamped AT or AFTER the end are HELD: left `received`, not
 *    booked, not refused, no review item; the PC's cursor stops at the first
 *    held event. They book on the first round after the owner activates or
 *    extends (trialEndFor → null).
 *  - A held PC never blocks another PC's pre-end events.
 *  - The N5 manifest still matches while events are held (held events
 *    explain their rows), so the PC is not stuck in "finishing".
 *
 * Failing-first: the hold cases were run before the merge processor knew
 * about trials and failed (every event booked, cursor at the end).
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { getDatabase } from "../../db/connection";
import { OfflineMergeProcessor } from "../OfflineMergeProcessor";
import { OfflineEventService } from "../OfflineEventService";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { ReplayEngine } from "../../offline/ReplayEngine";
import type { OfflineBinding } from "../../offline/bindings/types";
import { encodeOfflineId, offlineTableIndex } from "../../offline/idRange";
import { COPY_ID, addDevice, installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../../offline/testHelpers/replayHarness";

const CH = "sales:update-metadata";
const END = Date.parse("2026-11-01T22:00:00.000Z"); // 00:00 Beirut, 11-02
let trialEnd: number | null = END;
let db: Database.Database;
let pc1 = 0;
let pc2 = 0;
const order: string[] = [];
const binding: OfflineBinding = {
  channel: CH,
  run: (p) => {
    const tag = String(p.note);
    order.push(tag);
    getDatabase().prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, ?)`).run(tag);
    return { success: true };
  },
};
const round = () =>
  new OfflineMergeProcessor({
    engine: new ReplayEngine({ bindings: () => binding, duplicateHook: () => undefined }),
    trialEndFor: () => trialEnd,
  }).runRound(1);

let n = 0;
const ev = (deviceId: number, tag: string, seq: number, iso: string, correctedAt: string | null = null) =>
  storeEvent({
    deviceId,
    channel: CH,
    payload: { id: 1, note: tag },
    seq,
    eventId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    occurredAt: iso,
    correctedAt,
    created: { clients: [encodeOfflineId(1, offlineTableIndex("clients"), n)] },
  });

const statusOf = (deviceId: number, seq: number) =>
  (db
    .prepare(`SELECT status FROM offline_events WHERE device_id = ? AND device_seq = ?`)
    .get(deviceId, seq) as { status: string }).status;
const nextSeq = (deviceId: number) =>
  (db.prepare(`SELECT next_expected_seq FROM offline_devices WHERE id = ?`).get(deviceId) as {
    next_expected_seq: number;
  }).next_expected_seq;
const reviewItems = () => runWithTenant(1, () => new OfflineReviewRepository().list({}));

beforeEach(() => {
  resetSeq();
  n = 0;
  order.length = 0;
  trialEnd = END;
  ({ db, deviceId: pc1 } = installReplayDb());
  pc2 = addDevice(2);
});
afterEach(() => uninstallReplayDb(db));

describe("OfflineMergeProcessor — ended free trial (D-332-A)", () => {
  it("books pre-end events, holds post-end ones, cursor at the first held", async () => {
    ev(pc1, "P1.1", 1, "2026-11-01T20:00:00.000Z");
    ev(pc1, "P1.2", 2, "2026-11-01T21:59:59.000Z");
    ev(pc1, "P1.3", 3, "2026-11-01T22:00:00.000Z");
    ev(pc1, "P1.4", 4, "2026-11-02T08:00:00.000Z");
    await round();
    expect(order).toEqual(["P1.1", "P1.2"]);
    expect([1, 2, 3, 4].map((s) => statusOf(pc1, s))).toEqual(["booked", "booked", "received", "received"]);
    expect(nextSeq(pc1)).toBe(3);
    expect(reviewItems()).toEqual([]);
  });

  it("the corrected instant decides, not the PC's own clock", async () => {
    // Recorded before the end by a slow clock, really after it → held.
    ev(pc1, "P1.1", 1, "2026-11-01T21:50:00.000Z", "2026-11-01T22:10:00.000Z");
    await round();
    expect(order).toEqual([]);
    expect(statusOf(pc1, 1)).toBe("received");
  });

  it("after activation (no end) the next round books the held events, in order", async () => {
    ev(pc1, "P1.1", 1, "2026-11-01T20:00:00.000Z");
    ev(pc1, "P1.2", 2, "2026-11-02T08:00:00.000Z");
    ev(pc1, "P1.3", 3, "2026-11-02T09:00:00.000Z");
    await round();
    expect(order).toEqual(["P1.1"]);
    trialEnd = null;
    await round();
    expect(order).toEqual(["P1.1", "P1.2", "P1.3"]);
    expect(nextSeq(pc1)).toBe(4);
  });

  it("a held PC never blocks another PC's pre-end events", async () => {
    ev(pc1, "P1.1", 1, "2026-11-02T08:00:00.000Z"); // held
    ev(pc2, "P2.1", 1, "2026-11-01T10:00:00.000Z");
    ev(pc2, "P2.2", 2, "2026-11-01T21:00:00.000Z");
    await round();
    expect(order).toEqual(["P2.1", "P2.2"]);
    expect(statusOf(pc1, 1)).toBe("received");
  });

  it("an event uploaded after the end but stamped before it is booked (FR-019)", async () => {
    await round(); // a round after the end, nothing yet
    ev(pc1, "P1.1", 1, "2026-11-01T21:30:00.000Z"); // arrives now
    await round();
    expect(order).toEqual(["P1.1"]);
  });

  it("the manifest still matches while events are held", async () => {
    ev(pc1, "P1.1", 1, "2026-11-01T20:00:00.000Z");
    ev(pc1, "P1.2", 2, "2026-11-02T08:00:00.000Z"); // held
    await round();
    const r = runWithTenant(1, () =>
      new OfflineEventService({ serverSchemaVersion: () => 210 }).compareManifest(pc1, {
        copyId: COPY_ID,
        tables: {
          clients: [
            encodeOfflineId(1, offlineTableIndex("clients"), 1),
            encodeOfflineId(1, offlineTableIndex("clients"), 2),
          ],
        },
        readWrites: [],
      }),
    );
    expect(r).toEqual({ success: true, data: { matched: true, unexplained: [] } });
    expect(reviewItems().filter((i) => i.kind === "pc_data_mismatch")).toEqual([]);
  });
});
