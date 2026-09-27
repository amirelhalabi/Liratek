/**
 * `SessionSweepService.sweepAll()` — brand-new module (rule 17: no "before"
 * version exists, so nothing here is proven failing-first; each test is the
 * specification instead). Real `better-sqlite3` files in a temp dir, wired
 * through `setDatabaseResolver`/`setTenantDatabaseIdLister` exactly the way
 * `backend/src/database/connection.ts` wires them in `per-tenant` mode
 * (mirrors `tenantDatabasePool.routing.test.ts`'s pattern), so the sweep is
 * exercised against the SAME routing seam production uses, not a mock of it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { setDatabaseResolver, closeDatabase } from "../../db/connection.js";
import {
  getCurrentTenantId,
  isTenantBypass,
  resetTenantContext,
  TenantContextError,
} from "../../db/tenantContext.js";
import { setTenantDatabaseIdLister } from "../../db/tenantDatabaseIds.js";
import { TenantDatabasePool } from "../../db/tenantDatabasePool.js";
import {
  resetSessionRepository,
} from "../../repositories/SessionRepository.js";
import {
  getSessionSweepService,
  resetSessionSweepService,
} from "../SessionSweepService.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-session-sweep-"));
}

const SESSIONS_SCHEMA = `
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    expires_at TEXT,
    remember_me INTEGER NOT NULL DEFAULT 0,
    last_activity_at TEXT
  );
`;

function createDbFile(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.exec(SESSIONS_SCHEMA);
  return db;
}

/** One row already past `expires_at` (caught by deleteExpiredSessions), one
 * row remember_me=0 idle since a date far in the past (caught by
 * deleteInactiveSessions), one fresh row that must survive both. */
function seedRows(db: Database.Database): void {
  db.prepare(
    `INSERT INTO sessions (expires_at, remember_me, last_activity_at) VALUES (?, 0, ?)`,
  ).run("2000-01-01T00:00:00.000Z", "2026-09-27T00:00:00.000Z");
  db.prepare(
    `INSERT INTO sessions (expires_at, remember_me, last_activity_at) VALUES (?, 0, ?)`,
  ).run("2999-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO sessions (expires_at, remember_me, last_activity_at) VALUES (?, 0, ?)`,
  ).run("2999-01-01T00:00:00.000Z", new Date().toISOString());
}

describe("SessionSweepService.sweepAll", () => {
  let dir: string;
  let tenantsDir: string;
  let platformDb: Database.Database | null = null;
  let pool: TenantDatabasePool | null = null;

  afterEach(() => {
    setDatabaseResolver(null);
    setTenantDatabaseIdLister(null);
    pool?.closeAll();
    pool = null;
    platformDb?.close();
    platformDb = null;
    resetTenantContext();
    resetSessionRepository();
    resetSessionSweepService();
    closeDatabase();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("per-tenant mode: sweeps the platform file AND every tenant file, summing counts, and never stops on one bad tenant", () => {
    dir = makeTmpDir();
    tenantsDir = path.join(dir, "tenants");
    fs.mkdirSync(tenantsDir);

    platformDb = createDbFile(path.join(dir, "platform.db"));
    seedRows(platformDb);

    const tenant1Db = createDbFile(path.join(tenantsDir, "1.db"));
    seedRows(tenant1Db);
    tenant1Db.close();

    const tenant5Db = createDbFile(path.join(tenantsDir, "5.db"));
    seedRows(tenant5Db);
    tenant5Db.close();

    // Tenant 9 is poisoned: no `sessions` table at all, so both DELETEs throw.
    const tenant9Db = new Database(path.join(tenantsDir, "9.db"));
    tenant9Db.exec("CREATE TABLE not_sessions (id INTEGER PRIMARY KEY)");
    tenant9Db.close();

    pool = new TenantDatabasePool({
      dir: tenantsDir,
      openDatabase: (filePath) => new Database(filePath),
      migrate: () => {},
    });

    const platform = platformDb;
    setDatabaseResolver(() => {
      if (isTenantBypass()) return platform;
      try {
        return pool!.get(getCurrentTenantId());
      } catch (error) {
        if (error instanceof TenantContextError) return platform;
        throw error;
      }
    });
    setTenantDatabaseIdLister(() => [1, 5, 9]);

    const result = getSessionSweepService().sweepAll();

    // 3 healthy databases (platform, 1, 5) x (1 expired + 1 inactive) each.
    expect(result.expiredCount).toBe(3);
    expect(result.inactiveCount).toBe(3);
    expect(result.sweptDatabaseCount).toBe(3);
    expect(result.failedTenantIds).toEqual([9]);

    // The fresh row survived everywhere; the two stale ones are gone.
    expect(
      (platformDb!.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c,
    ).toBe(1);
    const t1 = new Database(path.join(tenantsDir, "1.db"));
    expect((t1.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c).toBe(1);
    t1.close();
    const t5 = new Database(path.join(tenantsDir, "5.db"));
    expect((t5.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c).toBe(1);
    t5.close();
  });

  it("shared mode (no lister installed): sweeps exactly the one resolved file, no fan-out attempted", () => {
    dir = makeTmpDir();
    platformDb = createDbFile(path.join(dir, "shared.db"));
    seedRows(platformDb);

    const shared = platformDb;
    setDatabaseResolver(() => shared);
    // Deliberately no setTenantDatabaseIdLister call — listTenantDatabaseIds()
    // must return null, exactly as it does in shared mode / on desktop.

    const result = getSessionSweepService().sweepAll();

    expect(result.expiredCount).toBe(1);
    expect(result.inactiveCount).toBe(1);
    expect(result.sweptDatabaseCount).toBe(1);
    expect(result.failedTenantIds).toEqual([]);
    expect(
      (platformDb!.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c,
    ).toBe(1);
  });
});
