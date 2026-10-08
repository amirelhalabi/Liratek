/**
 * LIRA-288 T006–T009 — every writer that changes a sign-in fact keeps the
 * www sign-in directory in step ("after X, the directory has exactly Y").
 *
 * Real services and repositories over one shared in-memory database built
 * from create_db.sql (the directory starts EMPTY, as after a fresh deploy
 * before any sync). The per-tenant routing of the sync itself is proven in
 * SigninDirectoryService.test.ts; here the question is only "does each
 * writer call it, after its own commit, for the right user and shop?".
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runWithTenant, runWithoutTenant } from "../../db/tenantContext.js";
import { UserRepository, getUserRepository } from "../../repositories/UserRepository.js";
import { TenantRepository, getTenantRepository } from "../../repositories/TenantRepository.js";
import { SubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import { getEmailVerificationTokenRepository } from "../../repositories/EmailVerificationTokenRepository.js";
import { getEmailOutboxRepository } from "../../repositories/EmailOutboxRepository.js";
import { getUserInvitationRepository } from "../../repositories/UserInvitationRepository.js";
import { UserEmailService } from "../UserEmailService.js";
import { GoogleAuthService } from "../GoogleAuthService.js";
import { AuthService } from "../AuthService.js";
import { UserInvitationService } from "../UserInvitationService.js";
import { TenantProvisioningService } from "../TenantProvisioningService.js";
import { resetSigninDirectoryService } from "../SigninDirectoryService.js";
import { resetSigninDirectoryRepository } from "../../repositories/SigninDirectoryRepository.js";

/** Every singleton here resolves its database lazily (getDatabase()), so
 * only the directory's own singletons need a reset between tests. */
function resetAllRepositoriesForDirectoryTest(): void {
  resetSigninDirectoryService();
  resetSigninDirectoryRepository();
}

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const NOW = "2026-10-08T12:00:00.000Z";
const AT = "2026-09-01T08:00:00.000Z";

let db: Database.Database;

beforeEach(() => {
  resetAllRepositoriesForDirectoryTest();
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'x', 'admin', 1, 'owner@gmail.com', '${AT}'),
      (21, 2, 'rami', 'x', 'staff', 1, NULL, NULL);
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
  resetAllRepositoriesForDirectoryTest();
});

type Key = [string, string, number, number];
function directory(): Key[] {
  return (
    db
      .prepare(
        `SELECT kind, value, target_tenant_id AS t, target_user_id AS u
           FROM signin_directory ORDER BY t, u, kind`,
      )
      .all() as Array<{ kind: string; value: string; t: number; u: number }>
  ).map((r) => [r.kind, r.value, r.t, r.u]);
}

const inShop = <T>(fn: () => T): T => runWithTenant(2, fn);

describe("T006 — emails", () => {
  /** Tokens "verify-token-1", "verify-token-2", … in issue order. */
  function emailService() {
    let n = 0;
    return new UserEmailService(
      getUserRepository(),
      getEmailVerificationTokenRepository(),
      getEmailOutboxRepository(),
      getTenantRepository(),
      () => `verify-token-${++n}`,
    );
  }
  const ctx = {
    tenantId: 2,
    now: NOW,
    emailConfigured: true,
    supportEmail: "help@liratek.shop",
    resolveLinkBase: () => "https://cornertech.liratek.test",
  };

  it("setting an email adds nothing (unconfirmed); confirming it adds the row; clearing it removes the row", () => {
    const svc = emailService();
    inShop(() => svc.setEmail(21, "Rami@Gmail.com", ctx));
    expect(directory()).toEqual([]);

    expect(inShop(() => svc.verify("verify-token-1", NOW, 2))).toBe(true);
    expect(directory()).toEqual([["email", "rami@gmail.com", 2, 21]]);

    inShop(() => svc.setEmail(21, null, ctx));
    expect(directory()).toEqual([]);
  });

  it("changing a confirmed email removes the old address at once", () => {
    const svc = emailService();
    // boss's confirmed address is in the directory after a sync.
    inShop(() => svc.setEmail(20, "owner@gmail.com", ctx));
    expect(inShop(() => svc.verify("verify-token-1", NOW, 2))).toBe(true);
    expect(directory()).toEqual([["email", "owner@gmail.com", 2, 20]]);
    inShop(() => svc.setEmail(20, "new-owner@gmail.com", ctx));
    expect(directory()).toEqual([]);
  });
});

