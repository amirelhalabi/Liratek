/**
 * LIRA-306 O-new-29 / FR-018 / R6 — a PC whose numbering is out of step with
 * the server (it lost its saved state: an upload brings a NEW event under a
 * sequence number the server already holds).
 *   - the upload refuses it (SEQ_CONFLICT) and records ONE open item for the PC;
 *   - Settings › Paired PCs shows the PC's conflict in plain words;
 *   - "Renumber this PC's unsent work" (admin) makes the PC's next check-in
 *     answer `renumberUnsent: true` (the PC renumbers every unsent event above
 *     the server's max sequence, keeping event ids — sender.ts), until an
 *     upload from that PC is stored without a conflict;
 *   - renumbering a PC with no conflict is refused.
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import { runWithTenant } from "../../db/tenantContext";
import { OfflineDeviceService } from "../OfflineDeviceService";
import { OfflineEventService } from "../OfflineEventService";
import { COPY_ID, RATES, installReplayDb, uninstallReplayDb, resetSeq } from "../../offline/testHelpers/replayHarness";
import type { offlineEventSchema } from "../../validators/offline";

let db: Database.Database;
let deviceId = 0;
const devices = () => new OfflineDeviceService({ mobileAuth: { loginWithShop: async () => ({ ok: false, reason: "x" }) as never }, auth: { logout: () => undefined }, serverSchemaVersion: () => 210 });
const events = () => new OfflineEventService({ serverSchemaVersion: () => 210 });

beforeEach(() => {
  resetSeq();
  ({ db, deviceId } = installReplayDb());
});
afterEach(() => uninstallReplayDb(db));

const ev = (seq: number, id: number): z.input<typeof offlineEventSchema> => ({
  eventId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  seq,
  channel: "sales:update-metadata",
  payload: { id: 1, note: `n${id}` },
  actorUserId: 2,
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  clientDay: "2026-10-10",
  clientTzOffsetMinutes: 180,
  copyId: COPY_ID,
  schemaShape: { type: "object" },
  rates: RATES,
  created: {},
  dependsOn: [],
});
const upload = (list: Array<z.input<typeof offlineEventSchema>>) =>
  runWithTenant(1, () => events().upload(deviceId, { appVersion: "1", schemaVersion: 210, pcClock: new Date().toISOString(), events: list }));
const checkin = () =>
  runWithTenant(1, () => devices().checkin(deviceId, { state: "offline", pendingCount: 1, appVersion: "1", schemaVersion: 210, pcClock: new Date().toISOString() }));
const mine = () => runWithTenant(1, () => devices().listDevices()).data.devices.find((d) => d.id === deviceId)!;

describe("sequence conflict on the Paired PCs panel", () => {
  it("is recorded once, shown in plain words, and Renumber makes the PC renumber until it uploads cleanly", () => {
    upload([ev(1, 1), ev(2, 2)]);
    expect(mine().seqConflict).toBeNull();
    // the PC lost its state: new events under seq 1 and 2
    expect(upload([ev(1, 11), ev(2, 12)]).data!.rejected.map((r) => r.code)).toEqual(["SEQ_CONFLICT", "SEQ_CONFLICT"]);
    upload([ev(1, 11)]); // the PC retries: still ONE open conflict
    expect(db.prepare(`SELECT COUNT(*) AS c FROM offline_review_items WHERE state = 'open'`).get()).toEqual({ c: 1 });
    const shown = mine().seqConflict!;
    expect(shown).toMatchObject({ seq: 1 });
    expect(shown.reason).toMatch(/numbering is out of step/i);
    expect(mine().renumberRequested).toBe(false);
    expect(checkin().data!.renumberUnsent).toBe(false);

    expect(runWithTenant(1, () => devices().requestRenumber(deviceId, 1))).toEqual({ success: true, data: { renumberRequested: true } });
    expect(mine().seqConflict).toBeNull();
    expect(mine().renumberRequested).toBe(true);
    expect(checkin().data!.renumberUnsent).toBe(true);
    expect(checkin().data!.renumberUnsent).toBe(true); // until the PC complies

    // the PC renumbered above the server's max (2) and uploads cleanly
    expect(upload([ev(3, 11), ev(4, 12)]).data!.rejected).toEqual([]);
    expect(checkin().data!.renumberUnsent).toBe(false);
    expect(mine().renumberRequested).toBe(false);
  });

  it("renumbering a PC with no conflict is refused", () => {
    expect(runWithTenant(1, () => devices().requestRenumber(deviceId, 1))).toMatchObject({ success: false, code: "NO_CONFLICT" });
    expect(runWithTenant(1, () => devices().requestRenumber(99999, 1))).toMatchObject({ success: false, code: "NOT_FOUND" });
  });
});
