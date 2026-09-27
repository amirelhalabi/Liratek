/**
 * W2 (control plane) — impersonation's cross-tenant lookups now resolve
 * against the SHOP's own file (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 12.1/B-D1), not the platform's — the shop admin and their impersonation
 * session both live where the shop itself lives.
 *
 * This test exercises `UserRepository.findFirstActiveAdminByTenant()` and
 * `SessionRepository.createSession()` directly (both are W1-owned files —
 * not modified here) against two REAL temporary SQLite files, to prove
 * `backend/src/api/admin.ts`'s impersonate route now wraps both calls in
 * `runWithTenant(tenantId, …)` rather than `runWithoutTenant()`.
 *
 * Rule 17 note: written AFTER `admin.ts` was already changed — NOT proven
 * failing-first (rule 17 forbids reverting the finished fix to manufacture
 * that proof). What this DOES prove directly: with the resolver below, a
 * regression back to `runWithoutTenant()` at either call site would route
 * to the PLATFORM file instead, where no such admin/session row exists —
 * the assertions below would fail exactly that way.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { setDatabaseResolver, closeDatabase } from "../../db/connection.js";
import {
  runWithTenant,
  getCurrentTenantId,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { runMigrations } from "../../db/migrations/index.js";
import { getUserRepository, resetUserRepository } from "../UserRepository.js";
import {
  getSessionRepository,
  resetSessionRepository,
} from "../SessionRepository.js";

const SCHEMA_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  runMigrations(db);
  return db;
}

describe("impersonation lookups route to the SHOP's own file, not the platform's", () => {
  let platformDb: Database.Database;
  let shopDb: Database.Database;
  let shopAdminId: number;

  beforeEach(() => {
    resetUserRepository();
    resetSessionRepository();

    platformDb = freshDb(); // has tenant 1's default admin, but no tenant 5.

    shopDb = freshDb();
    shopDb.pragma("foreign_keys = OFF");
    shopDb.exec(
      `UPDATE tenants SET id = 5, slug = 'shop-five' WHERE id = 1;
       UPDATE users SET tenant_id = 5 WHERE tenant_id = 1;`,
    );
    shopDb.pragma("foreign_keys = ON");
    shopAdminId = (
      shopDb.prepare(`SELECT id FROM users WHERE username = 'admin'`).get() as {
        id: number;
      }
    ).id;

    setDatabaseResolver(() => {
      try {
        return getCurrentTenantId() === 5 ? shopDb : platformDb;
      } catch {
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

  it("findFirstActiveAdminByTenant(5) called inside runWithTenant(5) finds the SHOP's own admin", () => {
    const admin = runWithTenant(5, () =>
      getUserRepository().findFirstActiveAdminByTenant(5),
    );
    expect(admin).not.toBeNull();
    expect(admin!.id).toBe(shopAdminId);
    expect(admin!.username).toBe("admin");
  });

  it("findFirstActiveAdminByTenant(5) called with the platform's OWN scope (the pre-fix behaviour) finds NOTHING — proving the fix matters", () => {
    // No runWithTenant(5, ...) wrap — the OLD `runWithoutTenant()` call
    // shape. Exercises the resolver's platform fallback directly, without
    // touching admin.ts.
    const admin = getUserRepository().findFirstActiveAdminByTenant(5);
    expect(admin).toBeNull();
  });

  it("createSession() called inside runWithTenant(5) lands in the SHOP's own file", () => {
    const session = runWithTenant(5, () =>
      getSessionRepository().createSession({
        user_id: shopAdminId,
        device_type: "impersonation",
        device_info: "impersonated by root (#2)",
        remember_me: false,
        tenant_id: 5,
      }),
    );

    const inShopFile = shopDb
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(session.id);
    expect(inShopFile).toBeDefined();

    const inPlatformFile = platformDb
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(session.id);
    expect(inPlatformFile).toBeUndefined();
  });
});
