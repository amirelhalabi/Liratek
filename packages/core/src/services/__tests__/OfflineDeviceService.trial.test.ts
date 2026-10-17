/**
 * LIRA-332 US5 — a paired PC learns its shop's free-trial state on every
 * check-in, so its recorder can refuse new offline work once the trial has
 * ended (research R8). `null` for a paying shop and when the lookup fails
 * (fail open).
 *
 * Production default wiring (the real SubscriptionService over the replay
 * DB); only the system time is faked.
 *
 * Failing-first: run before checkin carried `trial`, the trial and
 * trial-ended cases failed (`trial` undefined).
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { OfflineDeviceService } from "../OfflineDeviceService";
import { resetSubscriptionService } from "../SubscriptionService";
import { resetSubscriptionRepository } from "../../repositories/SubscriptionRepository";
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
const CHECKIN = {
  state: "standby" as const,
  pendingCount: 0,
  appVersion: "1.0.0",
  schemaVersion: 210,
  pcClock: "2026-11-03T10:00:00.000Z",
};

function setTrialEnd(sql: string | null) {
  db.prepare(`DELETE FROM tenant_subscriptions WHERE tenant_id = 1`).run();
  db.prepare(
    `INSERT INTO tenant_subscriptions (tenant_id, plan, status, trial_started_at, trial_ends_at)
     VALUES (1, 'standard', 'active', ?, ?)`,
  ).run(sql ? "2026-10-19 09:00:00" : null, sql);
}

const checkin = (svc = new OfflineDeviceService({ mobileAuth, auth, serverSchemaVersion: () => 210 })) =>
  runWithTenant(1, () => svc.checkin(deviceId, CHECKIN));

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date("2026-10-25T10:00:00.000Z"),
    doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"],
  });
  resetSubscriptionService();
  resetSubscriptionRepository();
  ({ db, deviceId } = installReplayDb());
  resetSeq();
});
afterEach(() => {
  jest.useRealTimers();
  uninstallReplayDb(db);
});

describe("checkin → trial", () => {
  it("a shop on a trial: standing trial and the end instant", () => {
    setTrialEnd("2026-11-01 22:00:00");
    expect(checkin().data?.trial).toEqual({
      standing: "trial",
      endsAt: "2026-11-01T22:00:00.000Z",
    });
  });

  it("an ended trial: standing trial_ended", () => {
    setTrialEnd("2026-10-20 21:00:00");
    expect(checkin().data?.trial).toEqual({
      standing: "trial_ended",
      endsAt: "2026-10-20T21:00:00.000Z",
    });
  });

  it("a paying shop: null", () => {
    setTrialEnd(null);
    expect(checkin().data?.trial).toBeNull();
  });

  it("a failed lookup: null, and the check-in still succeeds (fail open)", () => {
    const svc = new OfflineDeviceService({
      mobileAuth,
      auth,
      serverSchemaVersion: () => 210,
      trialStatus: () => {
        throw new Error("platform db gone");
      },
    });
    const r = checkin(svc);
    expect(r.success).toBe(true);
    expect(r.data?.trial).toBeNull();
  });
});
