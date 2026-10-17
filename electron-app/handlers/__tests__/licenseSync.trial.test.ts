/**
 * LIRA-332 FR-021 — the standalone desktop app is never on a trial.
 *
 * Even if the licence server's `/by-key` answer carried trial fields (it does
 * not: `toDesktopView` strips them, guarded in the backend's
 * subscriptionStatus.trial.api.test.ts), `licenseSync` stores only the paid
 * columns, and the desktop's own status read (the same SubscriptionService)
 * reports no trial and stays writable.
 *
 * Jest only (no Electron). Real core + an in-memory DB from create_db.sql;
 * settings are stubbed because they are tenant-scoped and not under test.
 *
 * Characterization, not proven failing-first: licenseSync never wrote trial
 * columns, and the `standing`/`trial` view fields already existed when this
 * was written.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSettingsService: () => ({
      getSettingValue: (key: string) =>
        key === "license_key" ? { value: "KEY-DESKTOP" } : undefined,
    }),
  };
});

import * as core from "@liratek/core";
import { syncLicense, localLicenseStatus } from "../../licenseSync";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

let db: Database.Database;
const realFetch = global.fetch;

function respond(data: Record<string, unknown>) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(
    fs.readFileSync(path.join(__dirname, "../../create_db.sql"), "utf8"),
  );
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  core.resetSubscriptionRepository();
  core.resetSubscriptionService();
});

afterEach(() => {
  global.fetch = realFetch;
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

describe("desktop licence sync — no trial (FR-021)", () => {
  it("a leaked trial in the server answer is never stored; the desktop reads active, writable, no trial", async () => {
    respond({
      status: "active",
      plan: "standard",
      canWrite: false,
      currentPeriodEnd: null,
      graceEndsAt: null,
      entitledModules: null,
      tenantId: 7,
      standing: "trial_ended",
      trial: {
        endsAt: "2026-10-19T21:00:00.000Z",
        lastDay: "2026-10-19",
        daysLeft: 0,
        endsSoon: false,
        ended: true,
      },
    });

    const outcome = await syncLicense();
    expect(outcome.checked).toBe(true);

    expect(
      db
        .prepare(
          `SELECT status, trial_started_at, trial_ends_at FROM tenant_subscriptions WHERE tenant_id = 1`,
        )
        .get(),
    ).toEqual({ status: "active", trial_started_at: null, trial_ends_at: null });

    expect(localLicenseStatus()).toMatchObject({
      status: "active",
      standing: "active",
      canWrite: true,
      trial: null,
    });
  });
});
