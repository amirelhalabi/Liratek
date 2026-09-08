/**
 * SubscriptionService — commercial standing (v173).
 *
 * A real in-memory database rather than a mocked repository: the SQL is half
 * the behaviour here (the partial unique index, the `ON CONFLICT DO NOTHING`,
 * the string date comparison in the lapse sweep), and a mock would assert my
 * own assumptions about it.
 *
 * The block that matters most is "fails open". Two paying desktop customers
 * are live at the time this ships and neither has a licence key, so every
 * ambiguous state — no row, no allowlist, a corrupt allowlist — MUST resolve
 * to full access. Anyone later "tidying" those branches into a denial would
 * take modules away from a customer who is paying for them, which is why each
 * one is asserted separately instead of as a single happy path.
 */

import Database from "better-sqlite3";
import { SubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import { SubscriptionService } from "../SubscriptionService.js";

/** Mirrors `create_db.sql` — including the CHECK and both unique indexes. */
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'archived')),
      contact_name TEXT,
      contact_phone TEXT,
      notes TEXT,
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_tenant_subscriptions_tenant
      ON tenant_subscriptions(tenant_id);
    CREATE UNIQUE INDEX idx_tenant_subscriptions_key
      ON tenant_subscriptions(license_key) WHERE license_key IS NOT NULL;

    INSERT INTO tenants (id, name, slug) VALUES
      (1, 'Full Modules Shop', 'fullshop'),
      (2, 'Basics Only Shop', 'basicshop');
  `);
  return db;
}

const FIXED_NOW = new Date("2026-09-08T12:00:00Z");

/** SQLite's CURRENT_TIMESTAMP shape, which is what the sweep compares against. */
function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}
function daysFrom(base: Date, days: number): string {
  const out = new Date(base.getTime());
  out.setDate(out.getDate() + days);
  return sqlTime(out);
}

let db: Database.Database;
let repo: SubscriptionRepository;
let service: SubscriptionService;

beforeEach(() => {
  db = createTestDb();
  repo = new SubscriptionRepository(db);
  service = new SubscriptionService(repo, () => FIXED_NOW);
});

afterEach(() => db.close());

describe("fails OPEN — every ambiguous state means full access", () => {
  it("a tenant with NO subscription row can write and use every module", () => {
    // This is what grandfathers every install that existed before v173.
    expect(service.statusFor(1)).toBeNull();
    expect(service.canWrite(1)).toBe(true);
    expect(service.isModuleEntitled(1, "exchange")).toBe(true);
    expect(service.isModuleEntitled(1, "recharge")).toBe(true);
  });

  it("a NULL allowlist means every module, not none", () => {
    repo.createForTenant(1);
    expect(service.statusFor(1)?.entitledModules).toBeNull();
    expect(service.isModuleEntitled(1, "exchange")).toBe(true);
  });

  it("a CORRUPT allowlist means every module", () => {
    // A half-written column must not silently strip a paying shop.
    repo.createForTenant(1, { entitled_modules: "{not json" });
    expect(service.statusFor(1)?.entitledModules).toBeNull();
    expect(service.isModuleEntitled(1, "exchange")).toBe(true);
  });

  it("a non-ARRAY allowlist means every module", () => {
    repo.createForTenant(1, { entitled_modules: '{"pos":true}' });
    expect(service.isModuleEntitled(1, "exchange")).toBe(true);
  });

  it("an EMPTY allowlist really does mean none — the one state that denies", () => {
    // Empty and absent must never be conflated: absent is permission.
    repo.createForTenant(1, { entitled_modules: "[]" });
    expect(service.statusFor(1)?.entitledModules).toEqual([]);
    expect(service.isModuleEntitled(1, "exchange")).toBe(false);
  });
});

describe("the ungateable modules can never be sold away", () => {
  beforeEach(() => {
    repo.createForTenant(1, { entitled_modules: '["pos"]' });
  });

  it.each(["settings", "dashboard", "audit", "closing"])(
    "%s stays entitled even when the allowlist excludes it",
    (moduleKey) => {
      expect(service.isModuleEntitled(1, moduleKey)).toBe(true);
    },
  );

  it("settings in particular — the licence key is entered THERE", () => {
    // Gating settings would make a mis-set subscription unfixable by the
    // customer, which is the one failure with no way out.
    expect(service.isModuleEntitled(1, "settings")).toBe(true);
  });

  it("but an ordinary module outside the allowlist IS blocked", () => {
    expect(service.isModuleEntitled(1, "pos")).toBe(true);
    expect(service.isModuleEntitled(1, "exchange")).toBe(false);
  });
});

describe("the owner's two real customers", () => {
  it("full-modules shop keeps everything; basics shop is limited", () => {
    repo.createForTenant(1); // NULL = everything
    repo.createForTenant(2, {
      entitled_modules: '["pos","inventory","clients","debts"]',
    });

    for (const m of ["pos", "exchange", "recharge", "loto"]) {
      expect(service.isModuleEntitled(1, m)).toBe(true);
    }
    expect(service.isModuleEntitled(2, "pos")).toBe(true);
    expect(service.isModuleEntitled(2, "inventory")).toBe(true);
    expect(service.isModuleEntitled(2, "exchange")).toBe(false);
    expect(service.isModuleEntitled(2, "recharge")).toBe(false);
  });

  it("changing one shop's plan does not touch the other", () => {
    repo.createForTenant(1);
    repo.createForTenant(2);

    service.setEntitledModules(2, ["pos"]);

    expect(service.statusFor(1)?.entitledModules).toBeNull();
    expect(service.statusFor(2)?.entitledModules).toEqual(["pos"]);
    expect(service.isModuleEntitled(1, "exchange")).toBe(true);
  });
});

describe("write blocking", () => {
  it("active can write", () => {
    repo.createForTenant(1, { status: "active" });
    expect(service.canWrite(1)).toBe(true);
  });

  it("GRACE can still write — that is the whole point of a grace period", () => {
    repo.createForTenant(1, { status: "grace" });
    expect(service.canWrite(1)).toBe(true);
    expect(service.statusFor(1)?.canWrite).toBe(true);
  });

  it("read_only cannot write", () => {
    repo.createForTenant(1, { status: "read_only" });
    expect(service.canWrite(1)).toBe(false);
  });

  it("read_only still reports its modules — reads are never blocked", () => {
    repo.createForTenant(1, {
      status: "read_only",
      entitled_modules: '["pos"]',
    });
    expect(service.isModuleEntitled(1, "pos")).toBe(true);
  });
});

describe("licence keys (desktop identity)", () => {
  it("resolves a subscription from its key, with the tenant id", () => {
    repo.createForTenant(2, {
      license_key: "lsk_abc",
      entitled_modules: '["pos"]',
    });
    const view = service.statusForLicenseKey("lsk_abc");
    expect(view?.tenantId).toBe(2);
    expect(view?.entitledModules).toEqual(["pos"]);
  });

  it("an unknown key resolves to nothing — the caller then fails open", () => {
    expect(service.statusForLicenseKey("lsk_nope")).toBeNull();
  });

  it("two tenants cannot share a key", () => {
    repo.createForTenant(1, { license_key: "lsk_same" });
    expect(() =>
      repo.createForTenant(2, { license_key: "lsk_same" }),
    ).toThrow();
  });

  it("many tenants CAN share the absence of a key", () => {
    // The unique index is partial for exactly this reason.
    repo.createForTenant(1);
    repo.createForTenant(2);
    expect(repo.getByTenantId(1)?.license_key).toBeNull();
    expect(repo.getByTenantId(2)?.license_key).toBeNull();
  });
});

describe("the lapse sweep", () => {
  it("moves an expired active subscription to grace, with a deadline", () => {
    repo.createForTenant(1, {
      status: "active",
      current_period_end: daysFrom(FIXED_NOW, -1),
    });

    const result = service.runLapseSweep();

    expect(result.toGrace).toEqual([1]);
    const row = repo.getByTenantId(1);
    expect(row?.status).toBe("grace");
    expect(row?.grace_ends_at).toBe(daysFrom(FIXED_NOW, 7));
  });

  it("leaves a subscription with NO period end alone forever", () => {
    // No trial: a new tenant is active with a NULL period end, and must not
    // be swept into grace by the mere passage of time.
    repo.createForTenant(1, { status: "active", current_period_end: null });
    expect(service.runLapseSweep().toGrace).toEqual([]);
    expect(repo.getByTenantId(1)?.status).toBe("active");
  });

  it("moves an expired grace to read_only", () => {
    repo.createForTenant(1, {
      status: "grace",
      grace_ends_at: daysFrom(FIXED_NOW, -1),
    });
    expect(service.runLapseSweep().toReadOnly).toEqual([1]);
    expect(repo.getByTenantId(1)?.status).toBe("read_only");
  });

  it("is IDEMPOTENT — running it twice equals running it once", () => {
    repo.createForTenant(1, {
      status: "active",
      current_period_end: daysFrom(FIXED_NOW, -1),
    });

    service.runLapseSweep();
    const afterFirst = repo.getByTenantId(1);

    const second = service.runLapseSweep();

    // Nothing selected the second time, and the deadline did not slide.
    expect(second.toGrace).toEqual([]);
    expect(second.toReadOnly).toEqual([]);
    expect(repo.getByTenantId(1)?.status).toBe(afterFirst?.status);
    expect(repo.getByTenantId(1)?.grace_ends_at).toBe(
      afterFirst?.grace_ends_at,
    );
  });

  it("advances only ONE step per sweep, never straight to read_only", () => {
    // Both deadlines are stale (an old grace value left over). The shop must
    // still get a grace window it can notice, not a same-instant lockout.
    repo.createForTenant(1, {
      status: "active",
      current_period_end: daysFrom(FIXED_NOW, -30),
      grace_ends_at: daysFrom(FIXED_NOW, -20),
    });

    const first = service.runLapseSweep();
    expect(first.toGrace).toEqual([1]);
    expect(first.toReadOnly).toEqual([]);
    expect(repo.getByTenantId(1)?.status).toBe("grace");
    // ...and the stale deadline was replaced by a fresh one in the future.
    expect(repo.getByTenantId(1)?.grace_ends_at).toBe(daysFrom(FIXED_NOW, 7));
  });

  it("never touches a subscription whose period is still in the future", () => {
    repo.createForTenant(1, {
      status: "active",
      current_period_end: daysFrom(FIXED_NOW, 5),
    });
    expect(service.runLapseSweep().toGrace).toEqual([]);
    expect(repo.getByTenantId(1)?.status).toBe("active");
  });
});

describe("markPaid", () => {
  it("restores active, extends the period and CLEARS the old grace deadline", () => {
    repo.createForTenant(1, {
      status: "read_only",
      current_period_end: daysFrom(FIXED_NOW, -30),
      grace_ends_at: daysFrom(FIXED_NOW, -23),
    });

    const next = daysFrom(FIXED_NOW, 30);
    service.markPaid(1, next);

    const row = repo.getByTenantId(1);
    expect(row?.status).toBe("active");
    expect(row?.current_period_end).toBe(next);
    // The trap: a stale grace_ends_at in the PAST would make the next lapse
    // skip grace entirely and go straight to read_only.
    expect(row?.grace_ends_at).toBeNull();
  });

  it("a second lapse after paying still gets a full grace window", () => {
    repo.createForTenant(1, {
      status: "grace",
      current_period_end: daysFrom(FIXED_NOW, -8),
      grace_ends_at: daysFrom(FIXED_NOW, -1),
    });

    service.markPaid(1, daysFrom(FIXED_NOW, -1)); // paid, but already expiring
    const result = service.runLapseSweep();

    expect(result.toGrace).toEqual([1]);
    expect(result.toReadOnly).toEqual([]);
    expect(repo.getByTenantId(1)?.grace_ends_at).toBe(daysFrom(FIXED_NOW, 7));
  });

  it("preserves the module allowlist — paying is not an upgrade", () => {
    repo.createForTenant(1, {
      status: "read_only",
      entitled_modules: '["pos"]',
    });
    service.markPaid(1, daysFrom(FIXED_NOW, 30));
    expect(repo.getByTenantId(1)?.entitled_modules).toBe('["pos"]');
  });
});

describe("createForTenant is idempotent", () => {
  it("a second call does not throw or duplicate", () => {
    const first = repo.createForTenant(1, { entitled_modules: '["pos"]' });
    const second = repo.createForTenant(1, {
      entitled_modules: '["exchange"]',
    });

    // Same row, and the FIRST call's data wins — provisioning is not an
    // update path, so a retry must not silently rewrite entitlements.
    expect(second.id).toBe(first.id);
    expect(second.entitled_modules).toBe('["pos"]');
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM tenant_subscriptions").get(),
    ).toEqual({ c: 1 });
  });
});
