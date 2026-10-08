/**
 * LIRA-288 T014 — "Join with Google" on an invite link.
 *
 * Real services over one shared in-memory database from create_db.sql.
 *
 *   prepareJoinWithGoogle: before leaving for Google — the link is usable and
 *     the chosen username is free in the invite's shop.
 *   acceptWithGoogle: after Google — claim, check the Google email is the
 *     invited address (verified, case-insensitive), create the user (invited
 *     role, chosen username, email CONFIRMED, an unusable random password)
 *     and link Google in ONE shop transaction, finalize, sync the directory.
 *     Every refusal releases the claim, so the link stays usable.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext.js";
import { getUserRepository } from "../../repositories/UserRepository.js";
import { getTenantRepository } from "../../repositories/TenantRepository.js";
import { getEmailOutboxRepository } from "../../repositories/EmailOutboxRepository.js";
import { getUserInvitationRepository } from "../../repositories/UserInvitationRepository.js";
import {
  UserInvitationService,
  type JoinGoogleIdentity,
} from "../UserInvitationService.js";
import { AuthService } from "../AuthService.js";
import { resetSigninDirectoryService } from "../SigninDirectoryService.js";
import { resetSigninDirectoryRepository } from "../../repositories/SigninDirectoryRepository.js";
import { USER_ACCOUNT_CODES } from "../../constants/userAccountCodes.js";
import { IDENTITY_ALREADY_LINKED } from "../../utils/errors.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const NOW = "2026-10-08T12:00:00.000Z";
const LATER = "2026-10-08T12:01:00.000Z";

let db: Database.Database;
let shopWritable = true;
let tokenSeq = 0;
let service: UserInvitationService;

const GOOGLE: JoinGoogleIdentity = {
  sub: "sub-rami",
  email: "Rami@Gmail.com",
  emailVerified: true,
};

beforeEach(() => {
  resetSigninDirectoryService();
  resetSigninDirectoryRepository();
  shopWritable = true;
  tokenSeq = 0;
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (2, 'Corner Tech', 'cornertech', 'active'),
      (3, 'Rami Phones', 'ramiphones', 'active');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'x', 'admin', 1, 'owner@gmail.com', '${NOW}'),
      (30, 3, 'owner', 'x', 'admin', 1, NULL, NULL);
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  service = new UserInvitationService(
    getUserInvitationRepository(),
    getUserRepository(),
    getEmailOutboxRepository(),
    getTenantRepository(),
    () => `invite-token-${++tokenSeq}`,
    () => shopWritable,
  );
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

/** Invites rami@gmail.com into shop 2 as staff; returns the raw token. */
function invite(email = "rami@gmail.com", role: "admin" | "staff" = "staff"): string {
  runWithTenant(2, () =>
    service.create({
      tenantId: 2,
      email,
      role,
      invitedByUserId: 20,
      now: NOW,
      emailConfigured: true,
      supportEmail: "help@liratek.shop",
      resolveLinkBase: () => "https://cornertech.liratek.test",
      ttlHours: 72,
    }),
  );
  return `invite-token-${tokenSeq}`;
}

const accept = (token: string, over: Partial<JoinGoogleIdentity> = {}, username = "rami") =>
  runWithTenant(2, () =>
    service.acceptWithGoogle({
      token,
      username,
      google: { ...GOOGLE, ...over },
      now: LATER,
      requiredTenantId: 2,
    }),
  );

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const stillUsable = (token: string) =>
  runWithTenant(2, () => service.check(token, LATER, 2)) !== null;

