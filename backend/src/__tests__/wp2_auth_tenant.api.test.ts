/**
 * WP2 — Auth & realm: JWT v2, tenant context middleware, route lockdown.
 *
 * Supertest coverage over a REAL in-memory SQLite database (not the global
 * better-sqlite3 mock — imported via the "better-sqlite3/lib/index.js"
 * subpath, which escapes jest's `^better-sqlite3$` moduleNameMapper):
 *
 *  1. login returns a JWT whose decoded payload carries tenantId; login as a
 *     suspended tenant's user is rejected (401, "Account suspended").
 *  2. A JWT WITHOUT a sessionToken is rejected 401 — the closed legacy hole
 *     (auth.ts:81-85). Per CLAUDE.md rule 17 this test was proven to FAIL
 *     against the old middleware by temporarily restoring the legacy
 *     `else { req.user = decoded; next(); }` branch (see WP2 report).
 *  3. A tenant user hitting a BaseRepository-generic-CRUD-backed route sees
 *     ONLY their tenant's rows (two tenants seeded; the handler awaits an
 *     event-loop hop first, proving AsyncLocalStorage keeps the tenant
 *     context across await points inside runWithTenant(tid, () => next())).
 *  4. A super_admin JWT (tenantId null) hitting a tenant data route runs with
 *     NO tenant context — chosen behavior: FAIL-CLOSED, the repository throws
 *     TenantContextError which surfaces as the route's 500. No data leaks.
 *  5. requireSuperAdmin: tenant admin → 403; super_admin → 200; a token
 *     carrying impersonatorId → 403 (re-escalation block, plan §5).
 *  6. Previously-open routers: /api/sessions/* and /api/settings/:key are now
 *     401 unauthenticated; GET /api/settings (list) stays deliberately open
 *     (Login.tsx shop name + FeatureFlagProvider read it before login).
 *
 * NOTE on tenant context: jest.setup.ts pins a fixed tenant 1 before every
 * test (desktop parity for legacy suites). This suite exercises the WEB mode
 * where no fixed fallback exists, so our own beforeEach (which runs after the
 * setup file's) resets it — tenant context here comes exclusively from the
 * middleware's runWithTenant().
 */

import { jest } from "@jest/globals";
import type { Express, Request, Response } from "express";
import type DatabaseCtor from "better-sqlite3";

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
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_TEST_SECRET = "wp2-test-secret-0123456789-0123456789-0123456789";
const PASSWORD = "Password123!";

// Deferred (set in beforeAll after env + DB are ready)
let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let authMiddleware: typeof import("../middleware/auth");

interface LoginBody {
  success: boolean;
  data?: { user?: { id: number; role: string }; token?: string; sessionToken?: string };
  error?: { code: string; message: string };
}

async function login(username: string, password: string = PASSWORD) {
  return request(app).post("/api/auth/login").send({ username, password });
}

async function loginToken(username: string): Promise<string> {
  const res = await login(username);
  expect(res.status).toBe(200);
  const body = res.body as LoginBody;
  expect(body.data?.token).toBeDefined();
  return body.data!.token!;
}

function seedDatabase(hashPassword: (p: string) => string): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active BOOLEAN DEFAULT 1
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      device_type TEXT DEFAULT 'unknown',
      device_info TEXT,
      ip_address TEXT,
      remember_me INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Tenant-scoped table backed by BaseRepository generic CRUD (PartnerRepository
    -- inherits findAll/findById/count untouched — same fixture shape as core's
    -- BaseRepository.tenantScoping.test.ts)
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      key_name TEXT NOT NULL,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, key_name)
    );

    INSERT INTO tenants (id, name, slug, status) VALUES
      (1, 'Alpha Shop', 'alpha', 'active'),
      (2, 'Beta Shop',  'beta',  'active'),
      (3, 'Gamma Shop', 'gamma', 'suspended');

    INSERT INTO partners (tenant_id, name) VALUES
      (1, 'Alpha Partner (tenant 1)'),
      (2, 'Beta Partner (tenant 2)');

    INSERT INTO system_settings (tenant_id, key_name, value)
      VALUES (1, 'shop_name', 'Alpha Shop');
  `);

  const hash = hashPassword(PASSWORD);
  const insertUser = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`,
  );
  insertUser.run(1, "alpha_admin", hash, "admin");
  insertUser.run(2, "beta_admin", hash, "admin");
  insertUser.run(3, "gamma_admin", hash, "admin");
  insertUser.run(null, "root", hash, "super_admin");
}

