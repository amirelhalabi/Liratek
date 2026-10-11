/**
 * LIRA-306 T020 — OfflineEventRepository: idempotent insert by event id with a
 * payload-hash check, SEQ_CONFLICT on (device, seq) with another id, outcome
 * updates, tenant scoping.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { OfflineDeviceRepository } from "../OfflineDeviceRepository";
import { OfflineEventRepository, type NewOfflineEventRow } from "../OfflineEventRepository";

let db: Database.Database;
const devices = new OfflineDeviceRepository();
const repo = new OfflineEventRepository();
let deviceId = 0;
beforeEach(() => {
  db = installWarrantyTestDb();
  deviceId = runWithTenant(1, () =>
    devices.insert({ deviceNo: 1, name: "PC", keyId: "aaaaaaaaaaa1", keyHash: "h", pairedBy: 1 }).id,
  );
});
afterEach(() => uninstallWarrantyTestDb(db));

const row = (eventId: string, seq: number, hash = "h1"): NewOfflineEventRow => ({
  deviceId,
  eventId,
  seq,
  channel: "sales:process",
  payloadJson: "{}",
  payloadHash: hash,
  actorUserId: 1,
  occurredAt: "2026-10-10T20:50:00.000Z",
  clientDay: "2026-10-10",
  clientTzOffsetMinutes: 180,
  copyId: "c",
  appVersion: "1.0",
  schemaVersion: 210,
  schemaShapeJson: "{}",
  ratesJson: "{}",
  createdJson: "{}",
  dependsOnJson: "[]",
});

describe("OfflineEventRepository", () => {
  it("inserts received, and a resend with the same payload is a duplicate (one row)", () => {
    runWithTenant(1, () => {
      expect(repo.insertReceived(row("e1", 1)).outcome).toBe("inserted");
      expect(repo.insertReceived(row("e1", 1)).outcome).toBe("duplicate");
      expect(repo.listForDevice(deviceId, 0)).toHaveLength(1);
      expect(repo.findByEventId("e1")?.status).toBe("received");
    });
  });

  it("same event id with another payload → reused (not stored)", () => {
    runWithTenant(1, () => {
      repo.insertReceived(row("e1", 1, "h1"));
      expect(repo.insertReceived(row("e1", 1, "h2")).outcome).toBe("reused");
    });
  });

  it("same (device, seq) with another event id → seq_conflict (not stored)", () => {
    runWithTenant(1, () => {
      repo.insertReceived(row("e1", 1));
      expect(repo.insertReceived(row("e2", 1)).outcome).toBe("seq_conflict");
      expect(repo.findByEventId("e2")).toBeNull();
    });
  });

  it("stores a refused event so the sequence stays gap-free", () => {
    runWithTenant(1, () => {
      const r = repo.insertReceived(row("e1", 1), { status: "refused", error: "unknown channel" });
      expect(r.outcome).toBe("inserted");
      expect(repo.findByEventId("e1")).toMatchObject({ status: "refused", error: "unknown channel" });
    });
  });

  it("updates outcomes and attempts; lists by device from a seq; max seq", () => {
    runWithTenant(1, () => {
      const a = repo.insertReceived(row("e1", 1)).row!;
      repo.insertReceived(row("e2", 2));
      repo.incrementAttempts(a.id, "boom");
      expect(repo.findById(a.id)).toMatchObject({ attempts: 1, error: "boom", status: "received" });
      repo.updateOutcome(a.id, { status: "booked", resultJson: '{"ok":1}', error: null, correctedAt: "2026-10-10T20:50:00.000Z" });
      expect(repo.findById(a.id)).toMatchObject({ status: "booked", result_json: '{"ok":1}' });
      expect(repo.findById(a.id)?.processed_at).toBeTruthy();
      expect(repo.listForDevice(deviceId, 2).map((e) => e.event_id)).toEqual(["e2"]);
      expect(repo.maxSeq(deviceId)).toBe(2);
      expect(repo.findBySeq(deviceId, 2)?.event_id).toBe("e2");
      expect(repo.devicesWithReceived()).toEqual([deviceId]);
    });
  });

  it("is tenant-scoped", () => {
    runWithTenant(1, () => repo.insertReceived(row("e1", 1)));
    runWithTenant(2, () => {
      expect(repo.findByEventId("e1")).toBeNull();
      expect(repo.listForDevice(deviceId, 0)).toEqual([]);
      expect(repo.devicesWithReceived()).toEqual([]);
    });
  });
});
