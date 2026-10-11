/**
 * LIRA-306 T020 — OfflineIdMapRepository: unique per tenant, lookups, per-table
 * maxima for a PC (check-in seeding, FR-008a).
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { OfflineDeviceRepository } from "../OfflineDeviceRepository";
import { OfflineIdMapRepository } from "../OfflineIdMapRepository";

let db: Database.Database;
const devices = new OfflineDeviceRepository();
const repo = new OfflineIdMapRepository();
let deviceId = 0;
beforeEach(() => {
  db = installWarrantyTestDb();
  deviceId = runWithTenant(1, () =>
    devices.insert({ deviceNo: 1, name: "PC", keyId: "aaaaaaaaaaa1", keyHash: "h", pairedBy: 1 }).id,
  );
});
afterEach(() => uninstallWarrantyTestDb(db));

describe("OfflineIdMapRepository", () => {
  it("maps, looks up and refuses a second mapping of the same offline id", () => {
    runWithTenant(1, () => {
      repo.insert({ offlineId: 1_017_000_000_001, deviceId, tableName: "clients", serverId: 512, eventId: "e1" });
      expect(repo.lookup(1_017_000_000_001)).toBe(512);
      expect(repo.lookup(1_017_000_000_002)).toBeUndefined();
      expect(() =>
        repo.insert({ offlineId: 1_017_000_000_001, deviceId, tableName: "clients", serverId: 513, eventId: "e2" }),
      ).toThrow();
      expect(repo.findRow(1_017_000_000_001)).toMatchObject({ link_kind: "created", event_id: "e1" });
    });
  });

  it("keeps linked_existing links and reports per-table maxima for a PC", () => {
    runWithTenant(1, () => {
      repo.insert({ offlineId: 1_017_000_000_003, deviceId, tableName: "clients", serverId: 9, eventId: "e1", linkKind: "linked_existing" });
      repo.insert({ offlineId: 1_017_000_000_001, deviceId, tableName: "clients", serverId: 7, eventId: "e1" });
      repo.insert({ offlineId: 1_023_000_000_004, deviceId, tableName: "sales", serverId: 8, eventId: "e2" });
      expect(repo.maxOfflineIdsByTable(deviceId)).toEqual({ clients: 1_017_000_000_003, sales: 1_023_000_000_004 });
    });
  });

  it("is tenant-scoped", () => {
    runWithTenant(1, () =>
      repo.insert({ offlineId: 1_017_000_000_001, deviceId, tableName: "clients", serverId: 512, eventId: "e1" }),
    );
    runWithTenant(2, () => {
      expect(repo.lookup(1_017_000_000_001)).toBeUndefined();
      expect(repo.maxOfflineIdsByTable(deviceId)).toEqual({});
    });
  });
});
