/**
 * LIRA-377 T044 — paired PCs during and after a shop restore.
 *   - while the shop's file is being swapped the pool throws
 *     ShopRestoringError: the PC must hear SHOP_RESTORING (retry), never
 *     INVALID_DEVICE_KEY (which tells it to re-pair);
 *   - check-in carries the shop's latest finished restore so a PC can drop
 *     its copy and show the banner.
 * Harness from OfflineDeviceService.suspendedShop.test.ts.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { ShopRestoringError } from "../../db/tenantDatabasePool";
import { OfflineDeviceService } from "../OfflineDeviceService";
import { OfflineDeviceRepository } from "../../repositories/OfflineDeviceRepository";
import { ShopRestoresRepository } from "../../repositories/ShopRestoresRepository";
import { installReplayDb, uninstallReplayDb, resetSeq } from "../../offline/testHelpers/replayHarness";

let db: Database.Database;
let deviceId = 0;

const mobileAuth = {
  loginWithShop: async () => ({
    ok: true as const,
    user: { id: 1, username: "admin", role: "admin", tenant_id: 1 } as never,
    sessionToken: "tok-1",
    shop: { id: 1, slug: "default", name: "Default" },
  }),
};
const auth = { logout: async () => undefined };
const PAIR = { shop: "default", username: "admin", password: "pw", deviceName: "Front PC" };
const CHECKIN = { state: "standby" as const, pendingCount: 0, appVersion: "1.0.0", schemaVersion: 210, pcClock: new Date().toISOString() };

beforeEach(() => {
  ({ db, deviceId } = installReplayDb());
  resetSeq();
});
afterEach(() => uninstallReplayDb(db));

class RestoringDevices extends OfflineDeviceRepository {
  override findByKeyId(): never {
    throw new ShopRestoringError(1);
  }
}

describe("OfflineDeviceService — shop restore (LIRA-377)", () => {
  it("verifyKey answers SHOP_RESTORING while the shop's file is blocked (device lookup)", async () => {
    const key = (await new OfflineDeviceService({ mobileAuth, auth, serverSchemaVersion: () => 210 }).pair(PAIR)).data!
      .deviceKey;
    const svc = new OfflineDeviceService({ mobileAuth, auth, devices: new RestoringDevices() });
    expect(svc.verifyKey(key)).toMatchObject({ ok: false, code: "SHOP_RESTORING" });
  });

  it("verifyKey answers SHOP_RESTORING when the status lookup hits the blocked shop", async () => {
    const key = (await new OfflineDeviceService({ mobileAuth, auth, serverSchemaVersion: () => 210 }).pair(PAIR)).data!
      .deviceKey;
    const svc = new OfflineDeviceService({
      mobileAuth,
      auth,
      shopStatus: () => {
        throw new ShopRestoringError(1);
      },
    });
    expect(svc.verifyKey(key)).toMatchObject({ ok: false, code: "SHOP_RESTORING" });
  });

  it("any other lookup failure is still INVALID_DEVICE_KEY", async () => {
    const key = (await new OfflineDeviceService({ mobileAuth, auth, serverSchemaVersion: () => 210 }).pair(PAIR)).data!
      .deviceKey;
    const svc = new OfflineDeviceService({
      mobileAuth,
      auth,
      shopStatus: () => {
        throw new Error("disk");
      },
    });
    expect(svc.verifyKey(key)).toMatchObject({ ok: false, code: "INVALID_DEVICE_KEY" });
  });

  it("check-in: restore is null when the shop was never restored", () => {
    const svc = new OfflineDeviceService({ mobileAuth, auth, serverSchemaVersion: () => 210, trialStatus: () => null });
    const out = runWithTenant(1, () => svc.checkin(deviceId, CHECKIN));
    expect(out.success).toBe(true);
    expect(out.data!.restore).toBeNull();
  });

  it("check-in: carries the latest finished restore of the shop", () => {
    const repo = new ShopRestoresRepository();
    const mk = (finishedAt: string) => {
      const r = repo.createPrepared({
        targetTenantId: 1,
        kind: "time",
        restoredTo: "2026-11-10T12:00:00Z",
        clientTzOffsetMin: 120,
        requestedByUserId: 1,
        requestedByName: "owner",
        candidatePath: null,
        previewJson: null,
        idFloorJson: null,
        preparedAt: "2026-11-10T12:10:00Z",
      });
      repo.markRunning(r.id, "2026-11-10T12:19:00Z");
      repo.markDone(r.id, { finishedAt, beforeCopyPath: null });
      return r.id;
    };
    mk("2026-11-10T12:20:09Z");
    const second = mk("2026-11-10T12:40:00Z");
    const svc = new OfflineDeviceService({ mobileAuth, auth, serverSchemaVersion: () => 210, trialStatus: () => null });
    const out = runWithTenant(1, () => svc.checkin(deviceId, CHECKIN));
    expect(out.data!.restore).toEqual({
      id: second,
      restoredTo: "2026-11-10T12:00:00Z",
      restoredAt: "2026-11-10T12:40:00Z",
      byName: "owner",
    });
  });

  it("check-in never fails because the restore lookup failed (fail open to null)", () => {
    const svc = new OfflineDeviceService({
      mobileAuth,
      auth,
      serverSchemaVersion: () => 210,
      trialStatus: () => null,
      latestRestore: () => {
        throw new Error("platform file busy");
      },
    });
    const out = runWithTenant(1, () => svc.checkin(deviceId, CHECKIN));
    expect(out.success).toBe(true);
    expect(out.data!.restore).toBeNull();
  });
});
