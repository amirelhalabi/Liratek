/**
 * LIRA-306 T029 — pairing PCs, device keys, check-in (FR-001, FR-001a,
 * FR-004, O-new-8). Credentials go through MobileAuthService.loginWithShop
 * (faked here); its session is revoked immediately — the PC keeps only the
 * device key.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { OfflineDeviceService, parseDeviceKey } from "../OfflineDeviceService";
import { OfflineDeviceRepository } from "../../repositories/OfflineDeviceRepository";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../../offline/testHelpers/replayHarness";

let db: Database.Database;
let loggedOut: string[] = [];
let outcome: "ok" | "INVALID_CREDENTIALS" | "ADMIN_ONLY" = "ok";

const mobileAuth = {
  loginWithShop: async () =>
    outcome === "ok"
      ? {
          ok: true as const,
          user: { id: 1, username: "admin", role: "admin", tenant_id: 1 } as never,
          sessionToken: "tok-1",
          shop: { id: 1, slug: "default", name: "Default" },
        }
      : { ok: false as const, reason: outcome },
};
const auth = { logout: async (t: string) => void loggedOut.push(t) };
const service = () => new OfflineDeviceService({ mobileAuth, auth, serverSchemaVersion: () => 210 });
const PAIR = { shop: "default", username: "admin", password: "pw", deviceName: "Front PC" };

beforeEach(() => {
  ({ db } = installReplayDb()); // pairs PC 1 already
  resetSeq();
  loggedOut = [];
  outcome = "ok";
});
afterEach(() => uninstallReplayDb(db));

describe("OfflineDeviceService.pair", () => {
  it("issues ltd_<tenant>_<keyId>_<secret>, stores only a sha256 hash, revokes the sign-in session", async () => {
    const r = await service().pair(PAIR);
    expect(r.success).toBe(true);
    const key = r.data!.deviceKey;
    expect(key).toMatch(/^ltd_1_[0-9a-f]{12}_[0-9a-f]{64}$/);
    expect(r.data).toMatchObject({ deviceNo: 2, tenantId: 1, shopSlug: "default", serverSchemaVersion: 210 });
    expect(loggedOut).toEqual(["tok-1"]);
    const parsed = parseDeviceKey(key)!;
    const row = db.prepare(`SELECT key_hash FROM offline_devices WHERE key_id = ?`).get(parsed.keyId) as { key_hash: string };
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.key_hash).not.toContain(parsed.secret);
  });

  it("several PCs get increasing numbers", async () => {
    expect((await service().pair(PAIR)).data!.deviceNo).toBe(2);
    expect((await service().pair({ ...PAIR, deviceName: "Back PC" })).data!.deviceNo).toBe(3);
  });

  it("wrong credentials → generic INVALID_CREDENTIALS; a non-admin → ADMIN_ONLY", async () => {
    outcome = "INVALID_CREDENTIALS";
    expect(await service().pair(PAIR)).toMatchObject({ success: false, code: "INVALID_CREDENTIALS" });
    outcome = "ADMIN_ONLY";
    expect(await service().pair(PAIR)).toMatchObject({ success: false, code: "ADMIN_ONLY" });
  });

  it("re-pair with deviceNo re-keys the SAME row (number + cursor kept, old key dead)", async () => {
    const first = await service().pair(PAIR);
    const devices = new OfflineDeviceRepository();
    const row = runWithTenant(1, () => devices.findByDeviceNo(2))!;
    runWithTenant(1, () => devices.setNextExpectedSeq(row.id, 9));
    const again = await service().pair({ ...PAIR, deviceNo: 2 });
    expect(again.data!.deviceNo).toBe(2);
    const after = runWithTenant(1, () => devices.findByDeviceNo(2))!;
    expect(after).toMatchObject({ id: row.id, next_expected_seq: 9 });
    expect(runWithTenant(1, () => service().verifyKey(first.data!.deviceKey))).toMatchObject({ ok: false });
    expect(runWithTenant(1, () => service().verifyKey(again.data!.deviceKey))).toMatchObject({ ok: true, deviceNo: 2 });
  });

  it("re-pair with an unknown PC number is refused", async () => {
    expect(await service().pair({ ...PAIR, deviceNo: 77 })).toMatchObject({ success: false, code: "UNKNOWN_DEVICE" });
  });
});

describe("device keys", () => {
  it("verify: good key ok; tampered secret, malformed, cross-tenant and revoked refused", async () => {
    const { data } = await service().pair(PAIR);
    const key = data!.deviceKey;
    expect(service().verifyKey(key)).toMatchObject({ ok: true, tenantId: 1, deviceNo: 2 });
    expect(service().verifyKey(key.slice(0, -1) + (key.endsWith("0") ? "1" : "0"))).toMatchObject({ ok: false, code: "INVALID_DEVICE_KEY" });
    expect(service().verifyKey("nonsense")).toMatchObject({ ok: false, code: "INVALID_DEVICE_KEY" });
    expect(service().verifyKey(key.replace(/^ltd_1_/, "ltd_2_"))).toMatchObject({ ok: false, code: "INVALID_DEVICE_KEY" });
    const devId = runWithTenant(1, () => new OfflineDeviceRepository().findByDeviceNo(2))!.id;
    runWithTenant(1, () => service().revoke(devId, 1));
    expect(service().verifyKey(key)).toMatchObject({ ok: false, code: "DEVICE_REVOKED" });
  });

  it("parseDeviceKey refuses anything but the exact format (no DB read for malformed keys)", () => {
    expect(parseDeviceKey("ltd_1_abc_def")).toBeNull();
    expect(parseDeviceKey(`ltd_x_${"a".repeat(12)}_${"b".repeat(64)}`)).toBeNull();
    expect(parseDeviceKey(`ltd_3_${"a".repeat(12)}_${"b".repeat(64)}`)).toEqual({ tenantId: 3, keyId: "a".repeat(12), secret: "b".repeat(64) });
  });
});

describe("check-in", () => {
  it("stores state, pending, versions and skew; returns the server's maxSeq and per-table max offline ids", async () => {
    const devId = runWithTenant(1, () => new OfflineDeviceRepository().findByDeviceNo(1))!.id;
    storeEvent({ deviceId: devId, channel: "sales:update-metadata", payload: { id: 5 }, seq: 1, created: { sales: [1_023_000_000_004] } });
    storeEvent({ deviceId: devId, channel: "sales:update-metadata", payload: { id: 5 }, seq: 2, created: { clients: [1_017_000_000_002] } });
    const pcClock = new Date(Date.now() - 180_000).toISOString(); // PC 3 min slow
    const r = runWithTenant(1, () =>
      service().checkin(devId, { state: "standby", pendingCount: 2, appVersion: "1.2.3", schemaVersion: 210, pcClock }),
    );
    expect(r.data).toMatchObject({
      serverSchemaVersion: 210,
      maxSeq: 2,
      maxOfflineIds: { sales: 1_023_000_000_004, clients: 1_017_000_000_002 },
      renumberUnsent: false,
    });
    const row = runWithTenant(1, () => new OfflineDeviceRepository().findById(devId))!;
    expect(row).toMatchObject({ last_state: "standby", last_pending_count: 2, last_app_version: "1.2.3", last_schema_version: 210 });
    expect(row.last_skew_ms!).toBeGreaterThan(170_000);
    expect(row.last_online_skew_ms).toBe(row.last_skew_ms);
  });
});
