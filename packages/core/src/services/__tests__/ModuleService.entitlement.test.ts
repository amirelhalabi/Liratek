/**
 * ModuleService — the entitlement intersection (v173).
 *
 * `is_enabled` is the tenant's OWN choice; `entitled_modules` is what they pay
 * for and cannot edit. A shop gets modules that are both, and this is the one
 * place that rule is applied — the single read the nav and Settings are built
 * from, so it covers IPC and REST together.
 *
 * The failing-open cases are the ones with consequences. Two paying desktop
 * customers were live when this landed and neither had a licence key: a gate
 * that guessed "restricted" on missing information would have emptied their
 * sidebar mid-shift.
 */

import Database from "better-sqlite3";
import { ModuleRepository } from "../../repositories/ModuleRepository.js";
import { SubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import { ModuleService } from "../ModuleService.js";
import { SubscriptionService } from "../SubscriptionService.js";
import { runWithTenant, runWithoutTenant } from "../../db/tenantContext.js";

/**
 * ModuleRepository extends BaseRepository and resolves its own connection, so
 * it cannot be handed a database. `__LIRATEK_TEST_DB__` is connection.ts's
 * documented hook for exactly this. Set it before constructing anything, and
 * clear it afterwards so no other suite inherits this database.
 */
type TestDbGlobal = { __LIRATEK_TEST_DB__?: Database.Database };
function useTestDb(instance: Database.Database): void {
  (globalThis as TestDbGlobal).__LIRATEK_TEST_DB__ = instance;
}
function clearTestDb(): void {
  delete (globalThis as TestDbGlobal).__LIRATEK_TEST_DB__;
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
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
    CREATE TABLE modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      icon TEXT,
      route TEXT,
      sort_order INTEGER DEFAULT 0,
      is_enabled BOOLEAN DEFAULT 1,
      admin_only BOOLEAN DEFAULT 0,
      is_system BOOLEAN DEFAULT 0
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'Shop', 'shop');
    INSERT INTO modules (tenant_id, key, label, sort_order, is_enabled, is_system) VALUES
      (1, 'dashboard',  'Dashboard',  0,  1, 1),
      (1, 'settings',   'Settings',   1,  1, 1),
      (1, 'pos',        'POS',        2,  1, 0),
      (1, 'inventory',  'Inventory',  3,  1, 0),
      (1, 'exchange',   'Exchange',   4,  1, 0),
      (1, 'recharge',   'Recharge',   5,  0, 0);
  `);
  return db;
}

let db: Database.Database;
let modules: ModuleService;
let subscriptions: SubscriptionRepository;

function keysOf(list: { key: string }[]): string[] {
  return list.map((m) => m.key).sort();
}

beforeEach(() => {
  db = createTestDb();
  useTestDb(db);
  subscriptions = new SubscriptionRepository(db);
  modules = new ModuleService(
    new ModuleRepository(),
    new SubscriptionService(subscriptions),
  );
});

afterEach(() => {
  clearTestDb();
  db.close();
});

describe("with no restriction", () => {
  it("no subscription row -> every enabled module (grandfathering)", () => {
    const list = runWithTenant(1, () => modules.getEnabledModules());
    expect(keysOf(list)).toEqual([
      "dashboard",
      "exchange",
      "inventory",
      "pos",
      "settings",
    ]);
    // `recharge` is absent because the TENANT disabled it, not because of a
    // plan — the two reasons must not be confused.
    expect(keysOf(list)).not.toContain("recharge");
  });

  it("a NULL allowlist -> every enabled module", () => {
    subscriptions.createForTenant(1, { entitled_modules: null });
    const list = runWithTenant(1, () => modules.getEnabledModules());
    expect(keysOf(list)).toContain("exchange");
  });
});

describe("with an allowlist — the owner's basics customer", () => {
  beforeEach(() => {
    subscriptions.createForTenant(1, {
      entitled_modules: '["pos","inventory"]',
    });
  });

  it("keeps what is paid for and drops what is not", () => {
    const list = runWithTenant(1, () => modules.getEnabledModules());
    expect(keysOf(list)).toContain("pos");
    expect(keysOf(list)).toContain("inventory");
    expect(keysOf(list)).not.toContain("exchange");
  });

  it("NEVER drops the chassis, whatever the allowlist says", () => {
    const list = runWithTenant(1, () => modules.getEnabledModules());
    // Losing settings would make the licence key unenterable — the one
    // failure a customer could not recover from unaided.
    expect(keysOf(list)).toContain("settings");
    expect(keysOf(list)).toContain("dashboard");
  });

  it("filters the Settings > Modules list too", () => {
    // Otherwise an admin toggles Exchange on, sees it confirmed, and never
    // finds it in the nav — which reads as a bug, not a plan boundary.
    const list = runWithTenant(1, () => modules.getToggleableModules());
    expect(keysOf(list)).toContain("pos");
    expect(keysOf(list)).not.toContain("exchange");
  });

  it("an entitled-but-DISABLED module stays hidden", () => {
    // Entitlement is permission, not a switch. The tenant's own choice wins
    // within what they pay for.
    subscriptions.update(1, { entitled_modules: '["pos","recharge"]' });
    const list = runWithTenant(1, () => modules.getEnabledModules());
    expect(keysOf(list)).not.toContain("recharge");
  });
});

describe("fails OPEN", () => {
  beforeEach(() => {
    subscriptions.createForTenant(1, { entitled_modules: '["pos"]' });
  });

  it("a contextless read throws from the REPOSITORY, not from the gate", () => {
    // Corrects an assumption this test originally made. Reading modules
    // without a tenant context never worked: ModuleRepository extends
    // BaseRepository and calls getCurrentTenantId() itself, which is
    // fail-closed inside runWithoutTenant(). So there is no unfiltered list
    // to observe here, and the gate is not what refuses.
    //
    // Pinned rather than deleted, because the useful fact is that the gate
    // did NOT change this: it neither converts a working read into a throw
    // nor swallows the repository's own contextless refusal. The gate's own
    // try/catch around getCurrentTenantId stays as belt-and-braces for any
    // future caller that reaches it before the repository.
    expect(() => runWithoutTenant(() => modules.getEnabledModules())).toThrow(
      /runWithoutTenant/,
    );
  });

  it("a thrown subscription lookup -> unfiltered", () => {
    const exploding = {
      statusFor: () => {
        throw new Error("no such table: tenant_subscriptions");
      },
    } as unknown as SubscriptionService;

    const service = new ModuleService(new ModuleRepository(), exploding);
    const list = runWithTenant(1, () => service.getEnabledModules());
    expect(keysOf(list)).toContain("exchange");
  });

  it("a CORRUPT allowlist -> unfiltered", () => {
    subscriptions.update(1, { entitled_modules: "{not json" });
    const list = runWithTenant(1, () => modules.getEnabledModules());
    expect(keysOf(list)).toContain("exchange");
  });
});

describe("read_only does not hide anything", () => {
  it("a lapsed shop still SEES its modules — writes are blocked elsewhere", () => {
    subscriptions.createForTenant(1, {
      status: "read_only",
      entitled_modules: null,
    });
    const list = runWithTenant(1, () => modules.getEnabledModules());
    // D4: reads are never blocked. Emptying the nav would be a lockout by
    // another route.
    expect(keysOf(list)).toContain("exchange");
    expect(keysOf(list)).toContain("pos");
  });
});
