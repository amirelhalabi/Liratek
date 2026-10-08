/**
 * SigninDirectoryService (LIRA-288) — keeps the platform `signin_directory`
 * in step with the shops' own `users` / `user_identities`.
 *
 * Runs in BOTH storage layouts, with real better-sqlite3 files routed by the
 * same `setDatabaseResolver` / `setTenantDatabaseIdLister` seam the backend
 * installs (see AuthTokenCleanupService.test.ts):
 *   - shared: one file holds the platform and every shop;
 *   - per-tenant: platform.db + tenants/<id>.db, each shop's users only in
 *     its own file. The directory must be written to platform.db only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDatabase, setDatabaseResolver } from "../../db/connection.js";
import {
  getCurrentTenantId,
  isTenantBypass,
  resetTenantContext,
  runWithoutTenant,
  TenantContextError,
} from "../../db/tenantContext.js";
import { setTenantDatabaseIdLister } from "../../db/tenantDatabaseIds.js";
import { TenantDatabasePool } from "../../db/tenantDatabasePool.js";
import {
  SigninDirectoryService,
  buildDirectoryRows,
} from "../SigninDirectoryService.js";
import { resetSigninDirectoryRepository } from "../../repositories/SigninDirectoryRepository.js";
import type { SigninUserFacts } from "../../repositories/UserRepository.js";
import { SigninCodeService } from "../SigninCodeService.js";
import { PasswordResetService } from "../PasswordResetService.js";
import { GoogleAuthService } from "../GoogleAuthService.js";
import { runWithTenant } from "../../db/tenantContext.js";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const AT = "2026-09-01T08:00:00.000Z";
const NOW = "2026-10-08T12:00:00.000Z";

const TENANTS_SQL = `
  INSERT INTO tenants (id, name, slug, status) VALUES
    (2, 'Corner Tech', 'cornertech', 'active'),
    (3, 'Rami Phones', 'ramiphones', 'active');
`;

/** Shop 2: boss (google + email), rami (email + google), an unconfirmed
 * user, a deactivated user. Shop 3: Rami again, same Gmail + Google. */
const SHOP_SQL: Record<number, string> = {
  2: `
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'x', 'admin', 1, 'owner@gmail.com', '${AT}'),
      (21, 2, 'rami', 'x', 'staff', 1, 'rami@gmail.com', '${AT}'),
      (22, 2, 'unconfirmed', 'x', 'staff', 1, 'u@gmail.com', NULL),
      (23, 2, 'gone', 'x', 'staff', 0, 'gone@gmail.com', '${AT}');
    INSERT INTO user_identities (user_id, tenant_id, provider, subject, email, created_at, updated_at) VALUES
      (21, 2, 'google', 'sub-rami', 'rami@gmail.com', '${AT}', '${AT}'),
      (23, 2, 'google', 'sub-gone', 'gone@gmail.com', '${AT}', '${AT}');
  `,
  3: `
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (30, 3, 'owner', 'x', 'admin', 1, 'rami@gmail.com', '${AT}');
    INSERT INTO user_identities (user_id, tenant_id, provider, subject, email, created_at, updated_at) VALUES
      (30, 3, 'google', 'sub-rami', 'rami@gmail.com', '${AT}', '${AT}');
  `,
};

function freshFile(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_DB_SQL);
  return db;
}

type Key = [string, string, number, number, string];
function keysOf(db: Database.Database): Key[] {
  return (
    db
      .prepare(
        `SELECT kind, value, target_tenant_id AS t, target_user_id AS u, username
           FROM signin_directory ORDER BY t, u, kind`,
      )
      .all() as Array<{ kind: string; value: string; t: number; u: number; username: string }>
  ).map((r) => [r.kind, r.value, r.t, r.u, r.username]);
}

const EXPECTED_ALL: Key[] = [
  ["email", "owner@gmail.com", 2, 20, "boss"],
  ["email", "rami@gmail.com", 2, 21, "rami"],
  ["google", "sub-rami", 2, 21, "rami"],
  ["email", "rami@gmail.com", 3, 30, "owner"],
  ["google", "sub-rami", 3, 30, "owner"],
];