const usersNamed = (username: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE username = ?`).get(username) as { n: number }).n;

describe("prepareJoinWithGoogle", () => {
  it("returns the invite's shop for a usable link and a free username", () => {
    const token = invite();
    expect(
      runWithTenant(2, () =>
        service.prepareJoinWithGoogle({ token, username: " rami ", now: NOW, requiredTenantId: 2 }),
      ),
    ).toEqual({ tenantId: 2 });
  });

  it("null for an unknown or another shop's link; USERNAME_TAKEN; SHOP_NOT_ACTIVE", () => {
    const token = invite();
    const prep = (t: string, username: string, required: number | null = 2) =>
      runWithTenant(2, () =>
        service.prepareJoinWithGoogle({ token: t, username, now: NOW, requiredTenantId: required }),
      );
    expect(prep("nope", "rami")).toBeNull();
    expect(prep(token, "rami", 3)).toBeNull();
    expect(codeOf(() => prep(token, "BOSS"))).toBe(USER_ACCOUNT_CODES.USERNAME_TAKEN);
    shopWritable = false;
    expect(codeOf(() => prep(token, "rami"))).toBe(USER_ACCOUNT_CODES.SHOP_NOT_ACTIVE);
    // Nothing was claimed by any of it.
    shopWritable = true;
    expect(stillUsable(token)).toBe(true);
  });
});

describe("acceptWithGoogle", () => {
  it("matching email (any case): creates the user with the invited role and chosen username, email confirmed, Google linked, invite used, directory synced", () => {
    const token = invite("rami@gmail.com", "staff");
    const outcome = accept(token);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.user).toEqual({ id: outcome.user.id, username: "rami", role: "staff" });
    expect(outcome.shop).toEqual({ id: 2, name: "Corner Tech", slug: "cornertech" });

    const user = db
      .prepare(`SELECT tenant_id, role, is_active, email, email_verified_at, password_hash FROM users WHERE id = ?`)
      .get(outcome.user.id) as Record<string, unknown>;
    expect(user).toMatchObject({
      tenant_id: 2,
      role: "staff",
      is_active: 1,
      email: "rami@gmail.com",
      email_verified_at: LATER,
    });
    // An unusable random hash: never empty, never the empty password.
    expect(typeof user.password_hash).toBe("string");
    expect(String(user.password_hash).length).toBeGreaterThan(20);

    const link = db
      .prepare(`SELECT tenant_id, subject, email FROM user_identities WHERE user_id = ?`)
      .get(outcome.user.id);
    expect(link).toEqual({ tenant_id: 2, subject: "sub-rami", email: "rami@gmail.com" });

    expect(stillUsable(token)).toBe(false);
    expect(
      db.prepare(`SELECT used_by_user_id FROM user_invitations`).get(),
    ).toEqual({ used_by_user_id: outcome.user.id });

    expect(
      db
        .prepare(`SELECT kind, value FROM signin_directory WHERE target_user_id = ? ORDER BY kind`)
        .all(outcome.user.id),
    ).toEqual([
      { kind: "email", value: "rami@gmail.com" },
      { kind: "google", value: "sub-rami" },
    ]);
  });

  it("a Google-only member cannot sign in with a password (no password was ever chosen)", async () => {
    const token = invite();
    expect(accept(token).ok).toBe(true);
    const auth = new AuthService();
    for (const guess of ["", "x", "Str0ng-Password!"]) {
      const result = await runWithTenant(2, () => auth.login("rami", guess, { realm: 2 }));
      expect(result.success).toBe(false);
    }
  });

  it("an account linked in ANOTHER shop joins fine (one user per shop)", () => {
    db.exec(
      `INSERT INTO user_identities (user_id, tenant_id, provider, subject, email) VALUES (30, 3, 'google', 'sub-rami', 'rami@gmail.com')`,
    );
    expect(accept(invite()).ok).toBe(true);
  });

  it.each([
    ["a different Google email", { email: "someone@gmail.com" }],
    ["an unverified Google email", { emailVerified: false }],
  ])("refuses %s with GOOGLE_EMAIL_MISMATCH; nothing created; the invite stays usable", (_label, over) => {
    const token = invite();
    expect(codeOf(() => accept(token, over))).toBe(USER_ACCOUNT_CODES.GOOGLE_EMAIL_MISMATCH);
    expect(usersNamed("rami")).toBe(0);
    expect(stillUsable(token)).toBe(true);
  });

  it("refuses an account already linked to another user of THIS shop; nothing created; the invite stays usable", () => {
    db.exec(
      `INSERT INTO user_identities (user_id, tenant_id, provider, subject, email) VALUES (20, 2, 'google', 'sub-rami', 'owner@gmail.com')`,
    );
    const token = invite();
    expect(codeOf(() => accept(token))).toBe(IDENTITY_ALREADY_LINKED);
    expect(usersNamed("rami")).toBe(0);
    expect(stillUsable(token)).toBe(true);
  });

  it("refuses a taken username; the invite stays usable", () => {
    const token = invite();
    expect(codeOf(() => accept(token, {}, "Boss"))).toBe(USER_ACCOUNT_CODES.USERNAME_TAKEN);
    expect(stillUsable(token)).toBe(true);
  });

  it("refuses a lapsed shop; nothing created; the invite stays usable", () => {
    const token = invite();
    shopWritable = false;
    expect(codeOf(() => accept(token))).toBe(USER_ACCOUNT_CODES.SHOP_NOT_ACTIVE);
    expect(usersNamed("rami")).toBe(0);
    shopWritable = true;
    expect(stillUsable(token)).toBe(true);
  });

  it("an unusable link (unknown, used, revoked, another shop's) is { ok: false }", () => {
    expect(accept("unknown-token")).toEqual({ ok: false });

    const used = invite();
    expect(accept(used).ok).toBe(true);
    expect(accept(used, { sub: "sub-other" }, "rami2")).toEqual({ ok: false });

    const revoked = invite("sara@gmail.com");
    const id = (db.prepare(`SELECT id FROM user_invitations WHERE email = 'sara@gmail.com'`).get() as { id: number }).id;
    runWithTenant(2, () => service.revoke(id, NOW));
    expect(accept(revoked, { email: "sara@gmail.com", sub: "sub-sara" }, "sara")).toEqual({ ok: false });

    const other = invite("lina@gmail.com");
    expect(
      runWithTenant(2, () =>
        service.acceptWithGoogle({
          token: other,
          username: "lina",
          google: { sub: "sub-lina", email: "lina@gmail.com", emailVerified: true },
          now: LATER,
          requiredTenantId: 3,
        }),
      ),
    ).toEqual({ ok: false });
    expect(stillUsable(other)).toBe(true);
  });
});
