/**
 * A paired PC's device key must stop working once the platform suspends or
 * archives its shop.
 *
 * A suspended shop's web sessions are refused on the next request
 * (AuthService.validateSession), and pairing a new PC is refused too. But
 * verifyKey only checks the key hash and revoked_at, so a PC paired before
 * the suspension keeps downloading the shop snapshot and uploading events.
 *
 * Owner decision (2026-10-16): cut paired PCs off on their NEXT contact with
 * the server. A PC that stays offline keeps its local copy — nothing on the
 * server can reach it — but every check-in, snapshot or upload it attempts
 * is refused. This test pins that server-side refusal.
 *
 * Security audit run-1, fingerprint
 * backend/src/middleware/deviceAuth.ts:authenticateDevice:no-tenant-status-check.
 *
 * Harness from OfflineDeviceService.test.ts (replay DB, tenant 1, faked
 * MobileAuthService).
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { OfflineDeviceService } from "../OfflineDeviceService";
import { installReplayDb, uninstallReplayDb, resetSeq } from "../../offline/testHelpers/replayHarness";

let db: Database.Database;

const mobileAuth = {
  loginWithShop: async () => ({
    ok: true as const,
    user: { id: 1, username: "admin", role: "admin", tenant_id: 1 } as never,
    sessionToken: "tok-1",
    shop: { id: 1, slug: "default", name: "Default" },
  }),
};
const auth = { logout: async () => undefined };
const service = () => new OfflineDeviceService({ mobileAuth, auth, serverSchemaVersion: () => 210 });
const PAIR = { shop: "default", username: "admin", password: "pw", deviceName: "Front PC" };

beforeEach(() => {
  ({ db } = installReplayDb());
  resetSeq();
});
afterEach(() => uninstallReplayDb(db));

function setShopStatus(status: string) {
  db.prepare(`UPDATE tenants SET status = ? WHERE id = 1`).run(status);
}

describe("OfflineDeviceService.verifyKey — suspended or archived shop", () => {
  it("control: the key works while the shop is active", async () => {
    const key = (await service().pair(PAIR)).data!.deviceKey;
    expect(runWithTenant(1, () => service().verifyKey(key))).toMatchObject({ ok: true });
  });

  it.each(["suspended", "archived"])(
    "a key paired while active is refused once the shop is %s",
    async (status) => {
      const key = (await service().pair(PAIR)).data!.deviceKey;

      setShopStatus(status);

      expect(runWithTenant(1, () => service().verifyKey(key))).toMatchObject({ ok: false });
    },
  );

  it("the key works again if the shop is re-activated (no permanent unpairing)", async () => {
    const key = (await service().pair(PAIR)).data!.deviceKey;
    setShopStatus("suspended");
    setShopStatus("active");

    expect(runWithTenant(1, () => service().verifyKey(key))).toMatchObject({ ok: true });
  });
});
