/**
 * LIRA-306 T020 — OfflineOutboxRepository (PC side; SQL in core, rule 13):
 * append, max seq read INSIDE the write transaction, delivery marks, created
 * rows → depends_on lookups.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { OfflineOutboxRepository, type NewOutboxRow } from "../OfflineOutboxRepository";

let db: Database.Database;
const repo = new OfflineOutboxRepository();
beforeEach(() => {
  db = installWarrantyTestDb();
});
afterEach(() => uninstallWarrantyTestDb(db));

const row = (eventId: string, seq: number): NewOutboxRow => ({
  eventId,
  seq,
  channel: "sales:process",
  payloadJson: "{}",
  payloadHash: "h",
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

describe("OfflineOutboxRepository", () => {
  it("maxSeq inside a transaction sees the row appended in the same transaction", () => {
    runWithTenant(1, () => {
      expect(repo.maxSeq()).toBe(0);
      db.transaction(() => {
        repo.append(row("e1", repo.maxSeq() + 1));
        repo.append(row("e2", repo.maxSeq() + 1));
      })();
      expect(repo.maxSeq()).toBe(2);
      expect(repo.listWaiting(10).map((r) => [r.event_id, r.device_seq])).toEqual([
        ["e1", 1],
        ["e2", 2],
      ]);
    });
  });

  it("a rolled-back write leaves no outbox row", () => {
    runWithTenant(1, () => {
      expect(() =>
        db.transaction(() => {
          repo.append(row("e1", 1));
          throw new Error("handler failed");
        })(),
      ).toThrow("handler failed");
      expect(repo.maxSeq()).toBe(0);
    });
  });

  it("marks delivery and server outcome; counts waiting", () => {
    runWithTenant(1, () => {
      repo.append(row("e1", 1));
      repo.append(row("e2", 2));
      repo.markAcked(["e1"]);
      expect(repo.waitingCount()).toBe(1);
      repo.setServerStatus("e1", "booked", null);
      expect(repo.findByEventId("e1")).toMatchObject({ delivery: "done", server_status: "booked" });
      repo.setServerStatus("e2", "held", "waits on e1");
      expect(repo.findByEventId("e2")).toMatchObject({ delivery: "acked", server_status: "held", last_error: "waits on e1" });
    });
  });

  it("records created offline ids and resolves which events created them", () => {
    runWithTenant(1, () => {
      repo.insertCreated([{ offlineId: 1_017_000_000_001, tableName: "clients" }], "e1");
      repo.insertCreated([{ offlineId: 1_023_000_000_001, tableName: "sales" }], "e2");
      expect(repo.eventsCreating([1_017_000_000_001, 1_023_000_000_001, 5])).toEqual(["e1", "e2"]);
      expect(repo.maxCreatedByTable()).toEqual({ clients: 1_017_000_000_001, sales: 1_023_000_000_001 });
    });
  });

  it("is tenant-scoped", () => {
    runWithTenant(1, () => repo.append(row("e1", 1)));
    runWithTenant(2, () => {
      expect(repo.maxSeq()).toBe(0);
      expect(repo.findByEventId("e1")).toBeNull();
    });
  });
});
