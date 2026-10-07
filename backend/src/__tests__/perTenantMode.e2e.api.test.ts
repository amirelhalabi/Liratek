/**
 * Per-tenant database mode — END-TO-END PROOF (Phase A–D wiring), `docs/plans/
 * ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` §§ 11–12.
 *
 * This is a PROOF test, not a rule-17 TDD guard (CLAUDE.md rule 17): the
 * per-tenant plumbing (`TenantDatabasePool`, `setDatabaseResolver`,
 * `setTenantDatabaseIdLister`, `setTenantStorageProvisioner`,
 * `perTenantStorageProvisioner.ts`, `tenantDbResolver.ts`) already exists and
 * already has unit coverage of its own pieces. What was NOT proven anywhere
 * is that wiring it up in front of the REAL Express app — real HTTP requests,
 * real JWTs, real Host-header routing — actually produces isolated,
 * independently-migrated, independently-suspendable per-shop SQLite files.
 * Every assertion below checks BOTH the HTTP result AND the physical file a
 * row landed in, opened directly with a separate `better-sqlite3` connection
 * — never inferring "which file" from the HTTP response alone.
 *
 * `backend/src/database/connection.ts` — the module that wires all of this
 * up for real — uses `import.meta.url` and can never be `require()`-d under
 * this backend's CommonJS-mode ts-jest (see that file's own header comment
 * and `tenantDbResolver.ts`'s). So this test replicates its wiring using the
 * SAME leaf modules `connection.ts` itself calls
 * (`tenantDbResolver.buildTenantDbResolver`, `tenantDirLister.
 * listTenantDatabaseIdsFromDir`, `openAndConfigure.openAndConfigure`,
 * `perTenantStorageProvisioner.createPerTenantStorageProvisioner`, and core's
 * own `TenantDatabasePool`/`setDatabaseResolver`/`setTenantDatabaseIdLister`/
 * `setTenantStorageProvisioner`) — not a re-derived, parallel version of the
 * same logic (rule 14). Only `connection.ts` itself is never imported.
 *
 * Deliberately does NOT set `globalThis.__LIRATEK_TEST_DB__` anywhere in the
 * per-tenant describe block below — that global is core's single-database
 * test hook and checking it FIRST in `getDatabase()` would bypass the very
 * resolver this file exists to prove works. It IS used, correctly, in the
 * separate "shared-mode sanity check" block, which exists specifically to
 * prove that block's own pre-existing behaviour (today's single-shared-file
 * default) is unaffected by anything this file does elsewhere.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type DatabaseCtor from "better-sqlite3";
import type { Express } from "express";

// Mock the logger re-exported from server.ts (importing the real server.ts
// would boot the HTTP listener + real DB) — same as every other backend API
// test that builds its own Express app.
jest.mock("../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Real better-sqlite3 (subpath import escapes this backend jest config's
// moduleNameMapper mock) — matches wp5_wp6_admin_tenant.api.test.ts and
// perTenantStorageProvisioner.test.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

// These two leaf modules have ZERO imports of their own (see their own
// header comments) — safe to import statically, unlike anything that
// touches `@liratek/core` (whose env-derived constants must not be read
// before this file's `beforeAll` sets the environment).
import { openAndConfigure } from "../database/openAndConfigure.js";
import { listTenantDatabaseIdsFromDir } from "../database/tenantDirLister.js";

// Real SQLite files on disk (not `:memory:`) + real file moves (Step 9's
// delete archives shop B's file — checkpoints WAL, counts rows across ~70
// tables, then renames). That step alone takes ~1.3s standalone and more
// under a full parallel `yarn test` run competing for disk I/O — well past
// jest's default 5000ms per-test timeout.
jest.setTimeout(30_000);

// =============================================================================
// Shared fixtures / env
// =============================================================================

const JWT_TEST_SECRET =
  "per-tenant-e2e-test-secret-0123456789-0123456789-0123456789";
const APP_BASE_DOMAIN_TEST = "liratek.test";

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: unknown;
}

interface ModulesBody {
  success: boolean;
  modules: Array<{ key: string }>;
}

function configureConnection(db: InstanceType<typeof DatabaseCtor>): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

function readAll<T = Record<string, unknown>>(
  dbPath: string,
  sql: string,
  params: unknown[] = [],
): T[] {
  const db = new RealDatabase(dbPath, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

function readOne<T = Record<string, unknown>>(
  dbPath: string,
  sql: string,
  params: unknown[] = [],
): T | undefined {
  const db = new RealDatabase(dbPath, { readonly: true });
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

// `@liratek/core` is imported dynamically (once, here) so this file controls
// exactly when its env-derived constants (JWT_SECRET, APP_BASE_DOMAIN)
// get frozen — see wp5_wp6_admin_tenant.api.test.ts's
// beforeAll for the same rationale. Typed via `typeof import(...)` (a
// type-only query, safe regardless of when the dynamic import actually
// resolves at runtime) rather than `any` (CLAUDE.md rule 1).
let core: typeof import("@liratek/core");

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_TEST_SECRET;
  process.env.APP_BASE_DOMAIN = APP_BASE_DOMAIN_TEST;
  // Explicitly UNSET for the shared-mode sanity check, which runs first.
  delete process.env.TENANT_DB_MODE;

  core = await import("@liratek/core");
});

// =============================================================================
// Shared-mode sanity check — proves this file's per-tenant wiring below does
// NOT change today's default (no resolver, no TENANT_DB_MODE) behaviour.
// Uses the pre-existing `__LIRATEK_TEST_DB__` single-database test hook,
// exactly like every other backend API test — that IS "today's behaviour"
// for this suite, so using it here is the correct baseline, not a shortcut.
// =============================================================================

describe("Shared-mode sanity check (no resolver installed, no TENANT_DB_MODE)", () => {
  let app: Express;
  let sharedDb: InstanceType<typeof DatabaseCtor>;

  beforeAll(async () => {
    const createDbSql = fs.readFileSync(
      path.join(__dirname, "../../../electron-app/create_db.sql"),
      "utf8",
    );

    sharedDb = new RealDatabase(":memory:");
    sharedDb.pragma("foreign_keys = ON");
    sharedDb.exec(createDbSql);
    core.runMigrations(sharedDb);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      sharedDb;

    core.resetUserRepository();
    core.resetSessionRepository();
    core.resetAuthService();
    core.resetClientRepository();
    core.resetClientService();

    const authRoutes = (await import("../api/auth")).default;
    const clientRoutes = (await import("../api/clients")).default;

    app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    app.use("/api/clients", clientRoutes);
  });

  afterAll(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    sharedDb.close();
    core.resetUserRepository();
    core.resetSessionRepository();
    core.resetAuthService();
    core.resetClientRepository();
    core.resetClientService();
  });

  it("logs in the seeded tenant-1 admin and lists clients — exactly like today", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin123" });
    expect(loginRes.status).toBe(200);
    const token = (loginRes.body as ApiBody).data!.token as string;
    expect(typeof token).toBe("string");

    const clientsRes = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${token}`);
    expect(clientsRes.status).toBe(200);
    expect(
      Array.isArray((clientsRes.body as ApiBody).data!.clients),
    ).toBe(true);
  });
});

// =============================================================================
// Per-tenant mode — end-to-end proof (steps 1–10, sequential — later steps
// depend on earlier ones' setup, per the ticket).
// =============================================================================

describe("Per-tenant mode — end-to-end proof", () => {
  const SUPER_ADMIN_USERNAME_TEST = "root";
  const SUPER_ADMIN_PASSWORD_TEST = "RootPass123!";
  const SHOP_ADMIN_USERNAME = "shopadmin";
  const SHOP_ADMIN_PASSWORD = "ShopAdminPass1!";
  const PLATFORM_HOST = APP_BASE_DOMAIN_TEST;
  const SLUG_A = "corner-a";
  const SLUG_B = "corner-b";
  const HOST_A = `${SLUG_A}.${APP_BASE_DOMAIN_TEST}`;
  const HOST_B = `${SLUG_B}.${APP_BASE_DOMAIN_TEST}`;

  let rootDir: string;
  let tenantsDir: string;
  let platformDbPath: string;
  let platformDb: InstanceType<typeof DatabaseCtor>;
  let pool: InstanceType<typeof core.TenantDatabasePool>;
  let app: Express;

  let superAdminToken = "";
  let tenantAId = 0;
  let tenantBId = 0;
  let tokenA = "";
  let tokenB = "";
  let sessionTokenA = "";

  function pathFor(tenantId: number): string {
    return path.join(tenantsDir, `${tenantId}.db`);
  }

  beforeAll(async () => {
    process.env.TENANT_DB_MODE = "per-tenant";

    rootDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "liratek-per-tenant-e2e-"),
    );
    tenantsDir = path.join(rootDir, "tenants");
    fs.mkdirSync(tenantsDir, { recursive: true });
    platformDbPath = path.join(rootDir, "platform.db");

    const createDbSql = fs.readFileSync(
      path.join(__dirname, "../../../electron-app/create_db.sql"),
      "utf8",
    );

    // ── Platform database — a REAL file, exactly what connection.ts's
    // ensureSchema() + runMigrations() does for the shared file today. ──
    platformDb = new RealDatabase(platformDbPath);
    configureConnection(platformDb);
    platformDb.exec(createDbSql);
    core.runMigrations(platformDb);

    // Seed the platform super admin directly. `ensureSuperAdmin()` lives in
    // `backend/src/database/connection.ts`, which this file can never
    // import (see the file header) — this is the same INSERT that function
    // would have run, using the same password hashing (`core.hashPassword`).
    platformDb
      .prepare(
        `INSERT INTO users (username, password_hash, role, is_active, tenant_id)
         VALUES (?, ?, 'super_admin', 1, NULL)`,
      )
      .run(
        SUPER_ADMIN_USERNAME_TEST,
        core.hashPassword(SUPER_ADMIN_PASSWORD_TEST),
      );

    // ── Tenant pool — identical construction to connection.ts's own. ──
    pool = new core.TenantDatabasePool({
      dir: tenantsDir,
      openDatabase: (fp: string) =>
        openAndConfigure(fp, (p) => new RealDatabase(p), configureConnection),
      migrate: (db: InstanceType<typeof DatabaseCtor>) => core.runMigrations(db),
    });

    // `tenantDbResolver.ts` and `perTenantStorageProvisioner.ts` both import
    // `@liratek/core` at module scope, so — like `@liratek/core` itself —
    // they must be imported AFTER the environment is set, never statically
    // at file top (see the header comment).
    const { buildTenantDbResolver } = await import(
      "../database/tenantDbResolver"
    );
    const { createPerTenantStorageProvisioner } = await import(
      "../database/perTenantStorageProvisioner"
    );

    core.resetUserRepository();
    core.resetSessionRepository();
    core.resetAuthService();
    core.resetTenantRepository();
    core.resetSubscriptionRepository();
    core.resetAuditRepository();
    core.resetAuditService();
    core.resetTenantStatsService();
    core.resetClientRepository();
    core.resetClientService();
    core.resetModuleRepository();
    core.resetModuleService();
    core.resetSubscriptionService();

    // ── Install routing — mirrors connection.ts#installTenantDbRouting()
    // exactly, one seam at a time. ──
    core.setDatabaseResolver(
      buildTenantDbResolver(pool, () => platformDb),
    );
    core.setTenantDatabaseIdLister(() =>
      listTenantDatabaseIdsFromDir(tenantsDir),
    );
    core.setTenantStorageProvisioner(
      createPerTenantStorageProvisioner({
        tenantsDir,
        pool,
        openRawDatabase: (fp: string) => new RealDatabase(fp),
        configureConnection,
        runMigrations: (db: InstanceType<typeof DatabaseCtor>) =>
          core.runMigrations(db),
        createDbSql,
        platformTenantRepo: core.getTenantRepository(),
        platformSubscriptionRepo: core.getSubscriptionRepository(),
      }),
    );
    // Reconstruct so the NEXT getTenantProvisioningService() call picks up
    // the override just installed (its constructor resolves the storage
    // provisioner ONCE, at construction time — TenantProvisioningService.ts's
    // own header comment).
    core.resetTenantProvisioningService();

    const authRoutes = (await import("../api/auth")).default;
    const adminRoutes = (await import("../api/admin")).default;
    const clientRoutes = (await import("../api/clients")).default;
    const subscriptionRoutes = (await import("../api/subscription")).default;
    const moduleRoutes = (await import("../api/modules")).default;

    app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/clients", clientRoutes);
    app.use("/api/subscription", subscriptionRoutes);
    app.use("/api/modules", moduleRoutes);
  });

  afterAll(() => {
    pool.closeAll();
    core.setDatabaseResolver(null);
    core.setTenantDatabaseIdLister(null);
    core.setTenantStorageProvisioner(null);
    platformDb.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
    delete process.env.TENANT_DB_MODE;

    core.resetTenantProvisioningService();
    core.resetUserRepository();
    core.resetSessionRepository();
    core.resetAuthService();
    core.resetTenantRepository();
    core.resetSubscriptionRepository();
    core.resetAuditRepository();
    core.resetAuditService();
    core.resetTenantStatsService();
    core.resetClientRepository();
    core.resetClientService();
    core.resetModuleRepository();
    core.resetModuleService();
    core.resetSubscriptionService();
  });

  // ── Step 1 ────────────────────────────────────────────────────────────
  it("Step 1: super admin logs in on the platform host — session lands in the PLATFORM file", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Host", PLATFORM_HOST)
      .send({
        username: SUPER_ADMIN_USERNAME_TEST,
        password: SUPER_ADMIN_PASSWORD_TEST,
      });
    expect(res.status).toBe(200);
    const body = res.body as ApiBody;
    superAdminToken = body.data!.token as string;
    const sessionToken = body.data!.sessionToken as string;
    expect(typeof superAdminToken).toBe("string");

    const platformRow = readOne<{ tenant_id: number | null }>(
      platformDbPath,
      "SELECT tenant_id FROM sessions WHERE token = ?",
      [sessionToken],
    );
    expect(platformRow).toBeDefined();
    expect(platformRow!.tenant_id).toBeNull();

    // No tenant files exist yet (provisioning happens in Step 2) — there is
    // nowhere else this session token could be. Re-confirmed negatively
    // once shop files exist, in Step 3.

    // auth.ts's login route only audits a login when the user has a real
    // tenant_id (`if (loginTenantId !== null) { ... }`) — a platform
    // super_admin's login is by design NOT audited. So there is no
    // login-audit row to assert here; the SESSION row above is the
    // complete, correct proof for this step.
  });

  // ── Step 2 ────────────────────────────────────────────────────────────
  it("Step 2: provisions shop A and shop B — files on disk, correct local + platform rows", async () => {
    const resA = await request(app)
      .post("/api/admin/tenants")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        name: "Corner A",
        slug: SLUG_A,
        adminUsername: SHOP_ADMIN_USERNAME,
        adminPassword: SHOP_ADMIN_PASSWORD,
      });
    expect(resA.status).toBe(201);
    tenantAId = ((resA.body as ApiBody).data!.tenant as { id: number }).id;

    const resB = await request(app)
      .post("/api/admin/tenants")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        name: "Corner B",
        slug: SLUG_B,
        adminUsername: SHOP_ADMIN_USERNAME,
        adminPassword: SHOP_ADMIN_PASSWORD,
      });
    expect(resB.status).toBe(201);
    tenantBId = ((resB.body as ApiBody).data!.tenant as { id: number }).id;

    expect(fs.existsSync(pathFor(tenantAId))).toBe(true);
    expect(fs.existsSync(pathFor(tenantBId))).toBe(true);

    const localRowsA = readAll<{ id: number }>(
      pathFor(tenantAId),
      "SELECT id FROM tenants",
    );
    expect(localRowsA).toHaveLength(1);
    expect(localRowsA[0].id).toBe(tenantAId);

    const localRowsB = readAll<{ id: number }>(
      pathFor(tenantBId),
      "SELECT id FROM tenants",
    );
    expect(localRowsB).toHaveLength(1);
    expect(localRowsB[0].id).toBe(tenantBId);

    const platformTenantRows = readAll<{ id: number; status: string }>(
      platformDbPath,
      `SELECT id, status FROM tenants WHERE id IN (?, ?)`,
      [tenantAId, tenantBId],
    );
    expect(platformTenantRows).toHaveLength(2);
    for (const row of platformTenantRows) {
      expect(row.status).toBe("active");
    }

    const platformSubRows = readAll<{ tenant_id: number }>(
      platformDbPath,
      `SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id IN (?, ?)`,
      [tenantAId, tenantBId],
    );
    expect(platformSubRows).toHaveLength(2);
  });

  // ── Step 3 ────────────────────────────────────────────────────────────
  it("Step 3: the SAME admin username on both shops — sessions land in their OWN file only", async () => {
    const resA = await request(app)
      .post("/api/auth/login")
      .set("Host", HOST_A)
      .send({ username: SHOP_ADMIN_USERNAME, password: SHOP_ADMIN_PASSWORD });
    expect(resA.status).toBe(200);
    tokenA = (resA.body as ApiBody).data!.token as string;
    sessionTokenA = (resA.body as ApiBody).data!.sessionToken as string;

    const resB = await request(app)
      .post("/api/auth/login")
      .set("Host", HOST_B)
      .send({ username: SHOP_ADMIN_USERNAME, password: SHOP_ADMIN_PASSWORD });
    expect(resB.status).toBe(200);
    tokenB = (resB.body as ApiBody).data!.token as string;
    const sessionTokenB = (resB.body as ApiBody).data!.sessionToken as string;

    expect(
      readOne(pathFor(tenantAId), "SELECT id FROM sessions WHERE token = ?", [
        sessionTokenA,
      ]),
    ).toBeDefined();
    expect(
      readOne(pathFor(tenantBId), "SELECT id FROM sessions WHERE token = ?", [
        sessionTokenA,
      ]),
    ).toBeUndefined();

    expect(
      readOne(pathFor(tenantBId), "SELECT id FROM sessions WHERE token = ?", [
        sessionTokenB,
      ]),
    ).toBeDefined();
    expect(
      readOne(pathFor(tenantAId), "SELECT id FROM sessions WHERE token = ?", [
        sessionTokenB,
      ]),
    ).toBeUndefined();
  });

  // ── Step 4 ────────────────────────────────────────────────────────────
  it("Step 4: shop A creates a client — lands in A's file only, invisible to B", async () => {
    const phone = "70111222";
    const createRes = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        full_name: "Alice Cornertech",
        phone_number: phone,
        whatsapp_opt_in: true,
      });
    expect(createRes.status).toBe(201);

    const rowsInA = readAll(
      pathFor(tenantAId),
      "SELECT * FROM clients WHERE phone_number = ?",
      [phone],
    );
    expect(rowsInA).toHaveLength(1);
    const rowsInB = readAll(
      pathFor(tenantBId),
      "SELECT * FROM clients WHERE phone_number = ?",
      [phone],
    );
    expect(rowsInB).toHaveLength(0);

    const listAsB = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${tokenB}`);
    expect(listAsB.status).toBe(200);
    const clientsB = (listAsB.body as ApiBody).data!.clients as Array<{
      phone_number: string;
    }>;
    expect(clientsB.some((c) => c.phone_number === phone)).toBe(false);

    // B's token, pointed at A's Host header.
    //
    // FINDING (see this test's report — not fixed here per the ticket's
    // "surface, don't fix" instruction): `authenticateJWT`
    // (backend/src/middleware/auth.ts) scopes every request EXCLUSIVELY by
    // the JWT's own signed `tenantId` claim — `resolveTenantHost`/
    // `isHostTenancyActive` (backend/src/middleware/tenantHost.ts) are
    // consulted ONLY inside auth.ts's login and signup-status routes (a
    // repo-wide grep of `backend/src` confirms no other call site). So this
    // request is NOT refused — it succeeds and returns B's OWN clients,
    // completely ignoring the Host header. This is not a cross-tenant leak
    // (B's token can only ever reach B's own file, by tenantId claim, no
    // matter which Host is sent), but it is also not the 401/403 refusal a
    // reader might expect from "wrong host" — tenantHost.ts's own header
    // comment states this is deliberate ("the hostname means nothing" past
    // login). Asserting the ACTUAL behaviour rather than the originally
    // assumed one.
    const crossHostRes = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("Host", HOST_A);
    expect(crossHostRes.status).toBe(200);
    const crossHostClients = (crossHostRes.body as ApiBody).data!
      .clients as Array<{ phone_number: string }>;
    // Still B's own data, never A's — the Host header did not escalate it
    // into A's file.
    expect(crossHostClients.some((c) => c.phone_number === phone)).toBe(
      false,
    );
  });

  // ── Step 5 ────────────────────────────────────────────────────────────
  it("Step 5: GET /api/admin/tenants shows both shops with correct user counts and non-null last_activity", async () => {
    const res = await request(app)
      .get("/api/admin/tenants")
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    const tenants = (res.body as ApiBody).data!.tenants as Array<{
      id: number;
      slug: string;
      user_count: number;
      last_activity: string | null;
    }>;
    const a = tenants.find((t) => t.slug === SLUG_A);
    const b = tenants.find((t) => t.slug === SLUG_B);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.user_count).toBe(1);
    expect(b!.user_count).toBe(1);
    expect(a!.last_activity).not.toBeNull();
    expect(b!.last_activity).not.toBeNull();
  });

  // ── Step 6 ────────────────────────────────────────────────────────────
  it("Step 6: subscription-status + enabled-modules read the PLATFORM tenant_subscriptions row from shop A's own host", async () => {
    const statusRes = await request(app)
      .get("/api/subscription/status")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Host", HOST_A);
    expect(statusRes.status).toBe(200);
    expect((statusRes.body as ApiBody).data).toMatchObject({
      status: "active",
      canWrite: true,
    });

    const beforeRes = await request(app)
      .get("/api/modules/enabled")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Host", HOST_A);
    expect(beforeRes.status).toBe(200);
    const beforeKeys = (beforeRes.body as ModulesBody).modules.map(
      (m) => m.key,
    );
    expect(beforeKeys).toContain("pos");

    // Restrict shop A to "nothing but the ungateable chassis" via the
    // PLATFORM subscriptions route (admin.ts's own phrase for an empty
    // array).
    const patchRes = await request(app)
      .patch(`/api/admin/subscriptions/${tenantAId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ entitledModules: [] });
    expect(patchRes.status).toBe(200);

    const afterRes = await request(app)
      .get("/api/modules/enabled")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Host", HOST_A);
    expect(afterRes.status).toBe(200);
    const afterKeys = (afterRes.body as ModulesBody).modules.map(
      (m) => m.key,
    );
    expect(afterKeys).not.toContain("pos");
    const UNGATEABLE = ["dashboard", "settings", "audit", "closing"];
    for (const key of afterKeys) {
      expect(UNGATEABLE).toContain(key);
    }

    // Restore, so later steps (impersonation reads, etc.) see the normal
    // module set again.
    const restoreRes = await request(app)
      .patch(`/api/admin/subscriptions/${tenantAId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ entitledModules: null });
    expect(restoreRes.status).toBe(200);
  });

  // ── Step 7 ────────────────────────────────────────────────────────────
  it("Step 7: impersonation mints a working token, writes the two-sided audit correctly, and leaves no FK violations", async () => {
    const impRes = await request(app)
      .post(`/api/admin/tenants/${tenantAId}/impersonate`)
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(impRes.status).toBe(200);
    const impToken = (impRes.body as ApiBody).data!.token as string;

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${impToken}`);
    expect(meRes.status).toBe(200);
    expect(
      (meRes.body as { user: { username: string } }).user.username,
    ).toBe(SHOP_ADMIN_USERNAME);

    const readRes = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${impToken}`);
    expect(readRes.status).toBe(200);

    // Platform half (admin.ts): tenant_id NULL (via runWithoutTenant), actor
    // = the super admin's own valid platform identity.
    const platformAudit = readOne<{
      user_id: number;
      tenant_id: number | null;
    }>(
      platformDbPath,
      `SELECT user_id, tenant_id FROM audit_log
       WHERE action = 'IMPERSONATION_START' AND entity_type = 'tenant'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(platformAudit).toBeDefined();
    expect(platformAudit!.tenant_id).toBeNull();

    // Shop half (admin.ts): impersonator_id ALWAYS NULL — the super admin's
    // platform user id has no corresponding `users` row in the shop's own
    // file, so writing it as impersonator_id would be an FK violation the
    // instant this runs against a real per-tenant database. The
    // impersonator's identity is preserved in `metadata` instead.
    const shopAudit = readOne<{
      impersonator_id: number | null;
      user_id: number;
      metadata: string | null;
    }>(
      pathFor(tenantAId),
      `SELECT impersonator_id, user_id, metadata FROM audit_log
       WHERE action = 'IMPERSONATION_START' AND entity_type = 'session'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(shopAudit).toBeDefined();
    expect(shopAudit!.impersonator_id).toBeNull();
    expect(JSON.parse(shopAudit!.metadata ?? "{}")).toMatchObject({
      impersonatedBy: SUPER_ADMIN_USERNAME_TEST,
    });

    const fkViolations = readAll(pathFor(tenantAId), "PRAGMA foreign_key_check");
    expect(fkViolations).toEqual([]);
  });

  // ── Step 8 ────────────────────────────────────────────────────────────
  it("Step 8: suspending shop A blocks its token and its login, while A's LOCAL mirror row still says active", async () => {
    const suspendRes = await request(app)
      .patch(`/api/admin/tenants/${tenantAId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ status: "suspended" });
    expect(suspendRes.status).toBe(200);
    expect(
      (suspendRes.body as ApiBody).data!.tenant as { status: string },
    ).toMatchObject({ status: "suspended" });

    const blockedRes = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(blockedRes.status).toBe(401);

    const loginBlockedRes = await request(app)
      .post("/api/auth/login")
      .set("Host", HOST_A)
      .send({ username: SHOP_ADMIN_USERNAME, password: SHOP_ADMIN_PASSWORD });
    expect(loginBlockedRes.status).toBe(401);

    // THE proof this step exists for: the shop's OWN local `tenants` mirror
    // row never got touched (only the platform row did), yet the token and
    // the login are both blocked above — so the block can only be coming
    // from the PLATFORM read (UserRepository.getTenantStatus's
    // runWithoutTenant()), never from this local row.
    const localMirror = readOne<{ status: string }>(
      pathFor(tenantAId),
      "SELECT status FROM tenants WHERE id = ?",
      [tenantAId],
    );
    expect(localMirror!.status).toBe("active");

    const reactivateRes = await request(app)
      .patch(`/api/admin/tenants/${tenantAId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ status: "active" });
    expect(reactivateRes.status).toBe(200);

    // The SAME old token/session — never re-issued — works again.
    const revivedRes = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(revivedRes.status).toBe(200);
    expect(
      readOne(pathFor(tenantAId), "SELECT id FROM sessions WHERE token = ?", [
        sessionTokenA,
      ]),
    ).toBeDefined();
  });

  // ── Step 9 ────────────────────────────────────────────────────────────
  it("Step 9: deleting shop B archives its file, removes the platform rows, blocks its login, and leaves shop A untouched", async () => {
    const deleteRes = await request(app)
      .delete(`/api/admin/tenants/${tenantBId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ confirmSlug: SLUG_B });
    expect(deleteRes.status).toBe(200);

    expect(fs.existsSync(pathFor(tenantBId))).toBe(false);
    const archiveDir = path.join(tenantsDir, "archive");
    const archived = fs
      .readdirSync(archiveDir)
      .filter((f) => f.startsWith(`${tenantBId}-`));
    expect(archived).toHaveLength(1);

    const platformRow = readOne(
      platformDbPath,
      "SELECT id FROM tenants WHERE id = ?",
      [tenantBId],
    );
    expect(platformRow).toBeUndefined();
    const platformSub = readOne(
      platformDbPath,
      "SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id = ?",
      [tenantBId],
    );
    expect(platformSub).toBeUndefined();

    const loginBRes = await request(app)
      .post("/api/auth/login")
      .set("Host", HOST_B)
      .send({ username: SHOP_ADMIN_USERNAME, password: SHOP_ADMIN_PASSWORD });
    expect(loginBRes.status).toBe(401);

    // Shop A completely unaffected.
    expect(fs.existsSync(pathFor(tenantAId))).toBe(true);
    const stillA = readAll(pathFor(tenantAId), "SELECT * FROM clients");
    expect(stillA.length).toBeGreaterThan(0);
    const aStillWorksRes = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(aStillWorksRes.status).toBe(200);
  });

  // ── Step 10 ───────────────────────────────────────────────────────────
  it("Step 10: self-service signup provisions shop C the same way as admin provisioning", async () => {
    const slugC = "corner-c";
    // Sign-up needs a single-use emailed invite (LIRA-267 Stage B). Seed one
    // through the real service with a known token, in the platform realm the
    // route itself uses; the email is never sent here.
    const INVITE_TOKEN = "per-tenant-e2e-invite-token-0123456789";
    core.runWithoutTenant(() =>
      new core.SignupInvitationService(
        core.getSignupInvitationRepository(),
        core.getEmailOutboxRepository(),
        () => INVITE_TOKEN,
      ).create({
        source: "admin",
        email: "owner-c@example.com",
        invitedByUserId: null,
        now: new Date().toISOString(),
        baseUrl: "https://www.liratek.test",
        emailConfigured: true,
        supportEmail: "help@liratek.test",
      }),
    );
    const signupRes = await request(app).post("/api/auth/signup").send({
      inviteToken: INVITE_TOKEN,
      name: "Corner C",
      slug: slugC,
      adminUsername: "shopadmin_c",
      adminPassword: "ShopAdminPass3!",
    });
    expect(signupRes.status).toBe(201);
    const tenantC = (signupRes.body as ApiBody).data!.tenant as {
      id: number;
      slug: string;
    };
    expect(fs.existsSync(pathFor(tenantC.id))).toBe(true);

    const localRowsC = readAll<{ id: number }>(
      pathFor(tenantC.id),
      "SELECT id FROM tenants",
    );
    expect(localRowsC).toHaveLength(1);
    expect(localRowsC[0].id).toBe(tenantC.id);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .set("Host", `${slugC}.${APP_BASE_DOMAIN_TEST}`)
      .send({ username: "shopadmin_c", password: "ShopAdminPass3!" });
    expect(loginRes.status).toBe(200);
  });
});
