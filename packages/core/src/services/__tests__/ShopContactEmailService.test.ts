/**
 * LIRA-290 (owner decision 2026-10-08): a shop's contact email — what "this
 * email already has a shop" checks — is its FIRST ADMIN's confirmed email.
 * `ShopContactEmailService.fillFromFirstAdmin(tenantId)` sets a NULL
 * `tenants.contact_email` from it, never overwrites, and never throws.
 *
 * It runs from the sign-in directory sync, which every writer of a sign-in
 * fact already calls after its commit (email set/verify, Google link, invite
 * accept, role/active changes, shop provisioning) — so the writer tests
 * below go through the real services, not the filler directly.
 *
 * Real repositories over one in-memory database built from create_db.sql.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext.js";
import { UserRepository, getUserRepository } from "../../repositories/UserRepository.js";
import { getTenantRepository } from "../../repositories/TenantRepository.js";
import { getEmailVerificationTokenRepository } from "../../repositories/EmailVerificationTokenRepository.js";
import { getEmailOutboxRepository } from "../../repositories/EmailOutboxRepository.js";
import { UserEmailService } from "../UserEmailService.js";
import { GoogleAuthService } from "../GoogleAuthService.js";
import { AuthService } from "../AuthService.js";
import { SigninDirectoryService, resetSigninDirectoryService } from "../SigninDirectoryService.js";
import { resetSigninDirectoryRepository } from "../../repositories/SigninDirectoryRepository.js";
import {
  ShopContactEmailService,
  resetShopContactEmailService,
} from "../ShopContactEmailService.js";

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

function resetSingletons(): void {
  resetSigninDirectoryService();
  resetSigninDirectoryRepository();
  resetShopContactEmailService();
}

beforeEach(() => {
  resetSingletons();
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status, contact_email) VALUES
      (2, 'Corner Tech', 'cornertech', 'active', NULL),
      (3, 'Test', 'test', 'active', NULL),
      (4, 'Has email', 'hasemail', 'active', 'kept@shop.com');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'x', 'admin', 1, NULL, NULL),
      (21, 2, 'rami', 'x', 'staff', 1, NULL, NULL),
      (22, 2, 'second', 'x', 'admin', 1, NULL, NULL),
      (30, 3, 'boss3', 'x', 'admin', 1, NULL, NULL),
      (40, 4, 'boss4', 'x', 'admin', 1, 'other@gmail.com', '${AT}');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
  resetSingletons();
});

function contactOf(id: number): string | null {
  return (
    db.prepare(`SELECT contact_email FROM tenants WHERE id = ?`).get(id) as {
      contact_email: string | null;
    }
  ).contact_email;
}

function setUserEmail(id: number, email: string | null, verifiedAt: string | null) {
  db.prepare(`UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?`).run(
    email,
    verifiedAt,
    id,
  );
}

describe("fillFromFirstAdmin", () => {
  it("sets a NULL contact email to the first admin's confirmed email", () => {
    setUserEmail(20, "owner@gmail.com", AT);
    expect(new ShopContactEmailService().fillFromFirstAdmin(2)).toBe(true);
    expect(contactOf(2)).toBe("owner@gmail.com");
  });

  it("never overwrites an existing contact email", () => {
    expect(new ShopContactEmailService().fillFromFirstAdmin(4)).toBe(false);
    expect(contactOf(4)).toBe("kept@shop.com");
  });

  it("skips an unconfirmed email", () => {
    setUserEmail(20, "owner@gmail.com", null);
    expect(new ShopContactEmailService().fillFromFirstAdmin(2)).toBe(false);
    expect(contactOf(2)).toBeNull();
  });

  it("only the FIRST admin counts — not a later admin, not staff", () => {
    setUserEmail(21, "staff@gmail.com", AT);
    setUserEmail(22, "second@gmail.com", AT);
    expect(new ShopContactEmailService().fillFromFirstAdmin(2)).toBe(false);
    expect(contactOf(2)).toBeNull();
  });

  it("skips (without throwing) an address another shop already holds", () => {
    setUserEmail(20, "kept@shop.com", AT);
    expect(new ShopContactEmailService().fillFromFirstAdmin(2)).toBe(false);
    expect(contactOf(2)).toBeNull();
  });

  it("never throws: an unknown shop is just false", () => {
    expect(new ShopContactEmailService().fillFromFirstAdmin(999)).toBe(false);
  });
});

describe("backfillAll", () => {
  it("fills every shop with a NULL contact email, lowest shop id first", () => {
    setUserEmail(20, "owner@gmail.com", AT);
    setUserEmail(30, "owner@gmail.com", AT);
    const result = new ShopContactEmailService().backfillAll();
    expect(result).toEqual({ filled: [2] });
    expect(contactOf(2)).toBe("owner@gmail.com");
    expect(contactOf(3)).toBeNull();
    expect(contactOf(4)).toBe("kept@shop.com");
  });

  it("per-tenant mode: a shop with no database file is never opened", () => {
    setUserEmail(20, "owner@gmail.com", AT);
    setUserEmail(30, "boss3@gmail.com", AT);
    const result = new ShopContactEmailService({
      listTenantFileIds: () => [3, 4],
    }).backfillAll();
    expect(result).toEqual({ filled: [3] });
    expect(contactOf(2)).toBeNull();
    expect(contactOf(3)).toBe("boss3@gmail.com");
  });

  it("runs as part of the sign-in directory rebuild (the per-tenant repair command)", () => {
    setUserEmail(30, "boss3@gmail.com", AT);
    new SigninDirectoryService().rebuildAll(NOW);
    expect(contactOf(3)).toBe("boss3@gmail.com");
  });
});

describe("writers fill it after their commit", () => {
  const inShop = <T>(fn: () => T): T => runWithTenant(2, fn);
  const ctx = {
    tenantId: 2,
    now: NOW,
    emailConfigured: true,
    supportEmail: "help@liratek.shop",
    resolveLinkBase: () => "https://cornertech.liratek.test",
  };
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

  it("confirming the first admin's email sets it; setting (unconfirmed) does not", () => {
    const svc = emailService();
    inShop(() => svc.setEmail(20, "Owner@Gmail.com", ctx));
    expect(contactOf(2)).toBeNull();
    expect(inShop(() => svc.verify("verify-token-1", NOW, 2))).toBe(true);
    expect(contactOf(2)).toBe("owner@gmail.com");
  });

  it("a later change of the first admin's email never overwrites it", () => {
    setUserEmail(20, "owner@gmail.com", AT);
    new ShopContactEmailService().fillFromFirstAdmin(2);
    expect(contactOf(2)).toBe("owner@gmail.com");
    const svc = emailService();
    inShop(() => svc.setEmail(20, "new@gmail.com", ctx));
    expect(inShop(() => svc.verify("verify-token-1", NOW, 2))).toBe(true);
    expect(contactOf(2)).toBe("owner@gmail.com");
  });

  it("confirming a STAFF email does not set it", () => {
    const svc = emailService();
    inShop(() => svc.setEmail(21, "rami@gmail.com", ctx));
    expect(inShop(() => svc.verify("verify-token-1", NOW, 2))).toBe(true);
    expect(contactOf(2)).toBeNull();
  });

  it("connecting Google on the first admin (no email yet) sets it", () => {
    inShop(() =>
      new GoogleAuthService().linkIdentity({
        userId: 20,
        subject: "sub-owner",
        email: "owner@gmail.com",
        now: NOW,
      }),
    );
    expect(contactOf(2)).toBe("owner@gmail.com");
  });

  it("when the first admin is deactivated, the next admin becomes first and fills it", () => {
    setUserEmail(22, "second@gmail.com", AT);
    const auth = new AuthService(new UserRepository());
    expect(inShop(() => auth.deactivateUser(20, 22, "admin"))).toBe(true);
    expect(contactOf(2)).toBe("second@gmail.com");
  });
});
