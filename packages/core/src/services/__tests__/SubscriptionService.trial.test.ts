/**
 * LIRA-332 — the derived `standing` and trial view (data-model "Derived:
 * standing"). In-memory DB, injected clock.
 *
 * Failing-first: the standing, trial-view, canWrite and markPaid-clears cases
 * were run against the pre-LIRA-332 service and failed. The lapse-sweep case
 * passes by construction (research R1: a trial row has no period end, so
 * `findLapsed` never selects it) and is a characterization, not a guard.
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
    INSERT INTO tenants (id, name, slug) VALUES
      (1, 'Trial Shop', 'trial'), (2, 'Paying Shop', 'paying'),
      (3, 'Grace Shop', 'grace'), (4, 'Read Only Shop', 'ro'),
      (5, 'Broken Shop', 'broken'), (6, 'No Row Shop', 'norow');
  `);
  return db;
}

// Last trial day 2026-11-01 (winter): ends 2026-11-01 22:00 UTC.
const TRIAL_ENDS = "2026-11-01 22:00:00";
const BEFORE_END = new Date("2026-10-20T09:00:00Z"); // Beirut 10-20 → 13 left
const AFTER_END = new Date("2026-11-01T22:00:00Z"); // the end instant itself

let db: Database.Database;
let now: Date;
let service: SubscriptionService;

function seed(): void {
  const ins = db.prepare(
    `INSERT INTO tenant_subscriptions
       (tenant_id, status, current_period_end, grace_ends_at,
        trial_started_at, trial_ends_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  ins.run(1, "active", null, null, "2026-10-18 09:00:00", TRIAL_ENDS);
  ins.run(2, "active", null, null, null, null);
  ins.run(3, "grace", "2026-10-01 00:00:00", "2026-12-01 00:00:00", null, null);
  ins.run(4, "read_only", "2026-09-01 00:00:00", "2026-09-08 00:00:00", null, null);
  // Invariant broken by hand: a trial on a row that also has a paid period.
  ins.run(5, "active", "2027-01-01 00:00:00", null, "2026-10-18 09:00:00", "2026-10-20 00:00:00");
}

beforeEach(() => {
  db = createTestDb();
  seed();
  now = BEFORE_END;
  service = new SubscriptionService(new SubscriptionRepository(db), () => now);
});

afterEach(() => db.close());

describe("standing precedence", () => {
  it("1. no row → null (fail open)", () => {
    expect(service.statusFor(6)).toBeNull();
    expect(service.canWrite(6)).toBe(true);
  });

  it("3. trial set and now < end → trial, with the single trial view", () => {
    const view = service.statusFor(1)!;
    expect(view.standing).toBe("trial");
    expect(view.status).toBe("active");
    expect(view.canWrite).toBe(true);
    expect(view.trial).toEqual({
      endsAt: "2026-11-01T22:00:00.000Z",
      lastDay: "2026-11-01",
      daysLeft: 13,
      endsSoon: false,
      ended: false,
    });
  });

  it("4. trial set and now >= end → trial_ended, canWrite false", () => {
    now = AFTER_END;
    const view = service.statusFor(1)!;
    expect(view.standing).toBe("trial_ended");
    expect(view.canWrite).toBe(false);
    expect(service.canWrite(1)).toBe(false);
    expect(view.trial).toMatchObject({ ended: true, daysLeft: 0 });
  });

  it("5. no trial → the status column, unchanged", () => {
    expect(service.statusFor(2)).toMatchObject({
      standing: "active",
      canWrite: true,
      trial: null,
    });
    expect(service.statusFor(3)).toMatchObject({
      standing: "grace",
      canWrite: true,
      trial: null,
    });
    expect(service.statusFor(4)).toMatchObject({
      standing: "read_only",
      canWrite: false,
      trial: null,
    });
  });

  it("2. broken invariant → the paid reading, never trial_ended (SC-006)", () => {
    now = AFTER_END; // the hand-set trial end is long past
    const view = service.statusFor(5)!;
    expect(view.standing).toBe("active");
    expect(view.canWrite).toBe(true);
    expect(view.trial).toBeNull();
  });
});

describe("markPaid on a trial row", () => {
  it("clears trial_started_at and trial_ends_at", () => {
    now = AFTER_END;
    service.markPaid(1, "2027-01-31 22:00:00");
    const row = db
      .prepare(
        "SELECT trial_started_at, trial_ends_at FROM tenant_subscriptions WHERE tenant_id = 1",
      )
      .get() as { trial_started_at: string | null; trial_ends_at: string | null };
    expect(row).toEqual({ trial_started_at: null, trial_ends_at: null });
    expect(service.statusFor(1)).toMatchObject({
      standing: "active",
      canWrite: true,
      trial: null,
    });
  });
});

describe("no grace for trials (FR-008)", () => {
  it("a trial_ended row survives two lapse sweeps unchanged (characterization)", () => {
    now = AFTER_END;
    const before = db
      .prepare("SELECT * FROM tenant_subscriptions WHERE tenant_id = 1")
      .get();
    service.runLapseSweep();
    service.runLapseSweep();
    const after = db
      .prepare("SELECT * FROM tenant_subscriptions WHERE tenant_id = 1")
      .get() as { status: string; grace_ends_at: string | null };
    expect(after).toEqual(before);
    expect(after.status).toBe("active");
    expect(after.grace_ends_at).toBeNull();
  });
});