function facts(over: Partial<SigninUserFacts> = {}): SigninUserFacts {
  return {
    id: 21,
    username: "rami",
    role: "staff",
    is_active: 1,
    email: "rami@gmail.com",
    email_verified_at: AT,
    ...over,
  };
}

describe("buildDirectoryRows (the one invariant)", () => {
  it("an active user: a confirmed email row and a Google row", () => {
    expect(
      buildDirectoryRows(facts(), { subject: "sub-rami", email: "Rami@Gmail.com" }),
    ).toEqual([
      { kind: "email", value: "rami@gmail.com", target_user_id: 21, username: "rami", display_email: null },
      { kind: "google", value: "sub-rami", target_user_id: 21, username: "rami", display_email: "rami@gmail.com" },
    ]);
  });

  it("an unconfirmed or missing email gives no email row", () => {
    expect(buildDirectoryRows(facts({ email_verified_at: null }), null)).toEqual([]);
    expect(buildDirectoryRows(facts({ email: null, email_verified_at: null }), null)).toEqual([]);
  });

  it("a deactivated user, a super admin, or no user gives nothing", () => {
    const google = { subject: "s", email: null };
    expect(buildDirectoryRows(facts({ is_active: 0 }), google)).toEqual([]);
    expect(buildDirectoryRows(facts({ role: "super_admin" }), google)).toEqual([]);
    expect(buildDirectoryRows(null, google)).toEqual([]);
  });
});

