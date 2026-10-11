/**
 * LIRA-306 T055 — the upload measures the PC's clock and stores the
 * corrected instant + a `clock_corrected` note (FR-022). Written after the
 * wiring (skew.ts itself was failing-first in skew.test.ts) — not proven
 * failing-first.
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import { runWithTenant } from "../../db/tenantContext";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineEventService } from "../OfflineEventService";
import { COPY_ID, RATES, insertCopy, installReplayDb, uninstallReplayDb } from "../../offline/testHelpers/replayHarness";
import type { offlineEventSchema } from "../../validators/offline";

let db: Database.Database;
let deviceId = 0;
beforeEach(() => ({ db, deviceId } = installReplayDb()));
afterEach(() => uninstallReplayDb(db));

const ev = (seq: number, occurredAt: string): z.input<typeof offlineEventSchema> => ({
  eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
  seq,
  channel: "sales:update-metadata",
  payload: { id: 1, note: "x" },
  actorUserId: 2,
  occurredAt,
  clientDay: occurredAt.slice(0, 10),
  clientTzOffsetMinutes: 180,
  copyId: COPY_ID,
  schemaShape: { type: "object" },
  rates: RATES,
  created: {},
  dependsOn: [],
});

describe("OfflineEventService.upload — PC clock", () => {
  it("a PC clock 10 min slow: corrected instant stored, one note", () => {
    const now = Date.now();
    const pcClock = new Date(now - 10 * 60_000).toISOString();
    const occurredAt = new Date(now - 40 * 60_000).toISOString();
    insertCopy(new Date(now - 3 * 3600_000).toISOString(), {});
    runWithTenant(1, () =>
      new OfflineEventService({ serverSchemaVersion: () => 210 }).upload(deviceId, {
        appVersion: "1.0.0",
        schemaVersion: 210,
        pcClock,
        events: [ev(1, occurredAt)],
      }),
    );
    runWithTenant(1, () => {
      const row = new OfflineEventRepository().findBySeq(deviceId, 1)!;
      expect(Math.abs(Date.parse(row.corrected_at!) - (Date.parse(occurredAt) + 10 * 60_000))).toBeLessThan(5_000);
      const notes = new OfflineReviewRepository().listForEvent(row.id);
      expect(notes.map((n) => n.kind)).toEqual(["clock_corrected"]);
      expect(JSON.parse(notes[0].details_json).text).toMatch(/10 min slow/);
    });
  });

  it("a correct clock: nothing stored, no note", () => {
    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    runWithTenant(1, () =>
      new OfflineEventService({ serverSchemaVersion: () => 210 }).upload(deviceId, {
        appVersion: "1.0.0",
        schemaVersion: 210,
        pcClock: new Date().toISOString(),
        events: [ev(1, occurredAt)],
      }),
    );
    runWithTenant(1, () => {
      const row = new OfflineEventRepository().findBySeq(deviceId, 1)!;
      expect(row.corrected_at).toBeNull();
      expect(new OfflineReviewRepository().listForEvent(row.id)).toEqual([]);
    });
  });
});
