/**
 * Phase A headline guard (`docs/plans/ongoing_plans/
 * PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.3, test 1).
 *
 * A process-wide singleton repository built while one tenant's connection is
 * current must keep following the CURRENT connection on every later call —
 * not freeze on whichever one was current the first time something built it.
 * `ModuleRepository` (like 13 other repositories before this Phase A fix)
 * captures `getDatabase()` once in its constructor, so the singleton keeps
 * serving the first tenant's file forever, regardless of which tenant is
 * actually current later. § 11.2 fixes this by making every access re-read
 * `getDatabase()` live.
 *
 * This test is written and run BEFORE the § 11.2 refactor (rule 17): it is
 * expected to FAIL on today's `ModuleRepository` and must be shown failing
 * before the fix lands.
 */
import Database from "better-sqlite3";
import { setDatabaseResolver } from "../../db/connection.js";
import {
  runWithTenant,
  getCurrentTenantId,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { getModuleRepository, resetModuleRepository } from "../ModuleRepository.js";

function seedModulesDb(tenantId: number, moduleKey: string): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE modules (
      key TEXT,
      label TEXT,
      icon TEXT,
      route TEXT,
      sort_order INTEGER,
      is_enabled INTEGER,
      admin_only INTEGER,
      is_system INTEGER,
      tenant_id INTEGER
    )
  `);
  db.prepare(
    `INSERT INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system, tenant_id)
     VALUES (?, ?, 'icon', '/route', 1, 1, 0, 0, ?)`,
  ).run(moduleKey, moduleKey, tenantId);
  return db;
}

describe("singleton repository under per-tenant connection routing", () => {
  let db1: Database.Database;
  let db5: Database.Database;

  beforeEach(() => {
    db1 = seedModulesDb(1, "tenant1_only_module");
    db5 = seedModulesDb(5, "tenant5_only_module");
    resetModuleRepository();
  });

  afterEach(() => {
    setDatabaseResolver(null);
    resetModuleRepository();
    resetTenantContext();
    db1.close();
    db5.close();
  });

  it("keeps following the CURRENT tenant's connection after the resolver moves on, not the one current when it was first built", () => {
    setDatabaseResolver(() => (getCurrentTenantId() === 1 ? db1 : db5));

    // First use happens while tenant 1 is current — this is what constructs
    // the singleton (`getModuleRepository()` lazily builds it on first call).
    const tenant1Keys = runWithTenant(1, () =>
      getModuleRepository()
        .getAll()
        .map((m) => m.key),
    );
    expect(tenant1Keys).toEqual(["tenant1_only_module"]);

    // The SAME singleton instance is reused for tenant 5 — that is the whole
    // point of the singleton pattern — but it must now read tenant 5's file.
    const tenant5Keys = runWithTenant(5, () =>
      getModuleRepository()
        .getAll()
        .map((m) => m.key),
    );
    expect(tenant5Keys).toEqual(["tenant5_only_module"]);
  });
});
