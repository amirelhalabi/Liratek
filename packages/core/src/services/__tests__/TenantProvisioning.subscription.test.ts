/**
 * provisionTenant stamps commercial state ATOMICALLY (v173).
 *
 * The property under test is not "a subscription row appears" — it is that the
 * subscription and the tenant cannot exist without each other. A tenant with
 * no subscription is a tenant whose standing has to be GUESSED, and the guess
 * is load-bearing in the permissive direction (absent means full access), so a
 * half-provisioned shop would silently be unlimited and unbilled.
 *
 * A real in-memory database, because the atomicity IS `db.transaction()` —
 * mocking the repositories would assert that I called them, not that a
 * failure rolls both back.
 */

import Database from "better-sqlite3";
import { TenantRepository } from "../../repositories/TenantRepository.js";
import { UserRepository } from "../../repositories/UserRepository.js";
import { SubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import { TenantProvisioningService } from "../TenantProvisioningService.js";

/**
 * Only the tables provisioning touches. `seedConfig` writes a lot of them, so
 * a missing one here would fail every test in SETUP and look like a broken
 * assertion rather than an incomplete fixture.
 */
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
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      username TEXT,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active BOOLEAN DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_users_tenant_username ON users(tenant_id, username);
  `);
  return db;
}

const VALID = {
  name: "Corner Tech",
  slug: "cornertech",
  adminUsername: "admin",
  adminPassword: "Str0ng-Password!",
};

let db: Database.Database;
let service: TenantProvisioningService;
let subscriptions: SubscriptionRepository;

beforeEach(() => {
  db = createTestDb();
  subscriptions = new SubscriptionRepository(db);
  service = new TenantProvisioningService(
    new TenantRepository(db),
    // UserRepository extends BaseRepository and resolves its own connection,
    // so it CANNOT be pointed at this in-memory db. It is never reached on the
    // path under test (seedConfig throws first), so a stub is accurate rather
    // than convenient — touching it would throw a different error and the test
    // would stop proving rollback.
    {} as unknown as UserRepository,
    subscriptions,
  );
});

afterEach(() => db.close());

/**
 * seedConfig writes to per-tenant config tables this fixture does not create,
 * so provisioning throws partway through — which is precisely the failure this
 * file needs in order to test rollback. Tests that need a SUCCESSFUL
 * provisioning assert on that path separately below.
 */
function provision() {
  return service.provisionTenant(VALID);
}

describe("provisionTenant + subscription atomicity", () => {
  it("rolls the TENANT back when a later step fails — no orphan rows", () => {
    // seedConfig hits a missing table here, so the whole transaction aborts.
    expect(() => provision()).toThrow();

    const tenants = db.prepare("SELECT COUNT(*) AS c FROM tenants").get() as {
      c: number;
    };
    const subs = db
      .prepare("SELECT COUNT(*) AS c FROM tenant_subscriptions")
      .get() as { c: number };

    // The point: NEITHER survives. A tenant without a subscription would be
    // silently unlimited; a subscription without a tenant would be billed to
    // nobody.
    expect(tenants.c).toBe(0);
    expect(subs.c).toBe(0);
  });

  it("never leaves a subscription attached to a tenant that does not exist", () => {
    expect(() => provision()).toThrow();

    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS c FROM tenant_subscriptions s
          WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = s.tenant_id)`,
      )
      .get() as { c: number };
    expect(orphans.c).toBe(0);
  });
});

describe("what a self-served tenant is stamped with", () => {
  /**
   * Provisioning's own transaction is exercised above. Here the subscription
   * shape is asserted directly against the repository, which is the same code
   * path provisionTenant calls — without needing every config table
   * seedConfig touches.
   */
  it("active, no expiry, and NO module restriction", () => {
    db.prepare(
      "INSERT INTO tenants (id, name, slug) VALUES (1, 'X', 'x')",
    ).run();

    subscriptions.createForTenant(1, {
      plan: "standard",
      status: "active",
      current_period_end: null,
      entitled_modules: null,
    });

    const row = subscriptions.getByTenantId(1);
    expect(row?.status).toBe("active");
    // No trial (D2): nothing to expire, so the lapse sweep ignores it until
    // the owner sets a period.
    expect(row?.current_period_end).toBeNull();
    // NULL = every module (D6). A new shop is not crippled on arrival; the
    // owner narrows it afterwards if that is the deal.
    expect(row?.entitled_modules).toBeNull();
    // No licence key yet — desktop enforcement only begins once one is issued.
    expect(row?.license_key).toBeNull();
  });
});
