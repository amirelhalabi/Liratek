/**
 * LIRA-332 US3 — the owner's "Activate subscription" and "Extend trial"
 * (data-model "State transitions"). In-memory DB, injected clock.
 *
 * Not proven failing-first (new contract): before `activate`/`extendTrial`
 * existed these calls did not compile.
 */

import Database from "better-sqlite3";
import { SubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import { SubscriptionService } from "../SubscriptionService.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE tenant_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      plan TEXT NOT NULL DEFAULT 'standard',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'grace', 'read_only')),
      current_period_end DATETIME,
      grace_ends_at DATETIME,
      license_key TEXT,
      entitled_modules TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      trial_started_at DATETIME,
      trial_ends_at DATETIME
    );
    CREATE UNIQUE INDEX idx_tenant_subscriptions_tenant
      ON tenant_subscriptions(tenant_id);
    INSERT INTO tenants (id, name, slug, status) VALUES
      (1, 'Trial', 'trial', 'active'), (2, 'Ended', 'ended', 'suspended'),
      (3, 'Owner-made', 'ownermade', 'active'), (4, 'Grace', 'grace', 'active'),
      (5, 'Read only', 'ro', 'active'), (6, 'Paid period', 'paid', 'active');
  `);
  const ins = db.prepare(
    `INSERT INTO tenant_subscriptions
       (tenant_id, status, current_period_end, grace_ends_at, trial_started_at, trial_ends_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  ins.run(1, "active", null, null, "2026-10-19 09:00:00", "2026-11-01 22:00:00");
  ins.run(2, "active", null, null, "2026-10-01 09:00:00", "2026-10-14 21:00:00");
  ins.run(3, "active", null, null, null, null);
  ins.run(4, "grace", "2026-10-01 00:00:00", "2026-10-28 00:00:00", null, null);
  ins.run(5, "read_only", "2026-09-01 00:00:00", "2026-09-08 00:00:00", null, null);
  ins.run(6, "active", "2027-01-01 00:00:00", null, null, null);
  return db;
}

const NOW = new Date("2026-10-20T09:00:00Z"); // Beirut 2026-10-20

let db: Database.Database;
let service: SubscriptionService;
let now: Date;

const row = (tenantId: number) =>
  db
    .prepare(
      `SELECT status, current_period_end, grace_ends_at, trial_started_at, trial_ends_at
         FROM tenant_subscriptions WHERE tenant_id = ?`,
    )
    .get(tenantId);
const tenantStatus = (id: number) =>
  (db.prepare(`SELECT status FROM tenants WHERE id = ?`).get(id) as { status: string }).status;

beforeEach(() => {
  db = createTestDb();
  now = NOW;
  service = new SubscriptionService(new SubscriptionRepository(db), () => now);
});

afterEach(() => db.close());

describe("activate", () => {
  it.each([1, 2])("open-ended on tenant %s (trial / trial_ended) → active, no period, trial cleared", (id) => {
    const { before, after } = service.activate(id, null);
    expect(before.standing).toBe(id === 1 ? "trial" : "trial_ended");
    expect(after).toMatchObject({ standing: "active", canWrite: true, trial: null });
    expect(row(id)).toEqual({
      status: "active",
      current_period_end: null,
      grace_ends_at: null,
      trial_started_at: null,
      trial_ends_at: null,
    });
  });

  it("until a day → the period ends at 00:00 Beirut after that day; the sweep handles it as today", () => {
    service.activate(1, "2027-10-31");
    // DST ends on 2027-10-31, so 11-01 00:00 Beirut is +2 (Python zoneinfo).
    expect(row(1)).toMatchObject({ current_period_end: "2027-10-31 22:00:00" });
    now = new Date("2027-10-31T21:59:59Z");
    expect(service.runLapseSweep().toGrace).not.toContain(1);
    now = new Date("2027-10-31T22:00:00Z");
    expect(service.runLapseSweep().toGrace).toContain(1);
  });

  it("refuses an `until` day that is already over", () => {
    expect(() => service.activate(1, "2026-10-19")).toThrow(
      "Choose a date in the future",
    );
    expect(row(1)).toMatchObject({ trial_ends_at: "2026-11-01 22:00:00" });
  });

  it("never reads or writes tenants.status (FR-016): a suspended shop stays suspended", () => {
    service.activate(2, null);
    expect(tenantStatus(2)).toBe("suspended");
  });

  it("a tenant with no row is refused", () => {
    expect(() => service.activate(99, null)).toThrow(/not found/);
  });
});

describe("extendTrial", () => {
  it("moves the end to 00:00 Beirut after the new last day", () => {
    const { before, after } = service.extendTrial(1, "2026-11-15");
    expect(before.trial?.lastDay).toBe("2026-11-01");
    expect(after.trial).toMatchObject({ lastDay: "2026-11-15", ended: false });
    expect(row(1)).toMatchObject({
      trial_started_at: "2026-10-19 09:00:00",
      trial_ends_at: "2026-11-15 22:00:00",
    });
  });

  it("an ended trial becomes a trial again; tenants.status untouched", () => {
    expect(service.statusFor(2)?.standing).toBe("trial_ended");
    service.extendTrial(2, "2026-10-25");
    expect(service.statusFor(2)).toMatchObject({ standing: "trial", canWrite: true });
    expect(tenantStatus(2)).toBe("suspended");
  });

  it("an owner-created active shop with no period starts a trial (spec edge case)", () => {
    service.extendTrial(3, "2026-10-30");
    expect(row(3)).toMatchObject({
      trial_started_at: "2026-10-20 09:00:00",
      trial_ends_at: "2026-10-30 22:00:00", // winter: +2
    });
    expect(service.statusFor(3)?.standing).toBe("trial");
  });

  it.each(["2026-10-19", "2026-10-01"])("refuses a past last day (%s)", (day) => {
    expect(() => service.extendTrial(1, day)).toThrow("Choose a date in the future");
  });

  it("today's day is still in the future until midnight", () => {
    service.extendTrial(1, "2026-10-20");
    expect(service.statusFor(1)?.trial).toMatchObject({ daysLeft: 1 });
  });

  it.each([4, 5, 6])("refuses a paying shop (tenant %s)", (id) => {
    expect(() => service.extendTrial(id, "2026-11-30")).toThrow(
      "This shop pays; use Activate subscription",
    );
  });
});
