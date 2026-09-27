/**
 * End-to-end proof that `AuthService.login()` / `validateSession()` route
 * every one of their DB calls (username lookup, tenant-status check,
 * session create/validate/touch, the global user fetch) to the CORRECT
 * physical file once per-tenant DB routing is live
 * (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.3 tests 1–3, § 12.1 B-D1/
 * B-D2). This is the workstream's headline proof, run against REAL
 * `better-sqlite3` files built from `electron-app/create_db.sql` (not a
 * hand-written partial schema — see reference_test_schema_completeness) and
 * a `TenantDatabasePool` wired the same way `backend/src/database/
 * connection.ts` wires it, so the resolver logic under test is the real
 * routing contract, not a stand-in.
 *
 * Covers:
 *   1. Login for shop 5 finds shop 5's own user and WRITES the session into
 *      shop 5's own file — never shop 1's, never the platform file.
 *   2. The identical username in two different shops resolves to the RIGHT
 *      shop's row purely from file routing (no cross-file leakage even
 *      without the tenant_id predicate doing the work).
 *   3. `validateSession()` under the scope a JWT's tenantId claim implies
 *      finds the session in that shop's file; validating the SAME token
 *      while routed to the WRONG shop's file finds nothing (proves the
 *      routing, not the SQL predicate, is what isolates the two).
 *   4. A platform-realm (super_admin) login/validate hits the platform file,
 *      never a tenant file.
 *   5. Two interleaved async logins for different tenants each keep their
 *      own file across an `await` inside `AuthService.login()` itself —
 *      the plan's explicit ask: "verify AsyncLocalStorage context survives
 *      into every DB call inside AuthService.login (createSession included)".
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTenantFile(
  dir: string,
  tenantId: number,
  username: string,
  password: string,
): string {
  const filePath = path.join(dir, `${tenantId}.db`);
  const db = new Database(filePath);
  db.exec(CREATE_DB_SQL);
  // Decision A-D1(a): the file keeps the shop's REAL id, not a rewritten 1 —
  // the create_db.sql default seed (id 1, username 'admin') is left in
  // place untouched and simply unused by this test.
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, 'active')`,
  ).run(tenantId, `Shop ${tenantId}`, `shop${tenantId}`);
  db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (?, ?, ?, 'admin', 1)`,
  ).run(tenantId, username, hashPassword(password));
  db.close();
  return filePath;
}

function buildPlatformFile(
  dir: string,
  username: string,
  password: string,
  tenantIds: number[] = [],
): string {
  const filePath = path.join(dir, "platform.db");
  const db = new Database(filePath);
  db.exec(CREATE_DB_SQL);
  db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (NULL, ?, ?, 'super_admin', 1)`,
  ).run(username, hashPassword(password));
  // W6 (PRODUCTION_DATABASE_AND_HOSTING_PLAN.md § 12.2): the platform row is
  // the truth for tenant STATUS — `UserRepository.getTenantStatus()` now
  // forces platform scope for every login/session-validate call, so a real
  // provisioned shop's control-plane row must exist here (a shop file's own
  // `tenants` row, seeded by `buildTenantFile`, is only ever the mirror).
  for (const tenantId of tenantIds) {
    db.prepare(
      `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, 'active')`,
    ).run(tenantId, `Shop ${tenantId}`, `shop${tenantId}`);
  }
  db.close();
  return filePath;
}

describe("AuthService — per-tenant DB routing (plan § 11.3 / § 12.1 B-D1/B-D2)", () => {
  let dir: string;
  let pool: TenantDatabasePool;
  let platformDb: Database.Database;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-auth-routing-"));
    buildTenantFile(dir, 5, "shopadmin", "Str0ng-Password!5");
    buildTenantFile(dir, 9, "shopadmin", "Str0ng-Password!9"); // SAME username, different shop
    const platformPath = buildPlatformFile(dir, "root", "Str0ng-RootPass!", [
      5, 9,
    ]);
    platformDb = new Database(platformPath);

    pool = new TenantDatabasePool({
      dir,
      openDatabase: (filePath) => new Database(filePath),
      migrate: () => {
        // create_db.sql already seeds schema_migrations as fully applied
        // (same convention DatabaseResetRepository.test.ts uses) — nothing
        // to run.
      },
    });

    // Same routing contract `backend/src/database/tenantDbResolver.ts`
    // (`buildTenantDbResolver`) implements: bypass or no active scope ->
    // the platform database; an active runWithTenant(id) -> pool.get(id).
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

  it("1+2. login for shop 5 finds shop 5's user and writes the session into shop 5's OWN file — the identical username in shop 9 stays isolated", async () => {
    const authService = getAuthService();

    const result5 = await runWithTenant(5, () =>
      authService.login("shopadmin", "Str0ng-Password!5", {
        realm: 5,
        deviceType: "web",
      }),
    );
    expect(result5.success).toBe(true);
    expect(result5.user?.tenant_id).toBe(5);
    expect(result5.token).toBeTruthy();

    // The session row landed in shop 5's file...
    const sessionInShop5 = pool
      .get(5)
      .prepare("SELECT * FROM sessions WHERE token = ?")
      .get(result5.token);
    expect(sessionInShop5).toBeTruthy();

    // ...and NOWHERE else: not shop 9's file, not the platform file.
    const sessionInShop9 = pool
      .get(9)
      .prepare("SELECT * FROM sessions WHERE token = ?")
      .get(result5.token);
    expect(sessionInShop9).toBeUndefined();
    const sessionInPlatform = platformDb
      .prepare("SELECT * FROM sessions WHERE token = ?")
      .get(result5.token);
    expect(sessionInPlatform).toBeUndefined();

    // Shop 9's OWN "shopadmin" login, with shop 5's password, must fail —
    // proving the two identically-named users never collide across files.
    const wrongPasswordOnShop9 = await runWithTenant(9, () =>
      authService.login("shopadmin", "Str0ng-Password!5", {
        realm: 9,
        deviceType: "web",
      }),
    );
    expect(wrongPasswordOnShop9.success).toBe(false);

    // But shop 9's OWN password for the SAME username succeeds, and resolves
    // to shop 9's row (tenant_id 9), not shop 5's.
    const result9 = await runWithTenant(9, () =>
      authService.login("shopadmin", "Str0ng-Password!9", {
        realm: 9,
        deviceType: "web",
      }),
    );
    expect(result9.success).toBe(true);
    expect(result9.user?.tenant_id).toBe(9);
    expect(result9.token).not.toBe(result5.token);
  });

  it("3. validateSession under the JWT-claim scope finds the session in that shop's file; the WRONG scope finds nothing", async () => {
    const authService = getAuthService();
    const result5 = await runWithTenant(5, () =>
      authService.login("shopadmin", "Str0ng-Password!5", {
        realm: 5,
        deviceType: "web",
      }),
    );
    const token = result5.token!;

    // Right scope (the JWT's own tenantId claim, per B-D1): found.
    const validated = await runWithTenant(5, () =>
      authService.validateSession(token),
    );
    expect(validated).not.toBeNull();
    expect(validated?.tenant_id).toBe(5);

    // Wrong scope: routed to shop 9's file instead, where this token was
    // never written — validateSession must find nothing (not a leak into
    // shop 9's own sessions).
    const validatedWrongTenant = await runWithTenant(9, () =>
      authService.validateSession(token),
    );
    expect(validatedWrongTenant).toBeNull();

    // Bypass scope (platform file): also nothing — the session never
    // touched the platform file either.
    const validatedPlatform = await runWithoutTenant(() =>
      authService.validateSession(token),
    );
    expect(validatedPlatform).toBeNull();
  });

  it("4. a platform-realm (super_admin) login/validate hits the platform file, never a tenant file", async () => {
    const authService = getAuthService();
    const rootResult = await runWithoutTenant(() =>
      authService.login("root", "Str0ng-RootPass!", {
        realm: null,
        deviceType: "web",
      }),
    );
    expect(rootResult.success).toBe(true);
    expect(rootResult.user?.tenant_id).toBeNull();

    const sessionInPlatform = platformDb
      .prepare("SELECT * FROM sessions WHERE token = ?")
      .get(rootResult.token);
    expect(sessionInPlatform).toBeTruthy();
    const sessionInShop5 = pool
      .get(5)
      .prepare("SELECT * FROM sessions WHERE token = ?")
      .get(rootResult.token);
    expect(sessionInShop5).toBeUndefined();

    const validated = await runWithoutTenant(() =>
      authService.validateSession(rootResult.token!),
    );
    expect(validated?.role).toBe("super_admin");
  });

  it("5. two interleaved async logins for different tenants each keep their own file across an await INSIDE AuthService.login itself", async () => {
    const authService = getAuthService();

    async function loginAndProbeAcrossAwait(
      tenantId: number,
      password: string,
    ): Promise<{ tenantIdOfUser: number | null; scopeAfterAwait: number }> {
      return runWithTenant(tenantId, async () => {
        const result = await authService.login("shopadmin", password, {
          realm: tenantId,
          deviceType: "web",
        });
        // Yield to the event loop mid-flight — the OTHER "request" runs its
        // own login() (including its own createSession INSERT) in here
        // before this one resumes. If AsyncLocalStorage ever let one
        // request's continuation observe the other's tenant id, this is
        // where it would show up.
        await sleep(5);
        return {
          tenantIdOfUser: result.user?.tenant_id ?? null,
          scopeAfterAwait: getCurrentTenantId(),
        };
      });
    }

    const [for5, for9] = await Promise.all([
      loginAndProbeAcrossAwait(5, "Str0ng-Password!5"),
      loginAndProbeAcrossAwait(9, "Str0ng-Password!9"),
    ]);

    expect(for5.tenantIdOfUser).toBe(5);
    expect(for5.scopeAfterAwait).toBe(5);
    expect(for9.tenantIdOfUser).toBe(9);
    expect(for9.scopeAfterAwait).toBe(9);

    // Both sessions actually landed — in their OWN files, not swapped.
    const sessionsIn5 = pool
      .get(5)
      .prepare("SELECT COUNT(*) AS c FROM sessions")
      .get() as { c: number };
    const sessionsIn9 = pool
      .get(9)
      .prepare("SELECT COUNT(*) AS c FROM sessions")
      .get() as { c: number };
    expect(sessionsIn5.c).toBe(1);
    expect(sessionsIn9.c).toBe(1);
  });

  it("6. with NO resolver installed (shared mode), behaviour is unaffected — single db, scope is a no-op", async () => {
    // Undo this suite's per-tenant resolver and fall back to a single shared
    // in-memory db, exactly like today's TENANT_DB_MODE=shared. Confirms my
    // login()/validateSession() scoping changes (backend/src/api/auth.ts,
    // backend/src/middleware/auth.ts — not under core jest, but exercised
    // via the SAME AuthService/repository calls) add no behaviour change
    // when no resolver is installed: getDatabase() always returns the one
    // shared instance regardless of which runWithTenant/runWithoutTenant
    // scope is active.
    setDatabaseResolver(null);
    closeDatabase();
    const sharedDb = new Database(":memory:");
    sharedDb.exec(CREATE_DB_SQL);
    sharedDb
      .prepare(
        `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (1, 'shareduser', ?, 'admin', 1)`,
      )
      .run(hashPassword("Str0ng-Shared!"));
    initDatabase(sharedDb);
    resetUserRepository();
    resetSessionRepository();
    resetAuthService();

    const authService = getAuthService();
    // Scoped by tenant 5 OR tenant 9 OR runWithoutTenant — all resolve to
    // the SAME shared db when no resolver is installed, so the login must
    // still succeed via resolveWithoutRealm-style realm=1 lookup regardless
    // of which ambient scope wraps the call.
    const resultUnderTenant5Scope = await runWithTenant(5, () =>
      authService.login("shareduser", "Str0ng-Shared!", {
        realm: 1,
        deviceType: "web",
      }),
    );
    expect(resultUnderTenant5Scope.success).toBe(true);

    const resultUnderBypass = await runWithoutTenant(() =>
      authService.login("shareduser", "Str0ng-Shared!", {
        realm: 1,
        deviceType: "web",
      }),
    );
    expect(resultUnderBypass.success).toBe(true);

    sharedDb.close();
  });
});
