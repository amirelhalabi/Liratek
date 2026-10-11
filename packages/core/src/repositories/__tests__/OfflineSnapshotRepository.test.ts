/**
 * LIRA-306 T020 — OfflineSnapshotRepository: copies served to PCs.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { OfflineSnapshotRepository } from "../OfflineSnapshotRepository";

let db: Database.Database;
const repo = new OfflineSnapshotRepository();
beforeEach(() => {
  db = installWarrantyTestDb();
});
afterEach(() => uninstallWarrantyTestDb(db));

describe("OfflineSnapshotRepository", () => {
  it("records a copy and reads its high-water marks back", () => {
    runWithTenant(1, () => {
      repo.insert({ copyId: "c1", deviceId: null, schemaVersion: 210, builtAt: "2026-10-10T20:00:00.000Z", highWater: { sales: 10, clients: 4 } });
      expect(repo.findByCopyId("c1")).toMatchObject({ copy_id: "c1", schema_version: 210, highWater: { sales: 10, clients: 4 } });
      expect(repo.findByCopyId("nope")).toBeNull();
      expect(repo.latest()?.copy_id).toBe("c1");
    });
  });

  it("is tenant-scoped", () => {
    runWithTenant(1, () =>
      repo.insert({ copyId: "c1", deviceId: null, schemaVersion: 210, builtAt: "2026-10-10T20:00:00.000Z", highWater: {} }),
    );
    runWithTenant(2, () => {
      expect(repo.findByCopyId("c1")).toBeNull();
      expect(repo.latest()).toBeNull();
    });
  });
});
