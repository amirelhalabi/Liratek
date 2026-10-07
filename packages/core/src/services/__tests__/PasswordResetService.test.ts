/**
 * PasswordResetService (LIRA-275/276) over a REAL in-memory database built
 * from create_db.sql + migrations: the token, user, session, outbox and
 * tenant repositories all run for real. Only the token generator is
 * injected, so the emailed link is predictable.
 *
 * What must hold:
 *   - mail goes ONLY to an active user's VERIFIED email in that shop;
 *   - at most 3 links per user per hour, and a new link kills older ones;
 *   - token + outbox row are written together, the link points at the shop;
 *   - a reset is single use, refuses another shop's host without burning
 *     the link, validates the password BEFORE consuming, and revokes every
 *     session of that user (and only that user);
 *   - a failing password write leaves the link usable (one transaction).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { hashToken, verifyPassword } from "../../utils/crypto.js";
import { isAppError } from "../../utils/errors.js";
import {
  PasswordResetService,
  type PasswordResetMailOptions,
} from "../PasswordResetService.js";
import { UserRepository } from "../../repositories/UserRepository.js";
import { PASSWORD_RESET_CODES } from "../../constants/passwordReset.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-07T10:00:00.000Z";
const MIN = 60 * 1000;
const plus = (iso: string, ms: number): string =>
  new Date(Date.parse(iso) + ms).toISOString();
const GOOD_PASSWORD = "N3w!Passw0rd";

let db: Database.Database;
let tokenSeq: number;
let service: PasswordResetService;

function mail(now = T0): PasswordResetMailOptions {
  return {
    now,
    linkBaseUrl: (slug: string) => `https://${slug}.liratek.test`,
    emailConfigured: true,
    supportEmail: "help@liratek.test",
    ttlMinutes: 60,
  };
}

function rows<T>(sql: string, ...args: unknown[]): T[] {
  return db.prepare(sql).all(...args) as T[];
}
const tokens = () =>
  rows<{
    id: number;
    tenant_id: number;
    user_id: number;
    token_hash: string;
    expires_at: string;
    used_at: string | null;
    requested_ip_hash: string | null;
    email_outbox_id: number | null;
  }>(`SELECT * FROM password_reset_tokens ORDER BY id`);
const outbox = () =>
  rows<{
    id: number;
    idempotency_key: string;
    template: string;
    to_email: string;
    data_json: string;
    give_up_at: string;
  }>(`SELECT * FROM email_outbox ORDER BY id`);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return isAppError(error) ? error.code : `non-app: ${String(error)}`;
  }
  return undefined;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (2, 'Cell City', 'cellcity', 'active'),
      (3, 'Other Shop', 'other', 'active');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'old', 'admin', 1, 'boss@shop.com', '2026-10-01T00:00:00.000Z'),
      (21, 2, 'cashier', 'old', 'staff', 1, 'cashier@shop.com', NULL),
      (22, 2, 'nomail', 'old', 'staff', 1, NULL, NULL),
      (23, 2, 'gone', 'old', 'staff', 0, 'gone@shop.com', '2026-10-01T00:00:00.000Z'),
      (30, 3, 'boss', 'old', 'admin', 1, 'boss@shop.com', '2026-10-01T00:00:00.000Z');
    INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES
      (2, 20, 's-boss-1', '2099-01-01'), (2, 20, 's-boss-2', '2099-01-01'),
      (2, 21, 's-cashier', '2099-01-01'), (3, 30, 's-other-boss', '2099-01-01');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  tokenSeq = 0;
  service = new PasswordResetService({
    newToken: () => `tok-${++tokenSeq}`,
  });
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function request(email: string, now = T0, tenantId = 2) {
  return service.requestByEmail({
    ...mail(now),
    tenantId,
    email,
    requesterIp: "203.0.113.9",
  });
}

describe("requestByEmail (POST /forgot)", () => {
  it("queues a link for an active user's VERIFIED email, token and outbox linked", () => {
    expect(request("Boss@Shop.com ")).toEqual({ queued: true, reason: "queued" });

    const [token] = tokens();
    expect(token).toMatchObject({
      tenant_id: 2,
      user_id: 20,
      token_hash: hashToken("tok-1"),
      expires_at: plus(T0, 60 * MIN),
      used_at: null,
      requested_ip_hash: hashToken("203.0.113.9"),
    });
    const [row] = outbox();
    expect(token!.email_outbox_id).toBe(row!.id);
    expect(row).toMatchObject({
      template: "password-reset",
      to_email: "boss@shop.com",
      idempotency_key: `password-reset:2:${token!.id}`,
      give_up_at: plus(T0, 60 * MIN),
    });
    expect(JSON.parse(row!.data_json)).toEqual({
      resetUrl: "https://cellcity.liratek.test/#/reset-password?token=tok-1",
      username: "boss",
      shopName: "Cell City",
      expiresAtText: "7 October 2026, 11:00 UTC",
      supportEmail: "help@liratek.test",
    });
  });

  it("sends nothing to an UNVERIFIED email", () => {
    expect(request("cashier@shop.com").reason).toBe("not_verified");
    expect(tokens()).toHaveLength(0);
    expect(outbox()).toHaveLength(0);
  });

  it("sends nothing for an unknown email or an inactive user", () => {
    expect(request("nobody@shop.com").reason).toBe("no_account");
    expect(request("gone@shop.com").reason).toBe("no_account");
    expect(tokens()).toHaveLength(0);
  });

  it("only looks in the requested shop", () => {
    request("boss@shop.com", T0, 3);
    expect(tokens().map((t) => [t.tenant_id, t.user_id])).toEqual([[3, 30]]);
  });

  it("sends at most 3 per user per hour, then silently stops", () => {
    for (let i = 0; i < 3; i++) {
      expect(request("boss@shop.com", plus(T0, i * MIN)).queued).toBe(true);
    }
    expect(request("boss@shop.com", plus(T0, 10 * MIN)).reason).toBe(
      "user_limit",
    );
    expect(tokens()).toHaveLength(3);
    // An hour after the first, the window has room again.
    expect(request("boss@shop.com", plus(T0, 61 * MIN)).queued).toBe(true);
  });

  it("a new link invalidates the older ones", () => {
    request("boss@shop.com", T0);
    request("boss@shop.com", plus(T0, MIN));
    const [older, newer] = tokens();
    expect(older!.used_at).toBe(plus(T0, MIN));
    expect(newer!.used_at).toBeNull();
  });

  it("refuses to send without a transport or a link base", () => {
    const off = service.requestByEmail({
      ...mail(),
      emailConfigured: false,
      tenantId: 2,
      email: "boss@shop.com",
    });
    expect(off.reason).toBe("not_configured");
    const noBase = service.requestByEmail({
      ...mail(),
      linkBaseUrl: () => null,
      tenantId: 2,
      email: "boss@shop.com",
    });
    expect(noBase.reason).toBe("not_configured");
    expect(tokens()).toHaveLength(0);
    expect(outbox()).toHaveLength(0);
  });
});

describe("sendForUser (POST /send/:userId)", () => {
  const send = (userId: number, over: Partial<ReturnType<typeof mail>> = {}) =>
    service.sendForUser({ ...mail(), ...over, tenantId: 2, userId });

  it("sends to the user's verified email", () => {
    expect(send(20)).toEqual({ sent: true });
    expect(outbox()[0]!.to_email).toBe("boss@shop.com");
    expect(tokens()[0]!.requested_ip_hash).toBeNull();
  });

  it("refuses with a clear code for each reason", () => {
    expect(codeOf(() => send(30))).toBe(PASSWORD_RESET_CODES.NOT_FOUND); // other shop
    expect(codeOf(() => send(23))).toBe(PASSWORD_RESET_CODES.NOT_FOUND); // inactive
    expect(codeOf(() => send(999))).toBe(PASSWORD_RESET_CODES.NOT_FOUND);
    expect(codeOf(() => send(22))).toBe(PASSWORD_RESET_CODES.USER_HAS_NO_EMAIL);
    expect(codeOf(() => send(21))).toBe(PASSWORD_RESET_CODES.EMAIL_NOT_VERIFIED);
    expect(codeOf(() => send(20, { emailConfigured: false }))).toBe(
      PASSWORD_RESET_CODES.EMAIL_NOT_CONFIGURED,
    );
    expect(codeOf(() => send(20, { linkBaseUrl: () => null }))).toBe(
      PASSWORD_RESET_CODES.EMAIL_NOT_CONFIGURED,
    );
    expect(tokens()).toHaveLength(0);
  });

  it("shares the 3-per-hour limit with the forgot form", () => {
    request("boss@shop.com");
    request("boss@shop.com");
    expect(send(20)).toEqual({ sent: true });
    expect(codeOf(() => send(20))).toBe(PASSWORD_RESET_CODES.RATE_LIMITED);
  });
});

describe("check (POST /check)", () => {
  it("shows the username and shop name for a usable link", () => {
    request("boss@shop.com");
    expect(service.check("tok-1", T0, 2)).toEqual({
      username: "boss",
      shopName: "Cell City",
    });
    // No host shop (www / tenancy off): allowed.
    expect(service.check("tok-1", T0, null)).not.toBeNull();
  });

  it("refuses an unknown, expired or other-shop link", () => {
    request("boss@shop.com");
    expect(service.check("nope", T0, 2)).toBeNull();
    expect(service.check("tok-1", plus(T0, 61 * MIN), 2)).toBeNull();
    expect(service.check("tok-1", T0, 3)).toBeNull();
  });
});

describe("reset (POST /reset)", () => {
  const sessionsOf = (userId: number) =>
    rows<{ token: string }>(`SELECT token FROM sessions WHERE user_id = ?`, userId);
  const hashOf = (userId: number) =>
    rows<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = ?`,
      userId,
    )[0]!.password_hash;

  it("sets the password, burns the link and every other one, revokes all the user's sessions", () => {
    request("boss@shop.com", T0);
    request("boss@shop.com", plus(T0, MIN)); // tok-2; tok-1 already dead

    const done = service.reset("tok-2", GOOD_PASSWORD, plus(T0, 2 * MIN), 2);
    expect(done).toEqual({
      userId: 20,
      username: "boss",
      role: "admin",
      tenantId: 2,
      tenantSlug: "cellcity",
      sessionsRevoked: 2,
    });
    expect(verifyPassword(GOOD_PASSWORD, hashOf(20))).toBe(true);
    expect(tokens().every((t) => t.used_at !== null)).toBe(true);
    expect(sessionsOf(20)).toEqual([]);
    // Nobody else is signed out — not in this shop, not in the other.
    expect(sessionsOf(21)).toHaveLength(1);
    expect(sessionsOf(30)).toHaveLength(1);
    expect(hashOf(30)).toBe("old");
  });

  it("works exactly once", () => {
    request("boss@shop.com");
    expect(service.reset("tok-1", GOOD_PASSWORD, T0, 2)).not.toBeNull();
    expect(service.reset("tok-1", "An0ther!Pass", T0, 2)).toBeNull();
    expect(verifyPassword(GOOD_PASSWORD, hashOf(20))).toBe(true);
  });

  it("refuses another shop's host WITHOUT burning the link", () => {
    request("boss@shop.com");
    expect(service.reset("tok-1", GOOD_PASSWORD, T0, 3)).toBeNull();
    expect(tokens()[0]!.used_at).toBeNull();
    expect(hashOf(20)).toBe("old");
    expect(service.reset("tok-1", GOOD_PASSWORD, T0, 2)).not.toBeNull();
  });

  it("validates the password BEFORE consuming the link", () => {
    request("boss@shop.com");
    expect(codeOf(() => service.reset("tok-1", "weak", T0, 2))).toBe(
      "VALIDATION_ERROR",
    );
    expect(tokens()[0]!.used_at).toBeNull();
  });

  it("refuses an expired link and a user deactivated since the link was sent", () => {
    request("boss@shop.com");
    expect(service.reset("tok-1", GOOD_PASSWORD, plus(T0, 61 * MIN), 2)).toBeNull();
    db.prepare(`UPDATE users SET is_active = 0 WHERE id = 20`).run();
    expect(service.reset("tok-1", GOOD_PASSWORD, T0, 2)).toBeNull();
    expect(hashOf(20)).toBe("old");
  });

  it("leaves the link usable when the password write fails (one transaction)", () => {
    request("boss@shop.com");
    const failingUsers = new UserRepository();
    failingUsers.updatePassword = () => {
      throw new Error("disk full");
    };
    const failing = new PasswordResetService({ userRepo: failingUsers });
    expect(() => failing.reset("tok-1", GOOD_PASSWORD, T0, 2)).toThrow(
      "disk full",
    );
    expect(tokens()[0]!.used_at).toBeNull();
    expect(sessionsOf(20)).toHaveLength(2);
    expect(service.reset("tok-1", GOOD_PASSWORD, T0, 2)).not.toBeNull();
  });
});
