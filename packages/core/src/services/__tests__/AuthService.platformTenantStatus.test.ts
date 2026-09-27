/**
 * W6 — tenant status (active/suspended/archived) must gate login and session
 * validation from the PLATFORM row, never a shop file's local `tenants`
 * mirror (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.2: "the platform row
 * is the truth"). Before this fix, both gates read `tenants` from whichever
 * file was in ambient scope:
 *
 *   - `AuthService.login()` calls `UserRepository.getTenantStatus()`, which
 *     ran a bare `SELECT status FROM tenants WHERE id = ?` against the
 *     CURRENT scope. Login already runs inside `runWithTenant(realm)`
 *     (B-D2), so in per-tenant mode that query lands on the shop's own file
 *     — its local mirror row — not the platform file where a super admin's
 *     suspend action actually lands.
 *   - `SessionRepository.validateSession()` used a `LEFT JOIN tenants t ON
 *     t.id = s.tenant_id` in the SAME query as the session lookup, which
 *     forces the join onto whichever single file the session row itself
 *     lives in (the shop's file, per B-D1) — the mirror again.
 *
 * Net effect: a super admin suspends a shop on the platform, and that shop's
 * existing sessions keep working and its users can still log in, because the
 * gate never looked at the row the super admin actually changed.
 *
 * Harness: two REAL temporary `better-sqlite3` files built from
 * `electron-app/create_db.sql`, routed through the exact
 * `setDatabaseResolver()` + `runWithTenant`/`runWithoutTenant` seam
 * `backend/src/database/connection.ts` installs in `per-tenant` mode — same
 * shape as `AuthService.perTenantDbRouting.test.ts` and
 * `SubscriptionRepository.platformScope.test.ts`. The shop file's own
 * `tenants` row (the mirror) is LEFT active throughout every test below —
 * only the platform row ever changes — so any test that passed by
 * accidentally reading the mirror is caught immediately.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  getDatabase,
  setDatabaseResolver,
  initDatabase,
  closeDatabase,
} from "../../db/connection.js";
import {
  runWithTenant,
  runWithoutTenant,
  getCurrentTenantId,
  isTenantBypass,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { TenantDatabasePool } from "../../db/tenantDatabasePool.js";
import { getAuthService, resetAuthService } from "../AuthService.js";
import {
  getUserRepository,
  resetUserRepository,
} from "../../repositories/UserRepository.js";
import {
  getSessionRepository,
  resetSessionRepository,
} from "../../repositories/SessionRepository.js";
import { hashPassword } from "../../utils/crypto.js";

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);
const CREATE_DB_SQL = fs.readFileSync(CREATE_DB_SQL_PATH, "utf8");

const SHOP_ID = 5;
const SHOP_USERNAME = "shopadmin";
const SHOP_PASSWORD = "Str0ng-Password!5";

function buildShopFile(dir: string): string {
  const filePath = path.join(dir, `${SHOP_ID}.db`);
  const db = new Database(filePath);
  db.exec(CREATE_DB_SQL);
  // The shop's own local MIRROR row — deliberately left 'active' for the
  // whole suite. If any gate reads THIS row instead of the platform's, the
  // suspended-tenant tests below would wrongly pass.
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, 'active')`,
  ).run(SHOP_ID, `Shop ${SHOP_ID}`, `shop${SHOP_ID}`);
  db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (?, ?, ?, 'admin', 1)`,
  ).run(SHOP_ID, SHOP_USERNAME, hashPassword(SHOP_PASSWORD));
  db.close();
  return filePath;
}

/** The control-plane file: the row that is actually the truth. */
function buildPlatformFile(dir: string): string {
  const filePath = path.join(dir, "platform.db");
  const db = new Database(filePath);
  db.exec(CREATE_DB_SQL);
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, 'active')`,
  ).run(SHOP_ID, `Shop ${SHOP_ID}`, `shop${SHOP_ID}`);
  db.close();
  return filePath;
}

describe("Tenant status gate reads the PLATFORM row, not a shop file's mirror (plan § 12/B-D)", () => {
  let dir: string;
  let pool: TenantDatabasePool;
  let platformDb: Database.Database;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-tenant-status-"));
    buildShopFile(dir);
    const platformPath = buildPlatformFile(dir);
    platformDb = new Database(platformPath);

    pool = new TenantDatabasePool({
      dir,
      openDatabase: (filePath) => new Database(filePath),
      migrate: () => {
        // create_db.sql already seeds schema_migrations as fully applied.
      },
    });

    // Same routing contract `backend/src/database/tenantDbResolver.ts`
    // (`buildTenantDbResolver`) implements.
    initDatabase(platformDb);
    setDatabaseResolver(() => {
      if (isTenantBypass()) return platformDb;
      try {
        return pool.get(getCurrentTenantId());
      } catch {
        return platformDb;
      }
    });

    resetUserRepository();
    resetSessionRepository();
    resetAuthService();
  });

  afterEach(() => {
    setDatabaseResolver(null);
    pool.closeAll();
    platformDb.close();
    closeDatabase();
    resetTenantContext();
    resetUserRepository();
    resetSessionRepository();
    resetAuthService();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("baseline: login and session validation succeed while the platform row is active", async () => {
    const authService = getAuthService();
    const login = await runWithTenant(SHOP_ID, () =>
      authService.login(SHOP_USERNAME, SHOP_PASSWORD, {
        realm: SHOP_ID,
        deviceType: "web",
      }),
    );
    expect(login.success).toBe(true);

    const validated = await runWithTenant(SHOP_ID, () =>
      authService.validateSession(login.token!),
    );
    expect(validated).not.toBeNull();
  });

  it("(a) refuses login for a shop the PLATFORM row marks suspended, even though the shop's own mirror row still says active", async () => {
    const authService = getAuthService();

    platformDb
      .prepare(`UPDATE tenants SET status = 'suspended' WHERE id = ?`)
      .run(SHOP_ID);
    // The shop's own mirror is untouched — still 'active'.
    expect(
      (
        pool
          .get(SHOP_ID)
          .prepare(`SELECT status FROM tenants WHERE id = ?`)
          .get(SHOP_ID) as { status: string }
      ).status,
    ).toBe("active");

    const login = await runWithTenant(SHOP_ID, () =>
      authService.login(SHOP_USERNAME, SHOP_PASSWORD, {
        realm: SHOP_ID,
        deviceType: "web",
      }),
    );
    expect(login.success).toBe(false);
    expect(login.error).toMatch(/suspended/i);
  });

  it("(b) an existing session no longer validates once the PLATFORM row is suspended, and the session row is NOT deleted", async () => {
    const authService = getAuthService();
    const login = await runWithTenant(SHOP_ID, () =>
      authService.login(SHOP_USERNAME, SHOP_PASSWORD, {
        realm: SHOP_ID,
        deviceType: "web",
      }),
    );
    expect(login.success).toBe(true);
    const token = login.token!;

    platformDb
      .prepare(`UPDATE tenants SET status = 'suspended' WHERE id = ?`)
      .run(SHOP_ID);

    const validated = await runWithTenant(SHOP_ID, () =>
      authService.validateSession(token),
    );
    expect(validated).toBeNull();

    // NOT deleted -- it can revive on reactivation (unlike an expired session).
    const sessionRow = pool
      .get(SHOP_ID)
      .prepare(`SELECT id FROM sessions WHERE token = ?`)
      .get(token);
    expect(sessionRow).toBeTruthy();
  });

  it("(c) reactivating the PLATFORM row makes the same session valid again", async () => {
    const authService = getAuthService();
    const login = await runWithTenant(SHOP_ID, () =>
      authService.login(SHOP_USERNAME, SHOP_PASSWORD, {
        realm: SHOP_ID,
        deviceType: "web",
      }),
    );
    const token = login.token!;

    platformDb
      .prepare(`UPDATE tenants SET status = 'suspended' WHERE id = ?`)
      .run(SHOP_ID);
    const rejectedWhileSuspended = await runWithTenant(SHOP_ID, () =>
      authService.validateSession(token),
    );
    expect(rejectedWhileSuspended).toBeNull();

    platformDb
      .prepare(`UPDATE tenants SET status = 'active' WHERE id = ?`)
      .run(SHOP_ID);
    const revived = await runWithTenant(SHOP_ID, () =>
      authService.validateSession(token),
    );
    expect(revived).not.toBeNull();
    expect(revived?.tenant_id).toBe(SHOP_ID);
  });

  it("platform-realm (super_admin, tenant_id NULL) sessions skip the tenant gate entirely", async () => {
    // No tenants row exists for `null` — a bypass-scope validate must never
    // attempt (or need) a status lookup at all.
    platformDb
      .prepare(
        `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (NULL, ?, ?, 'super_admin', 1)`,
      )
      .run("root", hashPassword("Str0ng-RootPass!"));
    resetUserRepository();
    resetSessionRepository();
    resetAuthService();
    const authService = getAuthService();

    const login = await runWithoutTenant(() =>
      authService.login("root", "Str0ng-RootPass!", {
        realm: null,
        deviceType: "web",
      }),
    );
    expect(login.success).toBe(true);

    const validated = await runWithoutTenant(() =>
      authService.validateSession(login.token!),
    );
    expect(validated?.role).toBe("super_admin");
  });
});