beforeAll(async () => {
  // Must be set BEFORE the first @liratek/core import — core's env.ts parses
  // process.env at module load, and api/auth.ts throws without a JWT_SECRET.
  process.env.JWT_SECRET = JWT_TEST_SECRET;

  db = new RealDatabase(":memory:");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;

  core = await import("@liratek/core");
  seedDatabase(core.hashPassword);

  core.resetUserRepository();
  core.resetSessionRepository();
  core.resetAuthService();

  authMiddleware = await import("../middleware/auth");
  const { authenticateJWT, requireSuperAdmin } = authMiddleware;
  const authRoutes = (await import("../api/auth")).default;
  const settingsRoutes = (await import("../api/settings")).default;
  const sessionsRoutes = (await import("../api/sessions")).default;

  app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/sessions", sessionsRoutes);

  // Tenant-data probe backed by BaseRepository generic CRUD. The await before
  // the DB call hops the event loop, proving the ALS tenant context set by
  // runWithTenant(tid, () => next()) survives async boundaries downstream.
  app.get("/api/test/partners", authenticateJWT, async (_req: Request, res: Response) => {
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const rows = new core.PartnerRepository().findAll();
      res.json({ success: true, rows });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  });

  // Control-plane probe for requireSuperAdmin.
  app.get(
    "/api/test/admin-only",
    authenticateJWT,
    requireSuperAdmin,
    (_req: Request, res: Response) => {
      res.json({ success: true, ok: true });
    },
  );
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

beforeEach(() => {
  // Runs AFTER jest.setup.ts's beforeEach (registration order): undo its
  // fixed desktop tenant so this suite behaves like the real web backend —
  // no tenant context unless the middleware establishes one.
  core.resetTenantContext();
});

// =============================================================================
// 1. Login: JWT v2 payload + suspended-tenant rejection
// =============================================================================

describe("POST /api/auth/login (JWT v2)", () => {
  it("returns a JWT whose payload carries tenantId + sessionToken", async () => {
    const res = await login("alpha_admin");
    expect(res.status).toBe(200);

    const body = res.body as LoginBody;
    expect(body.success).toBe(true);
    const decoded = jwt.verify(body.data!.token!, JWT_TEST_SECRET) as Record<
      string,
      unknown
    >;
    expect(decoded.tenantId).toBe(1);
    expect(typeof decoded.sessionToken).toBe("string");
    expect((decoded.sessionToken as string).length).toBeGreaterThan(0);
    expect(decoded.role).toBe("admin");
  });

  it("super_admin login yields tenantId null", async () => {
    const token = await loginToken("root");
    const decoded = jwt.verify(token, JWT_TEST_SECRET) as Record<string, unknown>;
    expect(decoded.tenantId).toBeNull();
    expect(decoded.role).toBe("super_admin");
  });

  it("rejects a suspended tenant's user with 401", async () => {
    const res = await login("gamma_admin");
    expect(res.status).toBe(401);
    const body = res.body as LoginBody;
    expect(body.success).toBe(false);
    expect(body.error?.message).toBe("Account suspended — contact support");
  });

  it("existing sessions of a tenant suspended AFTER login stop working", async () => {
    const token = await loginToken("beta_admin");
    db.prepare(`UPDATE tenants SET status = 'suspended' WHERE id = 2`).run();
    try {
      const res = await request(app)
        .get("/api/test/partners")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    } finally {
      db.prepare(`UPDATE tenants SET status = 'active' WHERE id = 2`).run();
    }
  });
});

// =============================================================================
// 2. Legacy hole closed: JWT without sessionToken → 401
// =============================================================================

describe("legacy JWT rejection (closed auth.ts:81-85 hole)", () => {
  it("rejects a signed JWT without a sessionToken with 401", async () => {
    // Exactly the legacy v1 shape the old middleware accepted on signature alone.
    const legacyToken = jwt.sign(
      { userId: 1, role: "admin" },
      JWT_TEST_SECRET,
      { expiresIn: "1h" },
    );

    const res = await request(app)
      .get("/api/test/partners")
      .set("Authorization", `Bearer ${legacyToken}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid token" });
  });

  it("rejects a session-linked JWT without a tenantId claim (pre-multi-tenant token)", async () => {
    // Mint a REAL session so only the missing tenantId can be the reason.
    const loginRes = await login("alpha_admin");
    const sessionToken = (loginRes.body as LoginBody).data!.sessionToken!;
    const preMtToken = jwt.sign(
      { userId: 1, role: "admin", sessionToken },
      JWT_TEST_SECRET,
      { expiresIn: "1h" },
    );

    const res = await request(app)
      .get("/api/test/partners")
      .set("Authorization", `Bearer ${preMtToken}`);
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// 3. Tenant isolation through the middleware (ALS across await points)
// =============================================================================

describe("tenant context wraps the downstream chain", () => {
  it("tenant 1's user sees ONLY tenant 1's rows", async () => {
    const token = await loginToken("alpha_admin");
    const res = await request(app)
      .get("/api/test/partners")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const rows = res.body.rows as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(["Alpha Partner (tenant 1)"]);
  });

  it("tenant 2's user sees ONLY tenant 2's rows", async () => {
    const token = await loginToken("beta_admin");
    const res = await request(app)
      .get("/api/test/partners")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const rows = res.body.rows as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(["Beta Partner (tenant 2)"]);
  });
});

// =============================================================================
// 4. super_admin on a tenant data route: fail-closed (500), zero leakage
// =============================================================================

describe("super_admin hitting tenant data routes", () => {
  it("fails closed with 500 (TenantContextError) and leaks no rows", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .get("/api/test/partners")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.rows).toBeUndefined();
    // Belt-and-braces: no tenant data anywhere in the response
    expect(JSON.stringify(res.body)).not.toContain("Partner");
  });
});

// =============================================================================
// 5. requireSuperAdmin
// =============================================================================

describe("requireSuperAdmin", () => {
  it("rejects a tenant admin with 403", async () => {
    const token = await loginToken("alpha_admin");
    const res = await request(app)
      .get("/api/test/admin-only")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("allows a real super_admin (200)", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .get("/api/test/admin-only")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects a token carrying impersonatorId with 403 (re-escalation block)", async () => {
    // Even a super_admin-shaped token loses control-plane access the moment
    // it carries impersonatorId (plan §5: impersonation tokens never re-escalate).
    const loginRes = await login("root");
    const sessionToken = (loginRes.body as LoginBody).data!.sessionToken!;
    const rootId = (loginRes.body as LoginBody).data!.user!.id;

    const impersonationToken = jwt.sign(
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
      .get("/api/test/admin-only")
      .set("Authorization", `Bearer ${impersonationToken}`);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// 6. Previously-open routers are locked down
// =============================================================================

describe("sessions/settings route lockdown", () => {
  it("GET /api/sessions unauthenticated → 401", async () => {
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(401);
  });

  it("POST /api/sessions/start unauthenticated → 401", async () => {
    const res = await request(app)
      .post("/api/sessions/start")
      .send({ customer_name: "X" });
    expect(res.status).toBe(401);
  });

  it("GET /api/settings/:key unauthenticated → 401", async () => {
    const res = await request(app).get("/api/settings/shop_name");
    expect(res.status).toBe(401);
  });

  it("PUT /api/settings/:key unauthenticated → 401", async () => {
    const res = await request(app)
      .put("/api/settings/shop_name")
      .send({ value: "Evil Shop" });
    expect(res.status).toBe(401);
    const row = db
      .prepare(`SELECT value FROM system_settings WHERE key_name = 'shop_name'`)
      .get() as { value: string };
    expect(row.value).toBe("Alpha Shop"); // write didn't land
  });

  it("GET /api/settings (list) stays open — pre-login shop name + feature flags", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.settings)).toBe(true);
  });

  it("authenticated GET /api/settings/:key works", async () => {
    const token = await loginToken("alpha_admin");
    const res = await request(app)
      .get("/api/settings/shop_name")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
