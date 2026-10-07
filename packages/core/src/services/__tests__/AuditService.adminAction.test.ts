/**
 * W2 (control plane) — `AuditService.logAdminAction()` (B-D3,
 * `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.1/12.2).
 *
 * Proves, against TWO real temporary SQLite files (a platform file and a
 * shop file, both built from the real `electron-app/create_db.sql` +
 * `runMigrations`, wired through the same `setDatabaseResolver()` seam
 * `backend/src/database/connection.ts` installs in `per-tenant` mode):
 *
 *  1. The platform row lands with `tenant_id NULL` in the PLATFORM file,
 *     under the super admin's OWN (valid) platform identity — and this is
 *     also the fix for the pre-existing bug where subscription-change /
 *     licence-key audit writes were silently dropped (`AuditRepository.log()`
 *     threw resolving `tenant_id` with no scope at all).
 *  2. The shop-note row lands in the SHOP's OWN file, tenant_id auto-filled
 *     to that shop, `user_id = 0` / `role = 'super_admin'` (never the
 *     platform actor's real numeric id, which cannot be told apart from a
 *     real shop user once written into a column with no FK), impersonator_id
 *     NULL, and passes `PRAGMA foreign_key_check(audit_log)` in that file.
 *  3. A separate, hand-inserted row (bypassing all production code) with a
 *     non-NULL `impersonator_id` pointing at a nonexistent user IS flagged by
 *     the same check — proving the check is real, not vacuously empty.
 *
 * Rule 17 note: written AFTER `AuditService.logAdminAction()` /
 * `AuditRepository.log()`'s bypass-aware `tenant_id` were already
 * implemented — NOT proven failing-first (rule 17 forbids reverting the
 * finished fix to manufacture that proof). Test 3 above is the closest
 * substitute available without touching production code: it demonstrates
 * directly, via a hand-inserted row, what the FK constraint actually
 * enforces, so the reader can see the exact failure the fix (NULL +
 * metadata) avoids.
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
import * as tenantContextModule from "../../db/tenantContext.js";
import { runMigrations } from "../../db/migrations/index.js";
import { getAuditService, resetAuditService } from "../AuditService.js";
import { resetAuditRepository } from "../../repositories/AuditRepository.js";

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

describe("AuditService.logAdminAction() — B-D3 platform row + shop note", () => {
  let platformDb: Database.Database;
  let shopDb: Database.Database;
  let superAdminId: number;
  let shopAdminId: number;

  beforeEach(() => {
    resetAuditService();
    resetAuditRepository();

    platformDb = freshDb();
    platformDb.exec(
      `INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Shop Five', 'shop-five', 'active');`,
    );
    superAdminId = Number(
      platformDb
        .prepare(
          `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
           VALUES (NULL, 'root', 'x', 'super_admin', 1)`,
        )
        .run().lastInsertRowid,
    );

    // Shop 5's OWN file. create_db.sql seeds tenant id=1 + admin user id=1
    // tenant_id=1 — rename both to the shop's REAL id (decision A-D1(a)),
    // matching what Phase D's split script does.
    shopDb = freshDb();
    // `runMigrations()` leaves `foreign_keys = ON` — this rename touches only
    // `tenants`/`users` here (every other tenant_id=1 reference in this test
    // fixture is irrelevant to the audit_log FK this suite is about), so FK
    // enforcement is toggled off for exactly this statement, same technique
    // the migration runner itself uses for table rebuilds.
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
        return platformDb; // runWithoutTenant() bypass, or no scope at all.
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

  it("writes the platform row with tenant_id NULL under the super admin's own identity — and this is the dropped-audit-bug fix", () => {
    // Exercised the way admin.ts calls it for e.g. a subscription-change
    // audit — no ambient runWithTenant/runWithoutTenant wrapping at the call
    // site at all, exactly the shape that used to throw inside
    // AuditRepository.log()'s unconditional getCurrentTenantId() and get
    // silently swallowed by the old AuditService.log().
    getAuditService().logAdminAction({
      actorUserId: superAdminId,
      actorUsername: "root",
      actorRole: "super_admin",
      targetTenantId: 5,
      action: "update",
      entityType: "subscription",
      entityId: "5",
      summary: "Updated subscription for tenant 5",
      newValues: { status: "active" },
    });

    const platformRow = platformDb
      .prepare(
        `SELECT * FROM audit_log WHERE action = 'update' AND entity_type = 'subscription' ORDER BY id DESC LIMIT 1`,
      )
      .get() as
      | {
          tenant_id: number | null;
          user_id: number;
          username: string;
          metadata: string | null;
        }
      | undefined;
    expect(platformRow).toBeDefined();
    expect(platformRow!.tenant_id).toBeNull();
    expect(platformRow!.user_id).toBe(superAdminId);
    expect(platformRow!.username).toBe("root");
    expect(JSON.parse(platformRow!.metadata ?? "{}")).toMatchObject({
      targetTenantId: 5,
    });

    // logAdminAction() ALSO writes the shop-note row (that pairing is the
    // whole point of B-D3) — under the sentinel identity, never the super
    // admin's real platform id, and it lands in the SHOP's file, not here.
    const shopNote = shopDb
      .prepare(
        `SELECT * FROM audit_log WHERE action = 'update' AND entity_type = 'subscription'`,
      )
      .get() as { tenant_id: number; user_id: number; role: string } | undefined;
    expect(shopNote).toBeDefined();
    expect(shopNote!.tenant_id).toBe(5);
    expect(shopNote!.user_id).toBe(0);
    expect(shopNote!.role).toBe("super_admin");

    // And the platform's OWN file has exactly one such row, not two.
    const countInPlatform = (
      platformDb
        .prepare(
          `SELECT COUNT(*) as n FROM audit_log WHERE action = 'update' AND entity_type = 'subscription'`,
        )
        .get() as { n: number }
    ).n;
    expect(countInPlatform).toBe(1);
  });

  it("writes the shop-note row in the shop's OWN file with user_id=0/role=super_admin, impersonator_id NULL, and it passes PRAGMA foreign_key_check", () => {
    getAuditService().logAdminAction({
      actorUserId: superAdminId,
      actorUsername: "root",
      actorRole: "super_admin",
      targetTenantId: 5,
      action: "delete",
      entityType: "tenant",
      entityId: "5",
      summary: 'Permanently deleted tenant "Shop Five" (shop-five)',
      oldValues: { name: "Shop Five", slug: "shop-five" },
    });

    const shopRow = shopDb
      .prepare(
        `SELECT * FROM audit_log WHERE action = 'delete' AND entity_type = 'tenant' ORDER BY id DESC LIMIT 1`,
      )
      .get() as
      | {
          tenant_id: number | null;
          user_id: number;
          role: string;
          impersonator_id: number | null;
        }
      | undefined;
    expect(shopRow).toBeDefined();
    expect(shopRow!.tenant_id).toBe(5);
    // Sentinel — NEVER the super admin's real platform id (which is not a
    // real shop user and could be mistaken for one; see AuditService.ts).
    expect(shopRow!.user_id).toBe(0);
    expect(shopRow!.role).toBe("super_admin");
    expect(shopRow!.impersonator_id).toBeNull();

    const violations = shopDb
      .prepare(`PRAGMA foreign_key_check(audit_log)`)
      .all();
    expect(violations).toEqual([]);
  });

  it("a shop-scoped IMPERSONATION_START-style row with impersonator_id NULL also passes the FK check — the exact write admin.ts now performs", () => {
    runWithTenant(5, () => {
      getAuditService().log({
        user_id: shopAdminId,
        username: "admin",
        role: "admin",
        action: "IMPERSONATION_START",
        entity_type: "session",
        entity_id: "1",
        summary: "Super admin root connected as admin",
        impersonator_id: null,
        metadata: { impersonatedBy: "root", impersonatorUserId: superAdminId },
      });
    });

    const row = shopDb
      .prepare(
        `SELECT * FROM audit_log WHERE action = 'IMPERSONATION_START' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { impersonator_id: number | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.impersonator_id).toBeNull();
    expect(
      shopDb.prepare(`PRAGMA foreign_key_check(audit_log)`).all(),
    ).toEqual([]);
  });

  it("by contrast: a hand-inserted row with a non-NULL impersonator_id pointing at a nonexistent user IS flagged — proving the check is real", () => {
    // Deliberately bypasses AuditRepository/AuditService — this is a direct,
    // manual INSERT to demonstrate what the FK constraint catches, not a
    // reversion of any production code. Live FK enforcement (ON since
    // runMigrations()) would otherwise reject this INSERT outright rather
    // than let it land as a row for foreign_key_check to flag — toggled off
    // for exactly this one statement, same as the tenant-rename above.
    shopDb.pragma("foreign_keys = OFF");
    shopDb
      .prepare(
        `INSERT INTO audit_log
           (tenant_id, user_id, username, role, action, entity_type, summary, impersonator_id)
         VALUES (5, ?, 'admin', 'admin', 'IMPERSONATION_START', 'session', 'manual negative control', 999999)`,
      )
      .run(shopAdminId);
    shopDb.pragma("foreign_keys = ON");

    const violations = shopDb
      .prepare(`PRAGMA foreign_key_check(audit_log)`)
      .all();
    expect(violations.length).toBeGreaterThan(0);
  });

  // LIRA-267: a platform action with NO target shop (sending a sign-up
  // invite). Only the platform row may be written — never a "shop note"
  // into some shop's history, and never a second platform row.
  it("with targetTenantId null writes ONLY the platform row and no shop note", () => {
    // The shop-note write must be SKIPPED, not attempted-and-swallowed:
    // entering runWithTenant(null) throws TenantContextError, which the
    // service would catch and log as an error on every single invite.
    const runWithTenantSpy = jest.spyOn(tenantContextModule, "runWithTenant");
    getAuditService().logAdminAction({
      actorUserId: superAdminId,
      actorUsername: "root",
      actorRole: "super_admin",
      targetTenantId: null,
      action: "signup_invitation.create",
      entityType: "signup_invitation",
      entityId: "12",
      summary: "Sent a sign-up invite to owner@example.com",
      newValues: { email: "owner@example.com" },
    });

    const platformRows = platformDb
      .prepare(
        `SELECT tenant_id, user_id, metadata FROM audit_log
          WHERE action = 'signup_invitation.create'`,
      )
      .all() as Array<{
      tenant_id: number | null;
      user_id: number;
      metadata: string | null;
    }>;
    expect(platformRows).toHaveLength(1);
    expect(platformRows[0]!.tenant_id).toBeNull();
    expect(platformRows[0]!.user_id).toBe(superAdminId);
    expect(JSON.parse(platformRows[0]!.metadata ?? "{}")).toMatchObject({
      targetTenantId: null,
    });

    const shopRows = shopDb
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'signup_invitation.create'`,
      )
      .get() as { n: number };
    expect(shopRows.n).toBe(0);
    expect(runWithTenantSpy).not.toHaveBeenCalled();
    runWithTenantSpy.mockRestore();
  });
});
