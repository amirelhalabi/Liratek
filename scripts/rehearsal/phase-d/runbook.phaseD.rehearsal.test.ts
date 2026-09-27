/**
 * ADVERSARIAL REHEARSAL, PART B (backend-flavored jest — HTTP-level
 * verification). Lives under `scripts/rehearsal/phase-d/`, run explicitly via
 * `jest.backend.config.cjs` in this same folder — see `README.md` here for
 * the command. NOT part of `yarn test`/CI: this folder is outside both
 * `packages/core/jest.config.cjs`'s and `backend/jest.config.cjs`'s `roots`.
 *
 * Continues from `split.phaseD.rehearsal.test.ts` (PART A, same folder),
 * which MUST be run first: it builds a production-like DB from a copy of the
 * real desktop DB, provisions a second tenant, snapshots it, dry-runs then
 * really runs the Phase D split tool (real better-sqlite3 — this config's
 * backend-derived settings globally mock better-sqlite3 for bare
 * `"better-sqlite3"` imports, which would silently turn the split tool into
 * a no-op reporting `ok: true` if it ran here instead — see the report),
 * and writes a manifest describing where everything landed.
 *
 * This file reads that manifest and: boots per-tenant routing in-process
 * against the split output (mirrors `connection.ts#installTenantDbRouting`),
 * proves each shop's admin sees exactly its own pre-split data, proves a
 * token minted BEFORE the split still validates after, demonstrates what the
 * documented rollback actually does to a post-split write, and proves the
 * safety lock refuses an unsplit file.
 *
 * Scratch test file — not part of the guarded suite.
 */
import fs from "node:fs";
import path from "node:path";
import type DatabaseCtor from "better-sqlite3";
import type { Express } from "express";

jest.mock("../../../backend/src/server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

import { openAndConfigure } from "../../../backend/src/database/openAndConfigure.js";
import { listTenantDatabaseIdsFromDir } from "../../../backend/src/database/tenantDirLister.js";
import { migrateAllTenants } from "../../../backend/src/database/migrateAllTenants.js";
import { checkTenantCompleteness } from "../../../backend/src/database/tenantCompletenessCheck.js";
import { MANIFEST_PATH } from "./scratchPaths.js";

jest.setTimeout(60_000);

const JWT_TEST_SECRET =
  "phase-d-rehearsal-test-secret-0123456789-0123456789-0123456789";
const APP_BASE_DOMAIN_TEST = "liratek.test";
const SIGNUP_INVITE_CODE_TEST = "phase-d-invite-999";

interface Manifest {
  rootDir: string;
  dataDir: string;
  tenantsDir: string;
  platformDbPath: string;
  preSplitBackupPath: string;
  unsplitPath: string;
  tenant1Id: number;
  tenant5Id: number;
  tenant5Slug: string;
  tenant1KnownPassword: string;
  tenant5AdminUsername: string;
  tenant5AdminPassword: string;
  preSplitCounts: Record<string, number>;
  preSplitSessionToken: string;
  preSplitUserId: number;
  preSplitRole: string;
}

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: unknown;
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

let core: typeof import("@liratek/core");
let manifest: Manifest;

beforeAll(async () => {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      `Phase D rehearsal manifest not found at ${MANIFEST_PATH} — run ` +
        `split.phaseD.rehearsal.test.ts (this same folder, via jest.core.config.cjs) FIRST ` +
        `(it builds the production-like DB and runs the real split; this file only ` +
        `continues with HTTP-level verification of the already-split output).`,
    );
  }
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

  process.env.JWT_SECRET = JWT_TEST_SECRET;
  process.env.APP_BASE_DOMAIN = APP_BASE_DOMAIN_TEST;
  process.env.SIGNUP_INVITE_CODE = SIGNUP_INVITE_CODE_TEST;
  delete process.env.TENANT_DB_MODE;
  core = await import("@liratek/core");
});

