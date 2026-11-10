/**
 * LIRA-377 T025/T026/T039 — `/api/restore/*` end to end over REAL files:
 * a platform database (in memory) holding shop 2 "Corner Tech", shop 2's own
 * file on disk served through the REAL `TenantDatabasePool` +
 * `buildTenantDbResolver`, and the REAL `createShopFileSwap`. Only the auth
 * middleware is mocked (it wraps `next()` in `runWithTenant(2)` like the
 * real one), plus the Litestream source (no binary on a dev machine).
 *
 * Written FIRST: `../restore.js` did not exist on the first run (rule 17).
 * Backend jest maps `better-sqlite3` to a stub, so every repository and the
 * pool are handed the real constructor. Deliberately NOT the
 * `__LIRATEK_TEST_DB__` hook: it short-circuits the resolver, which would
 * send every "shop" statement (sessions, audit, devices) to the platform DB.
 */
import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../database/connection.js", () => ({
  getShopFilePort: () => null,
  getShopRestoreEnvironment: () => null,
}));
const mockScheduleOfflineRound = jest.fn();
jest.mock("../../offline/processorTimer.js", () => ({
  scheduleOfflineRound: (id: number) => mockScheduleOfflineRound(id),
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    const userId = Number(req.headers["x-test-user"] ?? 1);
    req.user = { userId, username: userId === 1 ? "admin" : "other", role, tenantId: 2, sessionToken: "s" };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runWithTenant } = require("@liratek/core");
    runWithTenant(2, () => next());
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;
type Db = InstanceType<typeof DatabaseCtor>;

import express from "express";
import request from "supertest";

const CREATE_DB_SQL = fs.readFileSync(path.join(__dirname, "../../../../electron-app/create_db.sql"), "utf8");
const SHOP = 2;
const SHOP_NAME = "Corner Tech";

let core: typeof import("@liratek/core");
let routes: typeof import("../restore.js");
let wiring: typeof import("../../restore/restoreService.js");
let app: Express;
let platform: Db;
let pool: InstanceType<typeof import("@liratek/core").TenantDatabasePool>;
let tmp: string;
let dirs: { tenantsDir: string; workDir: string; pointsDir: string };
let live: string;
let template: string;
let savedTestDb: unknown;
let service: InstanceType<typeof import("@liratek/core").ShopRestoreService>;

function openDb(fp: string): Db {
  const db = new RealDatabase(fp);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function tenantScopedTables(db: Db): string[] {
  const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name);
  return names.filter((t) => (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).some((c) => c.name === "tenant_id"));
}

function makeShopFile(file: string, tenantId: number, name: string): void {
  fs.copyFileSync(template, file);
  const db = new RealDatabase(file);
  db.pragma("foreign_keys = OFF");
  db.exec(`DELETE FROM tenant_subscriptions`);
  for (const t of tenantScopedTables(db)) db.prepare(`UPDATE "${t}" SET tenant_id = ? WHERE tenant_id IS NOT NULL`).run(tenantId);
  db.prepare(`UPDATE tenants SET id = ?, name = ?, slug = ?`).run(tenantId, name, `shop-${tenantId}`);
  db.close();
}

/** A real "Download backup" file of a shop file. */
function backupOf(shopFile: string, tenantId: number, dest: string): Buffer {
  const src = new RealDatabase(shopFile, { readonly: true });
  try {
    core.buildTenantBackupFile({ tenantId, destPath: dest, sourceDb: src as never, DatabaseCtor: RealDatabase as never });
  } finally {
    src.close();
  }
  return fs.readFileSync(dest);
}

const workFiles = (): string[] => (fs.existsSync(dirs.workDir) ? fs.readdirSync(dirs.workDir) : []);

async function liveQuery<T>(sql: string): Promise<T> {
  const db = new RealDatabase(live, { readonly: true });
  try {
    return db.prepare(sql).all() as T;
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-restore-route-"));
  dirs = { tenantsDir: path.join(tmp, "tenants"), workDir: path.join(tmp, "restore-work"), pointsDir: path.join(tmp, "restore-points") };
  fs.mkdirSync(dirs.tenantsDir, { recursive: true });

  platform = new RealDatabase(":memory:");
  // jest.setup.ts installs a mock DB through the test hook; it would win
  // over the resolver below, so take it away for this file.
  const hook = globalThis as unknown as Record<string, unknown>;
  savedTestDb = hook.__LIRATEK_TEST_DB__;
  delete hook.__LIRATEK_TEST_DB__;
  core = await import("@liratek/core");
  platform.exec(CREATE_DB_SQL);
  core.runMigrations(platform as never);
  platform
    .prepare(`INSERT INTO tenants (id, name, slug, status, contact_email, created_at, updated_at) VALUES (?, ?, 'cornertech', 'active', 'owner@cornertech.test', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`)
    .run(SHOP, SHOP_NAME);

  template = path.join(tmp, "template.db");
  const t = new RealDatabase(template);
  t.exec(CREATE_DB_SQL);
  core.runMigrations(t as never);
  t.close();

  live = path.join(dirs.tenantsDir, `${SHOP}.db`);
  makeShopFile(live, SHOP, SHOP_NAME);
  {
    const db = new RealDatabase(live);
    db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (?, 'In the backup', '701')`).run(SHOP);
    db.close();
  }

  pool = new core.TenantDatabasePool({
    dir: dirs.tenantsDir,
    openDatabase: (fp: string) => openDb(fp) as never,
    migrate: (db: unknown) => core.runMigrations(db as never),
  });
  const { buildTenantDbResolver } = await import("../../database/tenantDbResolver.js");
  core.setDatabaseResolver(buildTenantDbResolver(pool, () => platform as never));

  const { createShopFileSwap } = await import("../../restore/shopFileSwap.js");
  const shopFile = createShopFileSwap({
    tenantsDir: dirs.tenantsDir,
    pool,
    openDatabase: (fp: string) => openDb(fp) as never,
    migrate: (db: unknown) => core.runMigrations(db as never),
    merge: { hold: () => undefined, release: () => undefined, isRunning: () => false },
  });

  routes = await import("../restore.js");
  wiring = await import("../../restore/restoreService.js");
  service = new core.ShopRestoreService({
      restores: new core.ShopRestoresRepository(),
      candidates: new core.ShopRestoreRepository({ DatabaseCtor: RealDatabase as never }),
      files: new core.ShopRestoreFileRepository({ DatabaseCtor: RealDatabase as never }),
      ports: {
        shopFile,
        source: {
          async fetchAt() {
            throw new core.RestoreSourceError("NO_BACKUP_AT_TIME", "no matching backup files available");
          },
        },
        dirs,
        createDbSql: () => CREATE_DB_SQL,
        afterRestore: (id: number) => mockScheduleOfflineRound(id),
        supportEmail: () => "help@liratek.test",
      },
    });
  wiring.setShopRestoreServiceForTests(service);
  app = express();
  app.use(express.json());
  app.use("/api/restore", routes.default);
});

afterAll(() => {
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = savedTestDb;
  wiring?.setShopRestoreServiceForTests(undefined);
  core?.setDatabaseResolver(null);
  pool?.closeAll();
  platform?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  platform.exec(`DELETE FROM shop_restores`);
  mockScheduleOfflineRound.mockClear();
});

describe("/api/restore — access", () => {
  it("refuses an unauthenticated request (401)", async () => {
    const res = await request(app).get("/api/restore/points");
    expect(res.status).toBe(401);
  });

  it.each([
    ["get", "/api/restore/points"],
    ["post", "/api/restore/prepare"],
    ["post", "/api/restore/file?clientTzOffsetMin=0"],
    ["post", "/api/restore/confirm"],
    ["post", "/api/restore/cancel"],
  ])("refuses a staff user (403): %s %s", async (method, url) => {
    const req = method === "get" ? request(app).get(url) : request(app).post(url);
    const res = await req.set("x-test-role", "staff").set("Content-Type", "application/octet-stream").send(Buffer.from("x"));
    expect(res.status).toBe(403);
    expect(workFiles()).toEqual([]);
  });

  it("outside per-tenant mode every route says web app only", async () => {
    wiring.setShopRestoreServiceForTests(null);
    try {
      const res = await request(app).get("/api/restore/points").set("x-test-role", "admin");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, error: "Restore is only available on the web app" });
    } finally {
      wiring.setShopRestoreServiceForTests(service);
    }
  });
});

describe("/api/restore — admin", () => {
  it("GET /points answers the window and the shop name to type", async () => {
    const res = await request(app).get("/api/restore/points").set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ shopName: SHOP_NAME, beforeCopies: [], lastRestore: null });
    expect(Date.parse(res.body.data.latest) - Date.parse(res.body.data.earliest)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("POST /prepare refuses a malformed body with the plain envelope", async () => {
    const res = await request(app).post("/api/restore/prepare").set("x-test-role", "admin").send({ kind: "time", restoredTo: "yesterday", clientTzOffsetMin: 0 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
  });

  it("POST /prepare passes a refusal code through: { success:false, code, error }", async () => {
    const res = await request(app)
      .post("/api/restore/prepare")
      .set("x-test-role", "admin")
      .send({ kind: "time", restoredTo: new Date(Date.now() - 60_000).toISOString(), clientTzOffsetMin: 120 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, code: "NO_BACKUP_AT_TIME", error: "No copy of the shop is available for that moment" });
    expect(workFiles()).toEqual([]);
  });

  it("POST /file: another shop's backup is OTHER_SHOP with that shop's name; nothing changes", async () => {
    const otherShop = path.join(tmp, "4.db");
    makeShopFile(otherShop, 4, "Rival Phones");
    const body = backupOf(otherShop, 4, path.join(tmp, "rival-backup.db"));
    const before = fs.readFileSync(live);
    const res = await request(app).post("/api/restore/file?clientTzOffsetMin=120").set("x-test-role", "admin").set("Content-Type", "application/octet-stream").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, code: "OTHER_SHOP", shopName: "Rival Phones" });
    expect(String(res.body.error)).toContain("Rival Phones");
    expect(workFiles()).toEqual([]);
    expect(fs.readFileSync(live).equals(before)).toBe(true);
  });

  it("POST /file: an empty or non-file body is NOT_A_SHOP_FILE", async () => {
    const res = await request(app).post("/api/restore/file?clientTzOffsetMin=0").set("x-test-role", "admin").send({ hello: "world" });
    expect(res.body).toMatchObject({ success: false, code: "NOT_A_SHOP_FILE" });
    expect(workFiles()).toEqual([]);
  });

  it("POST /file: a body over 64 MB is refused before anything is staged", async () => {
    const res = await request(app)
      .post("/api/restore/file?clientTzOffsetMin=0")
      .set("x-test-role", "admin")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.alloc(64 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ success: false, code: "FILE_TOO_LARGE" });
    expect(workFiles()).toEqual([]);
  });

  it("POST /file: a small gzip that inflates past 64 MB is refused too", async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(65 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const res = await request(app)
      .post("/api/restore/file?clientTzOffsetMin=0")
      .set("x-test-role", "admin")
      .set("Content-Type", "application/octet-stream")
      .set("Content-Encoding", "gzip")
      .send(bomb);
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ success: false, code: "FILE_TOO_LARGE" });
    expect(workFiles()).toEqual([]);
  });

  it("own gzipped backup → prepare; NAME_MISMATCH; NOT_YOURS; then confirm restores it and every session ends", async () => {
    const backup = backupOf(live, SHOP, path.join(tmp, "own-backup.db"));
    // after the backup: a client and a signed-in session in the live shop
    const tok = "live-session-token";
    await core.runWithTenant(SHOP, async () => {
      const db = core.getDatabase();
      db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (?, 'After the backup', '702')`).run(SHOP);
      db.prepare(`INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (?, 1, ?, datetime('now', '+1 day'))`).run(SHOP, tok);
    });
    // the probe works: the session is valid before the restore
    expect(await core.runWithTenant(SHOP, () => core.getAuthService().validateSession(tok))).not.toBeNull();

    const prep = await request(app)
      .post("/api/restore/file?clientTzOffsetMin=120")
      .set("x-test-role", "admin")
      .set("Content-Type", "application/octet-stream")
      .set("Content-Encoding", "gzip")
      .send(zlib.gzipSync(backup));
    expect(prep.status).toBe(200);
    expect(prep.body.success).toBe(true);
    const { restoreId, shopName, preview, expiresAt } = prep.body.data;
    expect(shopName).toBe(SHOP_NAME);
    expect(typeof expiresAt).toBe("string");
    expect(preview).toHaveProperty("restoredTo");
    expect(preview).toHaveProperty("lost");

    const wrong = await request(app).post("/api/restore/confirm").set("x-test-role", "admin").send({ restoreId, typedShopName: "corner tech" });
    expect(wrong.status).toBe(200);
    expect(wrong.body).toEqual({ success: false, code: "NAME_MISMATCH", error: "The shop name you typed does not match" });

    const other = await request(app).post("/api/restore/confirm").set("x-test-role", "admin").set("x-test-user", "7").send({ restoreId, typedShopName: SHOP_NAME });
    expect(other.body).toMatchObject({ success: false, code: "NOT_YOURS" });

    const ok = await request(app).post("/api/restore/confirm").set("x-test-role", "admin").send({ restoreId, typedShopName: SHOP_NAME });
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(ok.body.data).toMatchObject({ restoreId, beforeCopy: { takenAt: expect.any(String) } });

    const names = await liveQuery<{ full_name: string }[]>(`SELECT full_name FROM clients ORDER BY id`);
    expect(names.map((r) => r.full_name)).toEqual(["In the backup"]);
    expect(await liveQuery<{ c: number }[]>(`SELECT COUNT(*) AS c FROM sessions`)).toEqual([{ c: 0 }]);
    // the caller's next request: no session row → validateSession null → 401
    expect(await core.runWithTenant(SHOP, () => core.getAuthService().validateSession(tok))).toBeNull();
    // audit written into the NEW shop file, after the swap
    const audit = await liveQuery<{ action: string; summary: string }[]>(`SELECT action, summary FROM audit_log WHERE action = 'shop_restore'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.summary).toMatch(/^Shop restored to \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // owner email queued in the platform outbox
    const mail = platform.prepare(`SELECT template, to_email FROM email_outbox WHERE template = 'shop-restored'`).all();
    expect(mail).toEqual([{ template: "shop-restored", to_email: "owner@cornertech.test" }]);
    expect(mockScheduleOfflineRound).toHaveBeenCalledWith(SHOP);
    expect(workFiles()).toEqual([]);

    const pts = await request(app).get("/api/restore/points").set("x-test-role", "admin");
    expect(pts.body.data.beforeCopies).toEqual([{ restoreId, takenAt: expect.any(String), byName: "admin" }]);
    expect(pts.body.data.lastRestore).toMatchObject({ restoreId });

    // UNDO through the real swap (SC-004): the before-copy is a VACUUM INTO
    // of the WAL live file. The before-copy file name is stamped to the
    // second, so the undo's own swap must not run in the same second.
    await new Promise((r) => setTimeout(r, 1100));
    const undo = await request(app).post("/api/restore/prepare").set("x-test-role", "admin").send({ kind: "undo", restoreId, clientTzOffsetMin: 120 });
    expect(undo.body.success).toBe(true);
    expect(undo.body.data.shopName).toBe(SHOP_NAME);
    const undone = await request(app).post("/api/restore/confirm").set("x-test-role", "admin").send({ restoreId: undo.body.data.restoreId, typedShopName: SHOP_NAME });
    expect(undone.body.success).toBe(true);
    const back = await liveQuery<{ full_name: string }[]>(`SELECT full_name FROM clients ORDER BY id`);
    expect(back.map((r) => r.full_name)).toEqual(["In the backup", "After the backup"]);
    expect(await liveQuery<{ c: number }[]>(`SELECT COUNT(*) AS c FROM sessions`)).toEqual([{ c: 0 }]);
    expect(await liveQuery<{ r: string }[]>(`PRAGMA integrity_check`)).toEqual([{ integrity_check: "ok" }]);
    expect(workFiles()).toEqual([]);
  });

  it("POST /cancel expires a prepared restore", async () => {
    const backup = backupOf(live, SHOP, path.join(tmp, "own-backup-2.db"));
    const prep = await request(app).post("/api/restore/file?clientTzOffsetMin=0").set("x-test-role", "admin").set("Content-Type", "application/octet-stream").send(backup);
    expect(prep.body.success).toBe(true);
    const res = await request(app).post("/api/restore/cancel").set("x-test-role", "admin").send({ restoreId: prep.body.data.restoreId });
    expect(res.body).toEqual({ success: true, data: { restoreId: prep.body.data.restoreId } });
    expect(workFiles()).toEqual([]);
  });
});
