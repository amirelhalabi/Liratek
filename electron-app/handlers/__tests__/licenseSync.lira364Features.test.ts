/**
 * LIRA-364 — a desktop shop follows super admin's per-shop feature switches:
 * the licence sync stores `enabledFeatures` from the server's answer, so the
 * desktop's own KPI snapshot timer (which reads the LOCAL row) starts or
 * stops with the switch. An answer without the field switches everything off
 * (an older server never switched anything on).
 *
 * Harness copied from licenseSync.trial.test.ts.
 *
 * RULE 17 — written before licenseSync stored the features.
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
import { syncLicense } from "../../licenseSync";

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

const PAID = {
  status: "active",
  plan: "standard",
  canWrite: true,
  currentPeriodEnd: null,
  graceEndsAt: null,
  entitledModules: null,
};

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(path.join(__dirname, "../../create_db.sql"), "utf8"));
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  core.resetSubscriptionRepository();
  core.resetSubscriptionService();
});

afterEach(() => {
  global.fetch = realFetch;
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

describe("desktop licence sync — opt-in features (LIRA-364)", () => {
  it("stores the switch super admin turned on", async () => {
    respond({ ...PAID, enabledFeatures: ["kpi_snapshots"] });
    expect((await syncLicense()).checked).toBe(true);
    expect(
      core.getSubscriptionService().isFeatureEnabled(1, "kpi_snapshots"),
    ).toBe(true);
  });

  it("turning it off on the server turns it off on the desktop", async () => {
    respond({ ...PAID, enabledFeatures: ["kpi_snapshots"] });
    await syncLicense();
    respond({ ...PAID, enabledFeatures: [] });
    await syncLicense();
    expect(
      core.getSubscriptionService().isFeatureEnabled(1, "kpi_snapshots"),
    ).toBe(false);
  });

  it("an answer without the field (older server) means off", async () => {
    respond({ ...PAID, enabledFeatures: ["kpi_snapshots"] });
    await syncLicense();
    respond(PAID);
    await syncLicense();
    expect(
      core.getSubscriptionService().isFeatureEnabled(1, "kpi_snapshots"),
    ).toBe(false);
  });
});
