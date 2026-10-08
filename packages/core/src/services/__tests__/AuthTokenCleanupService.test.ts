/**
 * `AuthTokenCleanupService.sweepAll()` — purges expired single-use auth
 * rows (sign-in codes, www -> shop hand-offs, password-reset and
 * email-verification links) once they are past a grace period, across every
 * database the process serves. Real `better-sqlite3` files routed through
 * `setDatabaseResolver`/`setTenantDatabaseIdLister`, the same seam
 * `SessionSweepService.test.ts` exercises.
 *
 * Invitations (`user_invitations`, `signup_invitations`) and `email_outbox`
 * are deliberately NOT swept — the tests pin that too.
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
  AUTH_TOKEN_PURGE_GRACE_MS,
  getAuthTokenCleanupService,
  resetAuthTokenCleanupService,
} from "../AuthTokenCleanupService.js";

const NOW = "2026-10-08T12:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number): string => new Date(Date.parse(NOW) - ms).toISOString();

const PLATFORM_TABLES = ["signin_codes", "sso_handoff_tokens"];
const TENANT_TABLES = ["password_reset_tokens", "email_verification_tokens"];
const KEPT_TABLES = ["user_invitations", "signup_invitations", "email_outbox"];

function makeTable(db: Database.Database, table: string): void {
  db.exec(
    `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, expires_at TEXT NOT NULL, used_at TEXT)`,
  );
}

/** Per table: one row past the grace (purged), one used row past the grace
 * (purged), one expired but still INSIDE the grace (kept), one live (kept). */
function seed(db: Database.Database, table: string): void {
  const ins = db.prepare(`INSERT INTO ${table} (expires_at, used_at) VALUES (?, ?)`);
  ins.run(ago(AUTH_TOKEN_PURGE_GRACE_MS + DAY), null);
  ins.run(ago(AUTH_TOKEN_PURGE_GRACE_MS + 1), ago(AUTH_TOKEN_PURGE_GRACE_MS + DAY));
  ins.run(ago(AUTH_TOKEN_PURGE_GRACE_MS - DAY), null);
  ins.run(new Date(Date.parse(NOW) + DAY).toISOString(), null);
}

function createFile(filePath: string, tables: string[]): Database.Database {
  const db = new Database(filePath);
  for (const t of tables) {
    makeTable(db, t);
    seed(db, t);
  }
  return db;
}

const count = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;

describe("AuthTokenCleanupService.sweepAll", () => {
  let dir: string;
  let platformDb: Database.Database | null = null;
  let pool: TenantDatabasePool | null = null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-auth-cleanup-"));
  });

  afterEach(() => {
    setDatabaseResolver(null);
    setTenantDatabaseIdLister(null);
    pool?.closeAll();
    pool = null;
    platformDb?.close();
    platformDb = null;
    resetTenantContext();
    resetAuthTokenCleanupService();
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("the grace period is 7 days", () => {
    expect(AUTH_TOKEN_PURGE_GRACE_MS).toBe(7 * DAY);
  });

  it("shared mode: one pass over the one file purges only rows past the grace, and never touches invitations or the outbox", () => {
    platformDb = createFile(path.join(dir, "shared.db"), [
      ...PLATFORM_TABLES,
      ...TENANT_TABLES,
      ...KEPT_TABLES,
    ]);
    const shared = platformDb;
    setDatabaseResolver(() => shared);

    const result = getAuthTokenCleanupService().sweepAll(NOW);

    expect(result).toEqual({
      signinCodes: 2,
      ssoHandoffTokens: 2,
      passwordResetTokens: 2,
      emailVerificationTokens: 2,
      sweptDatabaseCount: 1,
      platformFailed: false,
      failedTenantIds: [],
    });
    for (const t of [...PLATFORM_TABLES, ...TENANT_TABLES]) {
      expect(count(platformDb, t)).toBe(2);
    }
    for (const t of KEPT_TABLES) {
      expect(count(platformDb, t)).toBe(4);
    }
  });

  it("per-tenant mode: platform tables in the platform pass only, shop tables in every file; one bad shop never stops the rest", () => {
    const tenantsDir = path.join(dir, "tenants");
    fs.mkdirSync(tenantsDir);
    platformDb = createFile(path.join(dir, "platform.db"), [
      ...PLATFORM_TABLES,
      ...TENANT_TABLES,
    ]);
    // Shop files WITHOUT the platform tables: sweeping them under a shop's
    // context would throw and wrongly report a healthy shop as failed.
    createFile(path.join(tenantsDir, "1.db"), TENANT_TABLES).close();
    createFile(path.join(tenantsDir, "5.db"), TENANT_TABLES).close();
    // Shop 9 is poisoned: no token tables at all.
    const bad = new Database(path.join(tenantsDir, "9.db"));
    bad.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    bad.close();

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

    const result = getAuthTokenCleanupService().sweepAll(NOW);

    expect(result).toEqual({
      signinCodes: 2,
      ssoHandoffTokens: 2,
      // platform + shop 1 + shop 5, 2 each
      passwordResetTokens: 6,
      emailVerificationTokens: 6,
      sweptDatabaseCount: 3,
      platformFailed: false,
      failedTenantIds: [9],
    });
    for (const id of [1, 5]) {
      const f = new Database(path.join(tenantsDir, `${id}.db`));
      for (const t of TENANT_TABLES) expect(count(f, t)).toBe(2);
      f.close();
    }
  });

  it("a failing platform pass is reported, not thrown, and the shops still run", () => {
    const tenantsDir = path.join(dir, "tenants");
    fs.mkdirSync(tenantsDir);
    platformDb = new Database(path.join(dir, "platform.db")); // no tables
    createFile(path.join(tenantsDir, "1.db"), TENANT_TABLES).close();
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
    setTenantDatabaseIdLister(() => [1]);

    const result = getAuthTokenCleanupService().sweepAll(NOW);

    expect(result.platformFailed).toBe(true);
    expect(result.sweptDatabaseCount).toBe(1);
    expect(result.passwordResetTokens).toBe(2);
    expect(result.failedTenantIds).toEqual([]);
  });

  it("rejects a non-ISO 'now' instead of computing a garbage cutoff", () => {
    expect(() => getAuthTokenCleanupService().sweepAll("not a date")).toThrow();
  });
});
