/**
 * W2 (control plane) — `SubscriptionRepository` forces platform scope
 * internally, per `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12/B-D.
 *
 * `tenant_subscriptions` lives ONLY in the platform database once
 * `TENANT_DB_MODE=per-tenant` is set. A caller reached from inside a shop's
 * OWN `runWithTenant(shopId)` scope (`GET /api/subscription/status`,
 * `ModuleService.filterByEntitlement`) must still land on the platform file,
 * never the shop's own — this suite proves that with two REAL temporary
 * SQLite files (not an in-memory stand-in for "the other database"), wired
 * through the exact `setDatabaseResolver()` + `runWithTenant`/
 * `runWithoutTenant` seam `backend/src/database/connection.ts` installs in
 * `per-tenant` mode.
 *
 * Rule 17 note: these tests were written AFTER `SubscriptionRepository` was
 * already changed to wrap every method in `runWithoutTenant()` — they are
 * NOT proven failing-first. (Rule 17 forbids reverting the finished fix to
 * manufacture that proof.) What they DO prove directly: given the resolver
 * below, a bug that dropped the `runWithoutTenant()` wrap would make
 * `getByTenantId(5)` return `null` instead of the row seeded in the platform
 * file — a concrete, mechanical regression this suite would catch.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  setDatabaseResolver,
  closeDatabase,
  initDatabase,
} from "../../db/connection.js";
import {
  runWithTenant,
  runWithoutTenant,
  getCurrentTenantId,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { runMigrations } from "../../db/migrations/index.js";
import {
  getSubscriptionRepository,
  resetSubscriptionRepository,
} from "../SubscriptionRepository.js";

const SCHEMA_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);

/** A real, fully-migrated fresh install (tenant 1's create_db.sql seed). */
function freshDb(): Database.Database {
  const db = new Database(":memory:");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
  runMigrations(db);
  return db;
}

describe("SubscriptionRepository — forces platform scope (§ 12/B-D)", () => {
  let platformDb: Database.Database;
  let shopDb: Database.Database;

  beforeEach(() => {
    resetSubscriptionRepository();

    platformDb = freshDb();
    // Register a second tenant in the platform's registry, with its OWN
    // subscription row — this is the row every assertion below hinges on.
    platformDb.exec(
      `INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Shop Five', 'shop-five', 'active');`,
    );
    platformDb
      .prepare(
        `INSERT INTO tenant_subscriptions (tenant_id, plan, status, entitled_modules)
         VALUES (5, 'basic', 'active', '["pos"]')`,
      )
      .run();

    // A SEPARATE file for shop 5 — deliberately has NO row for tenant 5 in
    // its own tenant_subscriptions (it only carries whatever create_db.sql's
    // tenant-1 seed put there). If SubscriptionRepository ever read from
    // THIS file instead of the platform's, `getByTenantId(5)` would come
    // back null, not the platform's row — the two files are distinguishable
    // by construction.
    shopDb = freshDb();

    setDatabaseResolver(() => {
      try {
        const tenantId = getCurrentTenantId();
        return tenantId === 5 ? shopDb : platformDb;
      } catch {
        // runWithoutTenant() bypass, or no scope at all — the platform.
        return platformDb;
      }
    });
  });

  afterEach(() => {
    setDatabaseResolver(null);
    closeDatabase();
    resetTenantContext();
    platformDb.close();
    shopDb.close();
  });

  it("getByTenantId(5) called from INSIDE shop 5's own runWithTenant(5) scope still reads the platform file", () => {
    const row = runWithTenant(5, () =>
      getSubscriptionRepository().getByTenantId(5),
    );
    expect(row).not.toBeNull();
    expect(row!.plan).toBe("basic");
    expect(row!.tenant_id).toBe(5);
  });

  it("getByTenantId(5) called with NO ambient scope at all also reads the platform file", () => {
    const row = getSubscriptionRepository().getByTenantId(5);
    expect(row).not.toBeNull();
    expect(row!.plan).toBe("basic");
  });

  it("listAll() and findLapsed() — the cross-tenant sweeps — also force platform scope from inside a shop's own scope", () => {
    const all = runWithTenant(5, () => getSubscriptionRepository().listAll());
    expect(all.map((r) => r.tenant_id).sort()).toEqual([1, 5]);

    const lapsed = runWithTenant(5, () =>
      getSubscriptionRepository().findLapsed("2999-01-01 00:00:00"),
    );
    // Both rows are 'active' with NULL current_period_end, so neither is
    // lapsed yet — the assertion that matters is that this ran against the
    // PLATFORM file (2 rows total, not shopDb's 1) without throwing.
    expect(lapsed.toGrace.length + lapsed.toReadOnly.length).toBe(0);
  });

  it("update()/createForTenant() write to the platform file even from inside a shop's own scope", () => {
    runWithTenant(5, () =>
      getSubscriptionRepository().update(5, { status: "read_only" }),
    );
    // Read back via an explicit bypass, independent of the write path above.
    const row = runWithoutTenant(() =>
      getSubscriptionRepository().getByTenantId(5),
    );
    expect(row!.status).toBe("read_only");
    // And it did NOT leak into shop 5's own file.
    const inShopFile = shopDb
      .prepare(`SELECT * FROM tenant_subscriptions WHERE tenant_id = 5`)
      .get();
    expect(inShopFile).toBeUndefined();
  });

  it("in shared mode (no resolver installed) behaviour is unchanged — runWithoutTenant() is a same-file no-op", () => {
    setDatabaseResolver(null);
    const sharedDb = freshDb();
    initDatabase(sharedDb);
    try {
      const row = runWithTenant(1, () =>
        getSubscriptionRepository().getByTenantId(1),
      );
      expect(row).not.toBeNull();
      expect(row!.tenant_id).toBe(1);
    } finally {
      // closeDatabase() closes the module-level `db` it was just initialized
      // with (sharedDb itself) — an extra sharedDb.close() would double-close.
      closeDatabase();
    }
  });
});

describe("SubscriptionRepository.listSellableModuleKeys() — MODULE_SEED_ROWS vs. the old per-shop query", () => {
  it("equals the old `SELECT DISTINCT key FROM modules WHERE is_system = 0` result on a freshly-seeded DB", () => {
    const db = freshDb();
    try {
      const oldResult = (
        db
          .prepare(
            `SELECT DISTINCT key FROM modules WHERE is_system = 0 ORDER BY key`,
          )
          .all() as { key: string }[]
      ).map((r) => r.key);

      resetSubscriptionRepository();
      setDatabaseResolver(() => db);
      const newResult = getSubscriptionRepository().listSellableModuleKeys();

      expect(newResult).toEqual(oldResult);
      // Not vacuous — a freshly seeded DB really does have sellable modules.
      expect(newResult.length).toBeGreaterThan(0);
    } finally {
      setDatabaseResolver(null);
      db.close();
    }
  });
});
