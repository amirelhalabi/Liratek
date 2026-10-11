/**
 * LIRA-306 T031 — OfflineEventService.upload (FR-015, FR-016, FR-024):
 * store-then-ack, idempotent resend, EVENT_ID_REUSED, SEQ_CONFLICT (not
 * stored), unknown / non-recordable channel stored as refused and acked (the
 * PC's sequence stays gap-free), VERSION_AHEAD for the whole upload, older
 * versions accepted. Event fields come from the schema input type (rule 24).
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import { runWithTenant } from "../../db/tenantContext";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../../repositories/testHelpers/warrantyDb";
import { OfflineDeviceRepository } from "../../repositories/OfflineDeviceRepository";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineEventService } from "../OfflineEventService";
import type { offlineEventSchema, uploadEventsSchema } from "../../validators/offline";

const SERVER_SCHEMA = 210;
let db: Database.Database;
let deviceId = 0;
const service = new OfflineEventService({ serverSchemaVersion: () => SERVER_SCHEMA });
const events = new OfflineEventRepository();

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const COPY = "11111111-1111-4111-8111-111111111111";

function ev(n: number, over: Partial<z.input<typeof offlineEventSchema>> = {}): z.input<typeof offlineEventSchema> {
  return {
    eventId: uuid(n),
    seq: n,
    channel: "sales:process",
    payload: { items: [], n },
    actorUserId: 1,
    occurredAt: "2026-10-10T20:50:00.000Z",
    clientDay: "2026-10-10",
    clientTzOffsetMinutes: 180,
    copyId: COPY,
    schemaShape: { type: "object" },
    rates: { LBP: { sell: 90000, buy: 89500, market: 89750, direction: 1 } },
    created: {},
    dependsOn: [],
    ...over,
  };
}

function batch(list: Array<z.input<typeof offlineEventSchema>>, schemaVersion = SERVER_SCHEMA): z.input<typeof uploadEventsSchema> {
  return { appVersion: "1.0.0", schemaVersion, pcClock: new Date().toISOString(), events: list };
}

beforeEach(() => {
  db = installWarrantyTestDb();
  deviceId = runWithTenant(1, () =>
    new OfflineDeviceRepository().insert({ deviceNo: 1, name: "PC", keyId: "aaaaaaaaaaa1", keyHash: "h", pairedBy: 1 }).id,
  );
});
afterEach(() => uninstallWarrantyTestDb(db));

const upload = (b: z.input<typeof uploadEventsSchema>) => runWithTenant(1, () => service.upload(deviceId, b));

describe("OfflineEventService.upload", () => {
  it("stores events as received and acks them", () => {
    const r = upload(batch([ev(1), ev(2)]));
    expect(r).toEqual({ success: true, data: { acked: [uuid(1), uuid(2)], rejected: [] } });
    runWithTenant(1, () => expect(events.listForDevice(deviceId, 0).map((e) => e.status)).toEqual(["received", "received"]));
  });

  it("a resend stores nothing new and acks again (one row per event)", () => {
    upload(batch([ev(1)]));
    const r = upload(batch([ev(1)]));
    expect(r.data?.acked).toEqual([uuid(1)]);
    runWithTenant(1, () => expect(events.listForDevice(deviceId, 0)).toHaveLength(1));
  });

  it("same event id with a different payload → EVENT_ID_REUSED", () => {
    upload(batch([ev(1)]));
    const r = upload(batch([ev(1, { payload: { changed: true } })]));
    expect(r.data?.rejected).toEqual([expect.objectContaining({ eventId: uuid(1), code: "EVENT_ID_REUSED" })]);
  });

  it("same (PC, seq) with another event id → SEQ_CONFLICT, not stored", () => {
    upload(batch([ev(1)]));
    const r = upload(batch([ev(99, { seq: 1 })]));
    expect(r.data?.rejected).toEqual([expect.objectContaining({ eventId: uuid(99), code: "SEQ_CONFLICT" })]);
    runWithTenant(1, () => expect(events.findByEventId(uuid(99))).toBeNull());
  });

  it("an unknown or non-recordable channel is stored as refused, acked, and goes on the review list", () => {
    const r = upload(batch([ev(1, { channel: "no:such" }), ev(2, { channel: "settings:update" })]));
    expect(r.data?.acked).toEqual([uuid(1), uuid(2)]);
    runWithTenant(1, () => {
      expect(events.findByEventId(uuid(1))).toMatchObject({ status: "refused", error: expect.stringMatching(/UNKNOWN_CHANNEL/) });
      expect(events.findByEventId(uuid(2))).toMatchObject({ status: "refused", error: expect.stringMatching(/NOT_RECORDABLE/) });
      expect(new OfflineReviewRepository().list({ kind: "refused" })).toHaveLength(2);
    });
  });

  it("a PC data version newer than the server's refuses the whole upload", () => {
    const r = upload(batch([ev(1)], SERVER_SCHEMA + 1));
    expect(r).toMatchObject({ success: false, code: "VERSION_AHEAD" });
    runWithTenant(1, () => expect(events.listForDevice(deviceId, 0)).toHaveLength(0));
  });

  it("an older PC data version is accepted", () => {
    expect(upload(batch([ev(1)], SERVER_SCHEMA - 3)).success).toBe(true);
  });

  it("statusSince returns outcomes from a sequence number", () => {
    upload(batch([ev(1), ev(2)]));
    const s = runWithTenant(1, () => service.statusSince(deviceId, 2));
    expect(s.data?.outcomes).toEqual([{ eventId: uuid(2), seq: 2, status: "received", error: null, serverIds: null }]);
  });
});
