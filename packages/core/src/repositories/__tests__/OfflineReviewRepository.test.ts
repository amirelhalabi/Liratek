/**
 * LIRA-306 T020 — OfflineReviewRepository: items, transitions only from open.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { OfflineDeviceRepository } from "../OfflineDeviceRepository";
import { OfflineReviewRepository } from "../OfflineReviewRepository";

let db: Database.Database;
const devices = new OfflineDeviceRepository();
const repo = new OfflineReviewRepository();
let deviceId = 0;
beforeEach(() => {
  db = installWarrantyTestDb();
  deviceId = runWithTenant(1, () =>
    devices.insert({ deviceNo: 1, name: "PC", keyId: "aaaaaaaaaaa1", keyHash: "h", pairedBy: 1 }).id,
  );
});
afterEach(() => uninstallWarrantyTestDb(db));

describe("OfflineReviewRepository", () => {
  it("adds items, lists by state/kind, resolves only from open", () => {
    runWithTenant(1, () => {
      const a = repo.insert({ eventRowId: null, deviceId, kind: "pc_data_mismatch", details: { tables: ["sales"] } });
      repo.insert({ eventRowId: null, deviceId, kind: "rate_changed", details: {} });
      expect(repo.list({ state: "open" })).toHaveLength(2);
      expect(repo.list({ kind: "rate_changed" })).toHaveLength(1);
      expect(repo.findById(a)?.details_json).toBe('{"tables":["sales"]}');
      expect(repo.resolve(a, "dismissed", 1)).toBe(true);
      expect(repo.resolve(a, "applied", 1)).toBe(false);
      expect(repo.findById(a)).toMatchObject({ state: "dismissed", resolved_by: 1 });
      expect(repo.list({ state: "open" })).toHaveLength(1);
    });
  });

  it("is tenant-scoped", () => {
    const a = runWithTenant(1, () => repo.insert({ eventRowId: null, deviceId, kind: "refused", details: {} }));
    runWithTenant(2, () => {
      expect(repo.findById(a)).toBeNull();
      expect(repo.list({})).toEqual([]);
      expect(repo.resolve(a, "dismissed", 1)).toBe(false);
    });
  });
});