describe("T007 — Google link and unlink", () => {
  it("linking adds the Google row and (no email yet) the confirmed Google email; unlinking removes only the Google row", () => {
    const google = new GoogleAuthService();
    inShop(() =>
      google.linkIdentity({ userId: 21, subject: "sub-rami", email: "rami@gmail.com", now: NOW }),
    );
    expect(directory()).toEqual([
      ["email", "rami@gmail.com", 2, 21],
      ["google", "sub-rami", 2, 21],
    ]);

    expect(inShop(() => google.unlinkIdentity(21, NOW))).toBe(true);
    expect(directory()).toEqual([["email", "rami@gmail.com", 2, 21]]);
  });
});

describe("T008 — deactivate, reactivate, role change", () => {
  it("a deactivated user leaves the directory; reactivated, they are back; a role change keeps them", () => {
    const google = new GoogleAuthService();
    inShop(() =>
      google.linkIdentity({ userId: 21, subject: "sub-rami", email: "rami@gmail.com", now: NOW }),
    );
    const auth = new AuthService(new UserRepository());

    expect(inShop(() => auth.deactivateUser(21, 20, "admin"))).toBe(true);
    expect(directory()).toEqual([]);

    expect(inShop(() => auth.reactivateUser(21, "admin"))).toBe(true);
    expect(directory()).toEqual([
      ["email", "rami@gmail.com", 2, 21],
      ["google", "sub-rami", 2, 21],
    ]);

    // Plant drift, then change the role: the sync rewrites the user's rows.
    db.exec(`DELETE FROM signin_directory`);
    expect(inShop(() => auth.setUserRole(21, "admin", "admin"))).toBe(true);
    expect(directory()).toEqual([
      ["email", "rami@gmail.com", 2, 21],
      ["google", "sub-rami", 2, 21],
    ]);
  });
});

describe("T009 — creation and shop delete", () => {
  it("an accepted invite adds the new user's confirmed email", () => {
    const invites = new UserInvitationService(
      getUserInvitationRepository(),
      getUserRepository(),
      getEmailOutboxRepository(),
      getTenantRepository(),
      () => "invite-token-1",
    );
    inShop(() =>
      invites.create({
        tenantId: 2,
        email: "sara@gmail.com",
        role: "staff",
        invitedByUserId: 20,
        now: NOW,
        emailConfigured: true,
        supportEmail: "help@liratek.shop",
        resolveLinkBase: () => "https://cornertech.liratek.test",
        ttlHours: 72,
      }),
    );
    const outcome = inShop(() =>
      invites.accept({
        token: "invite-token-1",
        username: "sara",
        password: "Str0ng-Password!",
        now: NOW,
        requiredTenantId: 2,
      }),
    );
    expect(outcome.ok).toBe(true);
    const saraId = outcome.ok ? outcome.user.id : -1;
    expect(directory()).toEqual([["email", "sara@gmail.com", 2, saraId]]);
  });

  it("a new shop's first admin (confirmed contact email) is listed; deleting the shop removes its rows", () => {
    const service = new TenantProvisioningService(
      new TenantRepository(db),
      new UserRepository(),
      new SubscriptionRepository(db),
    );
    const tenant = runWithoutTenant(() =>
      service.provisionTenant({
        name: "Rami Phones",
        slug: "ramiphones",
        adminUsername: "owner",
        adminPassword: "Str0ng-Password!",
        contactEmail: "rami@gmail.com",
        contactEmailVerifiedAt: NOW,
      }),
    );
    const admin = db
      .prepare(`SELECT id FROM users WHERE tenant_id = ? AND username = 'owner'`)
      .get(tenant.id) as { id: number };
    expect(directory()).toEqual([["email", "rami@gmail.com", tenant.id, admin.id]]);

    runWithoutTenant(() => service.deleteTenant(tenant.id, "ramiphones"));
    expect(directory()).toEqual([]);
  });

  it("deleting a shop removes its rows even with foreign keys OFF (no cascade)", () => {
    db.pragma("foreign_keys = OFF");
    const service = new TenantProvisioningService(
      new TenantRepository(db),
      new UserRepository(),
      new SubscriptionRepository(db),
    );
    const tenant = runWithoutTenant(() =>
      service.provisionTenant({
        name: "Shop Three",
        slug: "shopthree",
        adminUsername: "owner",
        adminPassword: "Str0ng-Password!",
        contactEmail: "three@gmail.com",
        contactEmailVerifiedAt: NOW,
      }),
    );
    expect(directory().some((k) => k[2] === tenant.id)).toBe(true);
    runWithoutTenant(() => service.deleteTenant(tenant.id, "shopthree"));
    expect(directory()).toEqual([]);
  });
});