describe("Phase D rehearsal (backend half) — boot per-tenant on the split output, verify", () => {
  let app: Express;
  let pool: InstanceType<typeof core.TenantDatabasePool>;
  let platformDb: InstanceType<typeof DatabaseCtor>;
  const SUPER_ADMIN_USERNAME_TEST = "phased_root";
  const SUPER_ADMIN_PASSWORD_TEST = "PhaseDRootPass1!";

  afterAll(() => {
    pool?.closeAll();
    core.setDatabaseResolver(null);
    core.setTenantDatabaseIdLister(null);
    core.setTenantStorageProvisioner(null);
    try {
      platformDb?.close();
    } catch {
      /* already closed by a test below */
    }
    delete process.env.TENANT_DB_MODE;
  });

  it("Step 4 (§ 12.4 safety lock): checkPlatformSplitStatus on the MOVED platform file reports splitRequired: false (re-confirmed from this process)", () => {
    const db = new RealDatabase(manifest.platformDbPath, { readonly: true });
    const status = core.checkPlatformSplitStatus(db);
    db.close();
    expect(status.splitRequired).toBe(false);
    expect(status.totalRows).toBe(0);
  });

  it("Step 5: boot per-tenant routing in-process (mirrors connection.ts#installTenantDbRouting), migrate-all TIMED, completeness check — missing: 0", async () => {
    // CRITICAL: backend/src/jest.setup.ts sets globalThis.__LIRATEK_TEST_DB__
    // to a MOCK database at file-load time, and core's getDatabase() checks
    // that test hook BEFORE consulting the resolver (connection.ts's own
    // comment: "Test hook: allow injecting a mock DB... consults it after
    // the test hook and before the single db fallback"). Any backend test
    // that installs a per-tenant resolver but never clears this hook has its
    // resolver silently never invoked — every getDatabase() call returns the
    // mock instead, whose .all()/.get() stub always return []/undefined.
    // This is exactly what happened on the first pass of this rehearsal:
    // TenantRepository.listAllRows() silently read the MOCK, not the real
    // platform file, making every found tenant id look like an "orphan".
    delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;

    platformDb = new RealDatabase(manifest.platformDbPath);
    configureConnection(platformDb);

    pool = new core.TenantDatabasePool({
      dir: manifest.tenantsDir,
      openDatabase: (fp: string) =>
        openAndConfigure(fp, (p) => new RealDatabase(p), configureConnection),
      migrate: (db: InstanceType<typeof DatabaseCtor>) => core.runMigrations(db),
    });

    const { buildTenantDbResolver } = await import("../../../backend/src/database/tenantDbResolver");
    const { createPerTenantStorageProvisioner } = await import(
      "../../../backend/src/database/perTenantStorageProvisioner"
    );
    const createDbSql = fs.readFileSync(
      path.join(__dirname, "../../../electron-app/create_db.sql"),
      "utf8",
    );

    core.resetUserRepository();
    core.resetSessionRepository();
    core.resetAuthService();
    core.resetTenantRepository();
    core.resetSubscriptionRepository();
    core.resetClientRepository();
    core.resetClientService();
    core.resetTenantProvisioningService();

    core.setDatabaseResolver(buildTenantDbResolver(pool, () => platformDb));
    core.setTenantDatabaseIdLister(() => listTenantDatabaseIdsFromDir(manifest.tenantsDir));
    core.setTenantStorageProvisioner(
      createPerTenantStorageProvisioner({
        tenantsDir: manifest.tenantsDir,
        pool,
        openRawDatabase: (fp: string) => new RealDatabase(fp),
        configureConnection,
        runMigrations: (db) => core.runMigrations(db),
        createDbSql,
        platformTenantRepo: core.getTenantRepository(),
        platformSubscriptionRepo: core.getSubscriptionRepository(),
      }),
    );
    core.resetTenantProvisioningService();

    process.env.TENANT_DB_MODE = "per-tenant";

    const ids = listTenantDatabaseIdsFromDir(manifest.tenantsDir);
    expect(ids.sort()).toEqual([manifest.tenant1Id, manifest.tenant5Id].sort());

    const t0 = Date.now();
    const summary = migrateAllTenants(ids, pool, () => {});
    const migrateMs = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.error(
      `[phaseD rehearsal] migrateAllTenants(${ids.length} tenants, real desktop-size files) took ${migrateMs}ms`,
    );
    expect(summary.ok).toBe(2);
    expect(summary.failed).toBe(0);

    const tenantRows = core.runWithoutTenant(() => core.getTenantRepository().listAllRows());
    const completeness = checkTenantCompleteness(tenantRows, ids);
    expect(completeness.missingIds).toEqual([]);
    expect(completeness.orphanIds).toEqual([]);

    platformDb
      .prepare(
        `INSERT INTO users (username, password_hash, role, is_active, tenant_id)
         VALUES (?, ?, 'super_admin', 1, NULL)`,
      )
      .run(SUPER_ADMIN_USERNAME_TEST, core.hashPassword(SUPER_ADMIN_PASSWORD_TEST));

    const authRoutes = (await import("../../../backend/src/api/auth")).default;
    const adminRoutes = (await import("../../../backend/src/api/admin")).default;
    const clientRoutes = (await import("../../../backend/src/api/clients")).default;

    app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/clients", clientRoutes);
  });

  it("Step 6: CornerTech's (tenant 1) admin logs in on ITS host and sees exactly its pre-split data", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Host", `default.${APP_BASE_DOMAIN_TEST}`)
      .send({ username: "owner", password: manifest.tenant1KnownPassword });
    expect(res.status).toBe(200);
    const token = (res.body as ApiBody).data!.token as string;

    const clientsRes = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${token}`);
    expect(clientsRes.status).toBe(200);
    const clients = (clientsRes.body as ApiBody).data!.clients as unknown[];
    expect(clients.length).toBe(manifest.preSplitCounts.clients);

    // Independent, direct-file count check for EVERY key table (not just
    // clients) — compares the split output file straight against the
    // manifest's pre-split snapshot.
    for (const [table, expected] of Object.entries(manifest.preSplitCounts)) {
      const row = readOne<{ c: number }>(
        path.join(manifest.tenantsDir, `${manifest.tenant1Id}.db`),
        `SELECT COUNT(*) c FROM "${table}"`,
      );
      expect(row?.c).toBe(expected);
    }
  });

  it("Step 7: shop 5 logs in on ITS host and sees exactly its own data (not tenant 1's)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Host", `${manifest.tenant5Slug}.${APP_BASE_DOMAIN_TEST}`)
      .send({
        username: manifest.tenant5AdminUsername,
        password: manifest.tenant5AdminPassword,
      });
    expect(res.status).toBe(200);
    const token = (res.body as ApiBody).data!.token as string;

    const clientsRes = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${token}`);
    expect(clientsRes.status).toBe(200);
    const clients = (clientsRes.body as ApiBody).data!.clients as Array<{
      phone_number: string;
    }>;
    expect(clients).toHaveLength(1);
    expect(clients[0].phone_number).toBe("70999888");
  });

  it("Step 8: super admin logs in on the platform host and lists both tenants; guards report clean", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Host", APP_BASE_DOMAIN_TEST)
      .send({ username: SUPER_ADMIN_USERNAME_TEST, password: SUPER_ADMIN_PASSWORD_TEST });
    expect(res.status).toBe(200);
    const superAdminToken = (res.body as ApiBody).data!.token as string;

    const listRes = await request(app)
      .get("/api/admin/tenants")
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(listRes.status).toBe(200);
    const tenants = (listRes.body as ApiBody).data!.tenants as Array<{ id: number }>;
    expect(tenants.map((t) => t.id).sort()).toEqual(
      [manifest.tenant1Id, manifest.tenant5Id].sort(),
    );
  });

  it("Step 9 (§ 4 pre-split token): a JWT built around a session minted BEFORE the split still validates AFTER the split + switch", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jwt = require("jsonwebtoken");
    const preSplitJwt = jwt.sign(
      {
        userId: manifest.preSplitUserId,
        role: manifest.preSplitRole,
        sessionToken: manifest.preSplitSessionToken,
        tenantId: manifest.tenant1Id,
      },
      JWT_TEST_SECRET,
      { expiresIn: "7d" },
    );

    // Confirm the session row actually followed the split into tenant 1's
    // own file (not left behind in a stale platform copy).
    const row = readOne(
      path.join(manifest.tenantsDir, `${manifest.tenant1Id}.db`),
      "SELECT id FROM sessions WHERE token = ?",
      [manifest.preSplitSessionToken],
    );
    expect(row).toBeDefined();

    const res = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${preSplitJwt}`);
    expect(res.status).toBe(200);
  });

  it("Step 10 (§ 2 rollback window): a post-split write survives in the tenant file but is LOST from the restored pre-split shared file, with no merge tool available", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .set("Host", `default.${APP_BASE_DOMAIN_TEST}`)
      .send({ username: "owner", password: manifest.tenant1KnownPassword });
    const token = (loginRes.body as ApiBody).data!.token as string;

    const uniquePhone = "70000999";
    const createRes = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "Post-Split Sale Client", phone_number: uniquePhone });
    expect(createRes.status).toBe(201);

    const inTenantFile = readAll(
      path.join(manifest.tenantsDir, `${manifest.tenant1Id}.db`),
      "SELECT * FROM clients WHERE phone_number = ?",
      [uniquePhone],
    );
    expect(inTenantFile).toHaveLength(1);

    // ---- Runbook's documented rollback ----
    // "set TENANT_DB_MODE=shared back, restore liratek.db.pre-split-backup
    // over liratek.db (delete -wal/-shm first), redeploy."
    pool.closeAll();
    core.setDatabaseResolver(null);
    core.setTenantDatabaseIdLister(null);
    core.setTenantStorageProvisioner(null);
    platformDb.close();
    delete process.env.TENANT_DB_MODE;

    const restoredLivePath = path.join(manifest.rootDir, "liratek.db.restored-after-rollback");
    fs.copyFileSync(manifest.preSplitBackupPath, restoredLivePath);
    for (const suffix of ["-wal", "-shm"]) {
      const p = restoredLivePath + suffix;
      if (fs.existsSync(p)) fs.rmSync(p);
    }

    // FINDING: the post-split write is COMPLETELY ABSENT from the restored
    // (pre-split) shared file — the documented rollback discards every
    // write made during the per-tenant window, with no merge tool anywhere
    // in the repo (checked: no script under scripts/ or backend/src/scripts/
    // mentions "merge" in this context).
    const lostRows = readAll(
      restoredLivePath,
      "SELECT * FROM clients WHERE phone_number = ?",
      [uniquePhone],
    );
    expect(lostRows).toHaveLength(0);

    // Not merged anywhere — orphaned in the now-unread tenant file.
    const stillOrphaned = readAll(
      path.join(manifest.tenantsDir, `${manifest.tenant1Id}.db`),
      "SELECT * FROM clients WHERE phone_number = ?",
      [uniquePhone],
    );
    expect(stillOrphaned).toHaveLength(1);
  });
});

// =============================================================================
// Safety lock, HTTP-level: boot per-tenant mode against the UNSPLIT copy —
// confirm the app stays on shared-mode behaviour rather than 404-ing every
// shop.
// =============================================================================

describe("Phase D rehearsal — flipping per-tenant mode on an UNSPLIT file (HTTP level)", () => {
  it("checkPlatformSplitStatus refuses; a request against the single shared file still succeeds (no resolver installed)", async () => {
    const db = new RealDatabase(manifest.unsplitPath);
    configureConnection(db);
    core.runMigrations(db);

    const status = core.checkPlatformSplitStatus(db);
    expect(status.splitRequired).toBe(true);
    expect(status.totalRows).toBeGreaterThan(0);
    expect(status.tablesWithShopRows.some((t) => t.table === "clients")).toBe(true);

    // Mirrors connection.ts's own branch on splitRequired: true — the
    // resolver/lister/provisioner are never installed. Exactly today's
    // shared-mode behaviour.
    core.setDatabaseResolver(null);
    core.setTenantDatabaseIdLister(null);
    core.setTenantStorageProvisioner(null);

    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    core.resetUserRepository();
    core.resetSessionRepository();
    core.resetAuthService();
    core.resetClientRepository();
    core.resetClientService();

    const authRoutes = (await import("../../../backend/src/api/auth")).default;
    const clientRoutes = (await import("../../../backend/src/api/clients")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    app.use("/api/clients", clientRoutes);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "owner", password: manifest.tenant1KnownPassword });
    // The unsplit copy never had its "owner" password reset by Part A (that
    // mutation only happened to the SEPARATE production-like working copy),
    // so real credentials are unknown here — the assertion that matters is
    // that this returns an ORDINARY 401 (bad credentials), never a 404 "no
    // database file for tenant" or a crash — proving the refusal path kept
    // the app on the single shared file rather than taking it down.
    expect(res.status).toBe(401);
    expect((res.body as ApiBody).error).toBeDefined();

    const clientsRes = await request(app).get("/api/clients").set("Authorization", "Bearer bogus");
    expect(clientsRes.status).toBe(401);

    delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });
});
