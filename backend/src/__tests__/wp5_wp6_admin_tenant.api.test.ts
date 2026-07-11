/**
 * WP5 + WP6 — Control plane (tenant provisioning) + impersonation.
 *
 * Supertest coverage over a REAL in-memory SQLite database, bootstrapped from
 * the ACTUAL `electron-app/create_db.sql` (not a hand-rolled per-file fixture
 * like wp2's — provisioning seeds 11 config tables with exact column lists,
 * and a hand-rolled fixture could drift from the real schema without ever
 * being caught; execing the real file means "does the seed match the schema"
 * is answered by construction).
 *
 * Seeded tenants (beyond tenant 1 "Default", which create_db.sql already
 * seeds in full):
 *   - 2 "Beta Co" (betaco)   — active, has an active admin (beta_admin)
 *   - 3 "Gamma Co" (gammaco) — active, NO active admin (only a staffer + an
 *                              inactive admin) — the "no active admin" 404 case
 *   - 4 "Delta Co" (deltaco) — suspended, has an admin — the 409 case
 *
 * Coverage:
 *  1. GET /api/admin/tenants — lists with stats; 403 for a tenant admin.
 *  2. POST /api/admin/tenants — provisions a tenant: config row counts match
 *     tenant 1's seed table-for-table, the tenant admin can log in; 409 on a
 *     duplicate slug; 400 on a reserved/invalid slug.
 *  3. PATCH /api/admin/tenants/:id — suspend blocks that tenant's login
 *     (WP2's gate); 404 on a non-existent tenant.
 *  4. POST .../impersonate — payload shape (impersonatorId/userId/tenantId,
 *     exact 2h exp), audit row in the TARGET tenant's realm; 409 suspended;
 *     404 no active admin; 404 non-existent tenant.
 *  5. Re-escalation block (plan §5 risk #6): an impersonation token is
 *     REJECTED by /api/admin/* (403) — proven against the buggy code per
 *     CLAUDE.md rule 17 (see the WP5/WP6 report for the manual repro).
 *  6. Isolation: a write performed under the impersonation token lands ONLY
 *     in the target tenant.
 *  7. GET /api/auth/me with an impersonation token (WP7 delta): resolves to
 *     the impersonated tenant admin under the target tenant — required so a
 *     reloaded impersonation browser tab re-validates successfully instead
 *     of dropping to /login.
 */

