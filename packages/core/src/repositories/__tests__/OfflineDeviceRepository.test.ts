/**
 * LIRA-306 T020 — OfflineDeviceRepository (real schema, two tenants).
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { OfflineDeviceRepository } from "../OfflineDeviceRepository";

let db: Database.Database;
const repo = new OfflineDeviceRepository();
beforeEach(() => {
  db = installWarrantyTestDb();
});
afterEach(() => uninstallWarrantyTestDb(db));

const pair = (keyId: string, name = "PC") =>
  repo.insert({ deviceNo: repo.nextDeviceNo(), name, keyId, keyHash: "h", pairedBy: 1 });

describe("OfflineDeviceRepository", () => {
  it("numbers PCs max+1 per tenant and never reuses a revoked number", () => {
    runWithTenant(1, () => {
      expect(pair("aaaaaaaaaaa1").device_no).toBe(1);
      const two = pair("aaaaaaaaaaa2");
      expect(two.device_no).toBe(2);
      repo.revoke(two.id, 1);
      expect(repo.nextDeviceNo()).toBe(3);
    });
    runWithTenant(2, () => expect(pair("bbbbbbbbbbb1").device_no).toBe(1));
  });

  it("is tenant-scoped: another shop's device is invisible", () => {
    const id = runWithTenant(1, () => pair("aaaaaaaaaaa1").id);
    runWithTenant(2, () => {
      expect(repo.findById(id)).toBeNull();
      expect(repo.findByKeyId("aaaaaaaaaaa1")).toBeNull();
      expect(repo.list()).toEqual([]);
    });
    runWithTenant(1, () => expect(repo.findByKeyId("aaaaaaaaaaa1")?.id).toBe(id));
  });

  it("re-key keeps device_no and next_expected_seq, clears revoked", () => {
    runWithTenant(1, () => {
      const d = pair("aaaaaaaaaaa1");
      repo.setNextExpectedSeq(d.id, 42);
      repo.revoke(d.id, 1);
      const r = repo.rekey(d.id, { keyId: "aaaaaaaaaaa9", keyHash: "h2", pairedBy: 1 });
      expect(r).toMatchObject({ id: d.id, device_no: 1, next_expected_seq: 42, key_id: "aaaaaaaaaaa9", revoked_at: null });
      expect(repo.findByKeyId("aaaaaaaaaaa1")).toBeNull();
    });
  });

  it("records a check-in; the standby skew is kept as the pre-outage reference", () => {
    runWithTenant(1, () => {
      const d = pair("aaaaaaaaaaa1");
      repo.recordCheckin(d.id, { state: "standby", pendingCount: 0, appVersion: "1.0", schemaVersion: 210, skewMs: 1500 });
      repo.recordCheckin(d.id, { state: "offline", pendingCount: 3, appVersion: "1.0", schemaVersion: 210, skewMs: 9000 });
      expect(repo.findById(d.id)).toMatchObject({
        last_state: "offline",
        last_pending_count: 3,
        last_skew_ms: 9000,
        last_online_skew_ms: 1500,
        last_schema_version: 210,
      });
      expect(repo.findById(d.id)?.last_seen_at).toBeTruthy();
    });
  });
});
