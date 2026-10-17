/**
 * LIRA-332 US1 — a public sign-up starts a 14-day trial, stamped in the SAME
 * transaction as the tenant (shared storage mode). Owner-created shops and
 * every caller that does not ask for a trial keep today's row (FR-004).
 *
 * Real schema (create_db.sql + runMigrations), injected clock.
 *
 * Failing-first: the "trial requested" case was run before the provisioner
 * change and failed (trial_ends_at stayed NULL). The "no trial" and rollback
 * cases pin existing behaviour (characterization).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithoutTenant } from "../../db/tenantContext.js";
import { TenantRepository } from "../../repositories/TenantRepository.js";
import { UserRepository } from "../../repositories/UserRepository.js";
import { SubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import {
  TenantProvisioningService,
  type ProvisionTenantData,
} from "../TenantProvisioningService.js";
import { toUtcSqlTimestamp, trialEndFor } from "../../utils/trialCalendar.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const NOW = new Date("2026-10-17T07:00:00Z"); // 10:00 Beirut

let db: Database.Database;

function service(userRepo: UserRepository = new UserRepository()) {
  return new TenantProvisioningService(
    new TenantRepository(db),
    userRepo,
    new SubscriptionRepository(db),
    undefined,
    undefined,
    () => NOW,
  );
}

function provision(
  extra: Partial<ProvisionTenantData>,
  svc = service(),
): number {
  return runWithoutTenant(
    () =>
      svc.provisionTenant({
        name: "Corner Tech",
        slug: "cornertech",
        adminUsername: "owner",
        adminPassword: "Str0ng-Password!",
        ...extra,
      }).id,
  );
}

function subscriptionRow(tenantId: number) {
  return db
    .prepare(
      `SELECT plan, status, current_period_end, grace_ends_at, license_key,
              entitled_modules, notes, trial_started_at, trial_ends_at
         FROM tenant_subscriptions WHERE tenant_id = ?`,
    )
    .get(tenantId);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

describe("provisionTenant — trial", () => {
  it("trial requested → the row carries the start and the day-15 00:00 Beirut end", () => {
    const id = provision({ trial: { source: "invite_link" } });
    expect(subscriptionRow(id)).toEqual({
      plan: "standard",
      status: "active",
      current_period_end: null,
      grace_ends_at: null,
      license_key: null,
      entitled_modules: null,
      notes: null,
      trial_started_at: "2026-10-17 07:00:00",
      trial_ends_at: toUtcSqlTimestamp(trialEndFor(NOW)),
    });
    expect(toUtcSqlTimestamp(trialEndFor(NOW))).toBe("2026-10-30 22:00:00");
  });

  it("no trial requested → exactly today's row (FR-004)", () => {
    const id = provision({});
    expect(subscriptionRow(id)).toEqual({
      plan: "standard",
      status: "active",
      current_period_end: null,
      grace_ends_at: null,
      license_key: null,
      entitled_modules: null,
      notes: null,
      trial_started_at: null,
      trial_ends_at: null,
    });
  });

  it("an admin-user failure rolls back: no tenant and no subscription row", () => {
    class FailingUsers extends UserRepository {
      override createUser(): never {
        throw new Error("boom");
      }
    }
    const before = (
      db.prepare(`SELECT COUNT(*) AS n FROM tenants`).get() as { n: number }
    ).n;
    expect(() =>
      provision({ trial: { source: "google" } }, service(new FailingUsers())),
    ).toThrow("boom");
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM tenants`).get() as { n: number })
        .n,
    ).toBe(before);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM tenant_subscriptions WHERE trial_ends_at IS NOT NULL`,
        )
        .get(),
    ).toEqual({ n: 0 });
  });
});