describe("SigninDirectoryService", () => {
  let dir: string;
  let platformDb: Database.Database | null = null;
  const shopDbs: Database.Database[] = [];
  let pool: TenantDatabasePool | null = null;
  let service: SigninDirectoryService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-signin-directory-"));
    resetSigninDirectoryRepository();
  });

  afterEach(() => {
    setDatabaseResolver(null);
    setTenantDatabaseIdLister(null);
    pool?.closeAll();
    pool = null;
    for (const db of shopDbs.splice(0)) db.close();
    platformDb?.close();
    platformDb = null;
    resetTenantContext();
    resetSigninDirectoryRepository();
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** One file: platform + both shops. Directory starts EMPTY. */
  function sharedMode(): Database.Database {
    const db = freshFile(path.join(dir, "shared.db"));
    db.exec(TENANTS_SQL + SHOP_SQL[2] + SHOP_SQL[3]);
    platformDb = db;
    setDatabaseResolver(() => db);
    service = new SigninDirectoryService();
    return db;
  }

  /** platform.db (tenants + a super admin) + tenants/2.db, tenants/3.db. */
  function perTenantMode(): { platform: Database.Database; shop: (id: number) => Database.Database } {
    const tenantsDir = path.join(dir, "tenants");
    fs.mkdirSync(tenantsDir);
    const platform = freshFile(path.join(dir, "platform.db"));
    platform.exec(TENANTS_SQL);
    platform.exec(
      `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at)
       VALUES (90, NULL, 'root', 'x', 'super_admin', 1, 'root@liratek.shop', '${AT}')`,
    );
    platformDb = platform;
    for (const id of [2, 3]) {
      const shop = freshFile(path.join(tenantsDir, `${id}.db`));
      shop.exec(TENANTS_SQL);
      shop.exec(`DELETE FROM tenants WHERE id NOT IN (1, ${id})`);
      shop.exec(SHOP_SQL[id]!);
      shop.close();
    }
    pool = new TenantDatabasePool({
      dir: tenantsDir,
      openDatabase: (filePath) => {
        const db = new Database(filePath);
        db.pragma("foreign_keys = ON");
        return db;
      },
      migrate: () => {},
    });
    const p = pool;
    setDatabaseResolver(() => {
      if (isTenantBypass()) return platform;
      try {
        return p.get(getCurrentTenantId());
      } catch (error) {
        if (error instanceof TenantContextError) return platform;
        throw error;
      }
    });
    setTenantDatabaseIdLister(() => [2, 3]);
    service = new SigninDirectoryService();
    return { platform, shop: (id) => p.get(id) };
  }

  describe("shared mode", () => {
    it("syncUser writes that user's rows, and running it twice changes nothing", () => {
      const db = sharedMode();
      expect(service.syncUser(2, 21, NOW)).toBe(true);
      expect(keysOf(db)).toEqual([
        ["email", "rami@gmail.com", 2, 21, "rami"],
        ["google", "sub-rami", 2, 21, "rami"],
      ]);
      expect(service.syncUser(2, 21, NOW)).toBe(true);
      expect(keysOf(db)).toHaveLength(2);
    });

    it("syncUser removes the rows once the user is deactivated, unconfirmed, unlinked or gone", () => {
      const db = sharedMode();
      service.syncUser(2, 21, NOW);
      db.exec(`UPDATE users SET is_active = 0 WHERE id = 21`);
      service.syncUser(2, 21, NOW);
      expect(keysOf(db)).toEqual([]);

      db.exec(`UPDATE users SET is_active = 1 WHERE id = 21`);
      service.syncUser(2, 21, NOW);
      db.exec(`UPDATE users SET email_verified_at = NULL WHERE id = 21`);
      db.exec(`DELETE FROM user_identities WHERE user_id = 21`);
      service.syncUser(2, 21, NOW);
      expect(keysOf(db)).toEqual([]);

      service.syncUser(2, 999, NOW);
      expect(keysOf(db)).toEqual([]);
    });

    it("syncUser never throws: a failure is reported as false", () => {
      const db = sharedMode();
      db.exec(`DROP TABLE signin_directory`);
      expect(service.syncUser(2, 21, NOW)).toBe(false);
    });

    it("syncTenant writes one shop's rows only", () => {
      const db = sharedMode();
      expect(service.syncTenant(3, NOW)).toBe(true);
      expect(keysOf(db)).toEqual(EXPECTED_ALL.filter((k) => k[2] === 3));
    });

    it("diff reports planted drift; rebuildAll repairs it; a second diff is clean", () => {
      const db = sharedMode();
      service.rebuildAll(NOW);
      expect(keysOf(db)).toEqual(EXPECTED_ALL);
      expect(service.diff()).toEqual({ missing: [], extra: [], stale: [], failedTenantIds: [] });

      // missing: rami's Google row; extra: a row for a deactivated user;
      // stale: owner's username differs from the shop record.
      db.exec(`DELETE FROM signin_directory WHERE kind = 'google' AND target_tenant_id = 2`);
      db.exec(
        `INSERT INTO signin_directory (kind, value, target_tenant_id, target_user_id, username, display_email, created_at, updated_at)
         VALUES ('email', 'gone@gmail.com', 2, 23, 'gone', NULL, '${NOW}', '${NOW}')`,
      );
      db.exec(`UPDATE signin_directory SET username = 'renamed' WHERE target_user_id = 30 AND kind = 'email'`);

      const drift = service.diff();
      expect(drift.missing.map((r) => [r.kind, r.value, r.target_tenant_id])).toEqual([
        ["google", "sub-rami", 2],
      ]);
      expect(drift.extra.map((r) => [r.kind, r.value, r.target_tenant_id])).toEqual([
        ["email", "gone@gmail.com", 2],
      ]);
      expect(drift.stale.map((s) => [s.expected.username, s.actual.username])).toEqual([
        ["owner", "renamed"],
      ]);

      expect(service.rebuildAll(NOW)).toEqual({ shops: 3, rows: 5, failedTenantIds: [] });
      expect(keysOf(db)).toEqual(EXPECTED_ALL);
      expect(service.diff()).toEqual({ missing: [], extra: [], stale: [], failedTenantIds: [] });
    });

    it("deleteForTenant removes a shop's rows", () => {
      const db = sharedMode();
      service.rebuildAll(NOW);
      expect(service.deleteForTenant(2)).toBe(true);
      expect(keysOf(db)).toEqual(EXPECTED_ALL.filter((k) => k[2] === 3));
    });
  });

  describe("per-tenant mode (each shop in its own file)", () => {
    it("syncUser reads the user from the shop's file and writes the platform file only", () => {
      const { platform, shop } = perTenantMode();
      expect(service.syncUser(3, 30, NOW)).toBe(true);
      expect(keysOf(platform)).toEqual(EXPECTED_ALL.filter((k) => k[2] === 3));
      expect(keysOf(shop(3))).toEqual([]);
    });

    it("rebuildAll walks every shop file; the directory answers the same as in shared mode", () => {
      const { platform, shop } = perTenantMode();
      expect(service.rebuildAll(NOW)).toEqual({ shops: 2, rows: 5, failedTenantIds: [] });
      expect(keysOf(platform)).toEqual(EXPECTED_ALL);
      expect(keysOf(shop(2))).toEqual([]);
      expect(service.diff()).toEqual({ missing: [], extra: [], stale: [], failedTenantIds: [] });
      expect(runWithoutTenant(() => service.listAll()).length).toBe(5);
    });

    it("T010: the www readers (email code, forgot password, Google) find every shop from the directory alone", () => {
      const { platform } = perTenantMode();
      service.rebuildAll(NOW);

      // Email code: a code is mailed, and a valid code lists both shops.
      const codes = new SigninCodeService({ newCode: () => "123456" });
      expect(
        codes.requestCode({
          email: "Rami@Gmail.com",
          now: NOW,
          emailConfigured: true,
          supportEmail: "help@liratek.test",
        }).queued,
      ).toBe(true);
      expect(codes.verifyCode({ email: "rami@gmail.com", code: "123456", now: NOW })).toEqual({
        shops: [
          { slug: "cornertech", name: "Corner Tech", username: "rami" },
          { slug: "ramiphones", name: "Rami Phones", username: "owner" },
        ],
      });

      // Forgot password on www: one link per shop, each in its own file.
      const resets = new PasswordResetService({ newToken: (() => { let n = 0; return () => `reset-${++n}`; })() });
      expect(
        resets.requestByEmailEveryShop({
          email: "rami@gmail.com",
          now: NOW,
          linkBaseUrl: (slug: string) => `https://${slug}.liratek.test`,
          emailConfigured: true,
          supportEmail: "help@liratek.test",
          ttlMinutes: 60,
        }),
      ).toEqual({ queued: 2 });

      // Continue with Google on www: both shops; the chooser's re-check in
      // the shop's own scope finds the user.
      const google = new GoogleAuthService();
      expect(
        runWithoutTenant(() => google.findSignInMatches("sub-rami")).map((m) => [m.tenant_id, m.user_id]),
      ).toEqual([
        [2, 21],
        [3, 30],
      ]);
      expect(runWithTenant(3, () => google.findMatchInTenant("sub-rami", 3))?.user_id).toBe(30);
      expect(keysOf(platform)).toEqual(EXPECTED_ALL);
    });

    it("a shop file that cannot be read is reported and its rows are kept, never wiped", () => {
      const { platform } = perTenantMode();
      service.rebuildAll(NOW);
      setTenantDatabaseIdLister(() => [2, 3, 4]);
      platform.exec(`INSERT INTO tenants (id, name, slug, status) VALUES (4, 'No File', 'nofile', 'active')`);
      platform.exec(
        `INSERT INTO signin_directory (kind, value, target_tenant_id, target_user_id, username, display_email, created_at, updated_at)
         VALUES ('email', 'four@gmail.com', 4, 40, 'four', NULL, '${NOW}', '${NOW}')`,
      );
      fs.writeFileSync(path.join(dir, "tenants", "4.db"), "not a database");
      const result = service.rebuildAll(NOW);
      expect(result.failedTenantIds).toEqual([4]);
      expect(keysOf(platform).filter((k) => k[2] === 4)).toEqual([
        ["email", "four@gmail.com", 4, 40, "four"],
      ]);
      expect(service.diff().failedTenantIds).toEqual([4]);
    });
  });
});