import { jest } from "@jest/globals";
import type { Express, Request, Response } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Mock the logger re-exported from server.ts (importing the real server.ts
// would boot the HTTP listener + real DB).
jest.mock("../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Real better-sqlite3 (subpath import escapes the moduleNameMapper mock).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_TEST_SECRET = "wp5-wp6-test-secret-0123456789-0123456789-0123456789";
const PASSWORD = "Password123!";

// Deferred (set in beforeAll after env + DB are ready)
let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

interface PartnerRow {
  name: string;
}

async function login(username: string, password: string = PASSWORD) {
  return request(app).post("/api/auth/login").send({ username, password });
}

async function loginToken(
  username: string,
  password: string = PASSWORD,
): Promise<string> {
  const res = await login(username, password);
  expect(res.status).toBe(200);
  const body = res.body as ApiBody;
  return body.data!.token as string;
}

function countRows(table: string, tenantId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM ${table} WHERE tenant_id = ?`)
    .get(tenantId) as { c: number };
  return row.c;
}

function seedDatabase(hashPassword: (p: string) => string): void {
  // The REAL fresh-install schema — not a hand-rolled per-file fixture.
  // ts-jest compiles this file to CommonJS, so the native `__dirname` is
  // available directly (no import.meta.url dance needed, unlike the ESM
  // build of packages/core/src/database/connection.ts).
  const schemaPath = path.join(
    __dirname,
    "../../../electron-app/create_db.sql",
  );
  const sql = fs.readFileSync(schemaPath, "utf8");
  db.exec(sql);

  const hash = hashPassword(PASSWORD);
  const insertUser = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertTenant = db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)`,
  );

  // Platform super admin (tenant_id NULL) — not seeded by create_db.sql.
  insertUser.run(null, "root", hash, "super_admin", 1);

  // Tenant 2 — active, with an active admin.
  insertTenant.run(2, "Beta Co", "betaco", "active");
  insertUser.run(2, "beta_admin", hash, "admin", 1);

  // Tenant 3 — active, but NO active admin (a staffer + an inactive admin).
  insertTenant.run(3, "Gamma Co", "gammaco", "active");
  insertUser.run(3, "gamma_staff", hash, "staff", 1);
  insertUser.run(3, "gamma_inactive_admin", hash, "admin", 0);

  // Tenant 4 — suspended, with an admin.
  insertTenant.run(4, "Delta Co", "deltaco", "suspended");
  insertUser.run(4, "delta_admin", hash, "admin", 1);
}

beforeAll(async () => {
  // Must be set BEFORE the first @liratek/core import — core's env.ts parses
  // process.env at module load, and api/auth.ts / api/admin.ts throw without one.
  process.env.JWT_SECRET = JWT_TEST_SECRET;

  db = new RealDatabase(":memory:");
  // Production (backend/src/database/connection.ts) always turns this on —
  // match it here so the 11-table config seed's insertion order (currencies/
  // modules BEFORE currency_modules/currency_drawers, which FK-reference
  // them) is actually verified, not just eyeballed.
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;

  core = await import("@liratek/core");
  seedDatabase(core.hashPassword);

  core.resetUserRepository();
  core.resetSessionRepository();
  core.resetAuthService();
  core.resetTenantRepository();
  core.resetTenantProvisioningService();
  core.resetAuditRepository();

  const { authenticateJWT } = await import("../middleware/auth");
  const authRoutes = (await import("../api/auth")).default;
  const adminRoutes = (await import("../api/admin")).default;

  app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);

  // Tenant-scoped write + read probes backed by BaseRepository-derived
  // PartnerRepository — proves an impersonation-token write lands in the
  // target tenant's context and stays invisible to every other tenant.
  app.post(
    "/api/test/partners",
    authenticateJWT,
    (req: Request, res: Response) => {
      try {
        const partner = new core.PartnerRepository().create({
          name: req.body.name,
        });
        res.json({ success: true, partner });
      } catch (err) {
        res.status(500).json({
          success: false,
          error: err instanceof Error ? err.name : "unknown",
        });
      }
    },
  );
  app.get(
    "/api/test/partners",
    authenticateJWT,
    (_req: Request, res: Response) => {
      try {
        const rows = new core.PartnerRepository().findAll();
        res.json({ success: true, rows });
      } catch (err) {
        res.status(500).json({
          success: false,
          error: err instanceof Error ? err.name : "unknown",
        });
      }
    },
  );
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

beforeEach(() => {
  // Same rationale as wp2: this suite exercises the WEB path — no fixed
  // desktop tenant fallback.
  core.resetTenantContext();
});

// =============================================================================
// 1. GET /api/admin/tenants
// =============================================================================

describe("GET /api/admin/tenants", () => {
  it("lists tenants with per-tenant stats", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .get("/api/admin/tenants")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiBody;
    const tenants = body.data!.tenants as Array<{
      id: number;
      slug: string;
      user_count: number;
    }>;
    const defaultTenant = tenants.find((t) => t.slug === "default");
    expect(defaultTenant).toBeDefined();
    expect(defaultTenant!.user_count).toBeGreaterThanOrEqual(1);

    const betaTenant = tenants.find((t) => t.slug === "betaco");
    expect(betaTenant).toBeDefined();
    expect(betaTenant!.user_count).toBe(1);
  });

  it("rejects a tenant admin (non-super) with 403", async () => {
    const token = await loginToken("beta_admin");
    const res = await request(app)
      .get("/api/admin/tenants")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  // Real impersonation tokens carry role:'admin' (blocked by the plain role
  // check alone — see the isolation describe block below for that path).
  // `requireSuperAdmin`'s `impersonatorId !== undefined` clause is defense
  // in depth against a DIFFERENT, more dangerous shape: a token that
  // (however it got minted — bug, forgery) claims role:'super_admin' AND
  // carries impersonatorId. This test exercises exactly that line against
  // the real admin router (plan §5 risk #6) — proven per CLAUDE.md rule 17
  // by temporarily deleting the clause from requireSuperAdmin, observing
  // this test go from 403 to 200, then restoring it (see the WP5/WP6 report).
  it("rejects a forged super_admin-shaped token that also carries impersonatorId", async () => {
    const loginRes = await login("root");
    const sessionToken = (loginRes.body as ApiBody).data!
      .sessionToken as string;
    const rootId = ((loginRes.body as ApiBody).data!.user as { id: number }).id;

    const forgedToken = jwt.sign(
      {
        userId: rootId,
        role: "super_admin",
        sessionToken,
        tenantId: null,
        impersonatorId: rootId,
      },
      JWT_TEST_SECRET,
      { expiresIn: "2h" },
    );

    const res = await request(app)
      .get("/api/admin/tenants")
      .set("Authorization", `Bearer ${forgedToken}`);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// 2. POST /api/admin/tenants — provisioning
// =============================================================================

describe("POST /api/admin/tenants (provisioning)", () => {
  const CONFIG_TABLES = [
    "currencies",
    "exchange_rates",
    "product_categories",
    "service_presets",
    "drawer_balances",
    "modules",
    "currency_modules",
    "currency_drawers",
    "payment_methods",
    "system_settings",
    "loto_settings",
  ];

  it("provisions a tenant: config seeded, admin can log in", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post("/api/admin/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Acme Shop",
        slug: "acme-shop",
        adminUsername: "acme_admin",
        adminPassword: "AcmePass123!",
      });

    expect(res.status).toBe(201);
    const tenant = (res.body as ApiBody).data!.tenant as {
      id: number;
      slug: string;
      name: string;
    };
    expect(tenant.slug).toBe("acme-shop");

    // Appears in the list
    const listRes = await request(app)
      .get("/api/admin/tenants")
      .set("Authorization", `Bearer ${token}`);
    const tenants = (listRes.body as ApiBody).data!.tenants as Array<{
      slug: string;
    }>;
    expect(tenants.some((t) => t.slug === "acme-shop")).toBe(true);

    // Config seeded — row counts match tenant 1's real create_db.sql seed,
    // table for table.
    for (const table of CONFIG_TABLES) {
      expect(countRows(table, tenant.id)).toBe(countRows(table, 1));
      expect(countRows(table, tenant.id)).toBeGreaterThan(0);
    }

    // Deliberate deviation from create_db.sql's literal 'Corner Tech':
    // shop_name seeds from the tenant's own name.
    const shopNameRow = db
      .prepare(
        `SELECT value FROM system_settings WHERE tenant_id = ? AND key_name = 'shop_name'`,
      )
      .get(tenant.id) as { value: string };
    expect(shopNameRow.value).toBe("Acme Shop");

    // The tenant admin can log in and gets tenantId = the new tenant.
    const loginRes = await login("acme_admin", "AcmePass123!");
    expect(loginRes.status).toBe(200);
    const decoded = jwt.verify(
      (loginRes.body as ApiBody).data!.token as string,
      JWT_TEST_SECRET,
    ) as Record<string, unknown>;
    expect(decoded.tenantId).toBe(tenant.id);
    expect(decoded.role).toBe("admin");
  });

  it("rejects a duplicate slug with 409", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post("/api/admin/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Duplicate",
        slug: "betaco", // already taken by tenant 2
        adminUsername: "dup_admin",
        adminPassword: "DupPass123!",
      });
    expect(res.status).toBe(409);
  });

  it("rejects a reserved slug with 400", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post("/api/admin/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Reserved",
        slug: "admin", // reserved (plan §5)
        adminUsername: "reserved_admin",
        adminPassword: "ReservedPass123!",
      });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid-charset slug with 400", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post("/api/admin/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Bad Charset",
        slug: "Not_Valid!",
        adminUsername: "bad_charset_admin",
        adminPassword: "BadPass123!",
      });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// 3. PATCH /api/admin/tenants/:id
// =============================================================================

describe("PATCH /api/admin/tenants/:id", () => {
  it("suspending a tenant blocks its admin's login (WP2 gate)", async () => {
    const token = await loginToken("root");
    try {
      const res = await request(app)
        .patch("/api/admin/tenants/2")
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "suspended" });
      expect(res.status).toBe(200);
      const tenant = (res.body as ApiBody).data!.tenant as {
        id: number;
        status: string;
      };
      expect(tenant.status).toBe("suspended");

      const loginRes = await login("beta_admin");
      expect(loginRes.status).toBe(401);
    } finally {
      // Restore — later tests (impersonation) need tenant 2 active.
      await request(app)
        .patch("/api/admin/tenants/2")
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "active" });
    }
  });

  it("404s on a non-existent tenant", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .patch("/api/admin/tenants/999999")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nope" });
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// 4. POST /api/admin/tenants/:id/impersonate
// =============================================================================

describe("POST /api/admin/tenants/:id/impersonate", () => {
  it("mints a token for the tenant's active admin with the expected payload", async () => {
    const superToken = await loginToken("root");
    const superDecoded = jwt.verify(superToken, JWT_TEST_SECRET) as Record<
      string,
      unknown
    >;
    const superAdminId = superDecoded.userId as number;

    const res = await request(app)
      .post("/api/admin/tenants/2/impersonate")
      .set("Authorization", `Bearer ${superToken}`);
    expect(res.status).toBe(200);

    const body = res.body as ApiBody;
    expect(body.data!.tenantName).toBe("Beta Co");
    expect(body.data!.username).toBe("beta_admin"); // WP7 delta — banner label
    const impToken = body.data!.token as string;

    const decoded = jwt.verify(impToken, JWT_TEST_SECRET) as Record<
      string,
      unknown
    >;
    const betaAdminRow = db
      .prepare(`SELECT id FROM users WHERE username = 'beta_admin'`)
      .get() as { id: number };

    expect(decoded.tenantId).toBe(2);
    expect(decoded.role).toBe("admin");
    expect(decoded.userId).toBe(betaAdminRow.id);
    expect(decoded.impersonatorId).toBe(superAdminId);
    // Exactly 2h, no more no less (plan §5: short expiry, no refresh).
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(2 * 60 * 60);

    // Audit row lives in the TARGET tenant's realm with impersonator_id set.
    const auditRow = db
      .prepare(
        `SELECT * FROM audit_log WHERE tenant_id = 2 AND action = 'IMPERSONATION_START' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { user_id: number; impersonator_id: number | null } | undefined;
    expect(auditRow).toBeDefined();
    expect(auditRow!.user_id).toBe(betaAdminRow.id);
    expect(auditRow!.impersonator_id).toBe(superAdminId);
  });

  it("409s on a suspended tenant", async () => {
    const superToken = await loginToken("root");
    const res = await request(app)
      .post("/api/admin/tenants/4/impersonate")
      .set("Authorization", `Bearer ${superToken}`);
    expect(res.status).toBe(409);
  });

  it("404s when the tenant has no active admin", async () => {
    const superToken = await loginToken("root");
    const res = await request(app)
      .post("/api/admin/tenants/3/impersonate")
      .set("Authorization", `Bearer ${superToken}`);
    expect(res.status).toBe(404);
  });

  it("404s on a non-existent tenant", async () => {
    const superToken = await loginToken("root");
    const res = await request(app)
      .post("/api/admin/tenants/999999/impersonate")
      .set("Authorization", `Bearer ${superToken}`);
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// 5 + 6. Re-escalation block + tenant isolation of impersonation writes
// =============================================================================

describe("impersonation token: re-escalation block + tenant isolation", () => {
  it("is rejected by GET /api/admin/tenants with 403 (no re-escalation)", async () => {
    const superToken = await loginToken("root");
    const impRes = await request(app)
      .post("/api/admin/tenants/2/impersonate")
      .set("Authorization", `Bearer ${superToken}`);
    const impToken = (impRes.body as ApiBody).data!.token as string;

    const res = await request(app)
      .get("/api/admin/tenants")
      .set("Authorization", `Bearer ${impToken}`);
    expect(res.status).toBe(403);
  });

  it("acts as a normal tenant session — a write under it lands ONLY in the target tenant", async () => {
    const superToken = await loginToken("root");
    const impRes = await request(app)
      .post("/api/admin/tenants/2/impersonate")
      .set("Authorization", `Bearer ${superToken}`);
    const impToken = (impRes.body as ApiBody).data!.token as string;

    const uniqueName = `Impersonated Partner ${Date.now()}`;
    const writeRes = await request(app)
      .post("/api/test/partners")
      .set("Authorization", `Bearer ${impToken}`)
      .send({ name: uniqueName });
    expect(writeRes.status).toBe(200);

    // Visible through the SAME (target-tenant-scoped) impersonation token.
    const readAsTenant2 = await request(app)
      .get("/api/test/partners")
      .set("Authorization", `Bearer ${impToken}`);
    const tenant2Rows = readAsTenant2.body.rows as PartnerRow[];
    expect(tenant2Rows.some((r) => r.name === uniqueName)).toBe(true);

    // NOT visible to tenant 1's own admin (create_db.sql's default seed row;
    // empty password_hash + 'admin123' is the documented legacy fallback in
    // utils/crypto.ts's verifyPassword).
    const tenant1Token = await loginToken("admin", "admin123");
    const readAsTenant1 = await request(app)
      .get("/api/test/partners")
      .set("Authorization", `Bearer ${tenant1Token}`);
    const tenant1Rows = readAsTenant1.body.rows as PartnerRow[];
    expect(tenant1Rows.some((r) => r.name === uniqueName)).toBe(false);
  });
});

// =============================================================================
// 7. GET /api/auth/me with an impersonation token (WP7 delta)
// =============================================================================

describe("GET /api/auth/me with an impersonation token", () => {
  it("resolves to the impersonated tenant admin under the target tenant (reload survival)", async () => {
    const superToken = await loginToken("root");
    const impRes = await request(app)
      .post("/api/admin/tenants/2/impersonate")
      .set("Authorization", `Bearer ${superToken}`);
    expect(impRes.status).toBe(200);
    const impToken = (impRes.body as ApiBody).data!.token as string;

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${impToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.success).toBe(true);
    expect(meRes.body.user).toMatchObject({
      username: "beta_admin",
      role: "admin",
      tenantId: 2,
    });
  });
});
