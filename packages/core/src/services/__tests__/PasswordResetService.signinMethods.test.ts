/**
 * PasswordResetService — sign-in methods (LIRA-291), over a REAL in-memory
 * database (create_db.sql + migrations).
 *
 *   setInitialPassword: a signed-in user with NO password (joined with
 *     Google) adds one without a current password. Refused when they already
 *     have one (PASSWORD_ALREADY_SET). Keeps Google and every session. Queues
 *     a `password-added` notice only to a confirmed email, only when email is
 *     on.
 *   set mode (T015): a reset link for a user with no password is sent with
 *     the `password-set` template ("Set a password for <username>"); same
 *     token, page and expiry. Completing it keeps Google (FR-009).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { verifyPassword } from "../../utils/crypto.js";
import { isAppError } from "../../utils/errors.js";
import { validatePasswordComplexity } from "../../utils/passwordPolicy.js";
import { PasswordResetService } from "../PasswordResetService.js";
import {
  PASSWORD_ADDED_TEMPLATE,
  PASSWORD_RESET_CODES,
  PASSWORD_SET_TEMPLATE,
} from "../../constants/passwordReset.js";
import {
  PASSWORD_RESET_TEMPLATE,
  PASSWORD_RESET_URL_KEY,
  type PasswordResetMailOptions,
} from "../PasswordResetService.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-08T10:00:00.000Z";
const CHROME_PASSWORD = "xY7-pq_Rt.9mZ";
const VERIFIED = "2026-10-01T00:00:00.000Z";

let db: Database.Database;
let tokenSeq: number;
let service: PasswordResetService;

function rows<T>(sql: string, ...args: unknown[]): T[] {
  return db.prepare(sql).all(...args) as T[];
}
const outbox = () =>
  rows<{ template: string; to_email: string; data_json: string }>(
    `SELECT template, to_email, data_json FROM email_outbox ORDER BY id`,
  );
const flagOf = (id: number) =>
  rows<{ has_password: number }>(`SELECT has_password FROM users WHERE id = ?`, id)[0]!
    .has_password;
const hashOf = (id: number) =>
  rows<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, id)[0]!
    .password_hash;
const identities = (id: number) =>
  rows<{ subject: string }>(`SELECT subject FROM user_identities WHERE user_id = ?`, id);
const sessions = (id: number) =>
  rows<{ token: string }>(`SELECT token FROM sessions WHERE user_id = ?`, id);

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
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at, has_password) VALUES
      (20, 2, 'boss', 'old', 'admin', 1, 'boss@shop.com', '${VERIFIED}', 1),
      (21, 2, 'rami', 'random', 'staff', 1, 'rami@gmail.com', '${VERIFIED}', 0),
      (22, 2, 'nomail', 'random', 'staff', 1, NULL, NULL, 0),
      (23, 2, 'unconfirmed', 'random', 'staff', 1, 'u@gmail.com', NULL, 0);
    INSERT INTO user_identities (user_id, tenant_id, provider, subject, email) VALUES
      (21, 2, 'google', 'sub-rami', 'rami@gmail.com');
    INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES
      (2, 21, 's-rami', '2099-01-01');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  tokenSeq = 0;
  service = new PasswordResetService({ newToken: () => `tok-${++tokenSeq}` });
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

const setInitial = (userId: number, password = CHROME_PASSWORD, emailConfigured = true) =>
  service.setInitialPassword({
    tenantId: 2,
    userId,
    password,
    now: T0,
    emailConfigured,
    supportEmail: "help@liratek.test",
  });

describe("setInitialPassword (POST /set-initial)", () => {
  it("sets the password, marks has_password, keeps Google and sessions, queues one password-added notice", () => {
    expect(setInitial(21)).toEqual({ hasPassword: true, noticeSent: true });
    expect(verifyPassword(CHROME_PASSWORD, hashOf(21))).toBe(true);
    expect(flagOf(21)).toBe(1);
    expect(identities(21)).toEqual([{ subject: "sub-rami" }]);
    expect(sessions(21)).toHaveLength(1);

    const mails = outbox();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.template).toBe(PASSWORD_ADDED_TEMPLATE);
    expect(mails[0]!.to_email).toBe("rami@gmail.com");
    expect(JSON.parse(mails[0]!.data_json)).toEqual({
      username: "rami",
      shopName: "Corner Tech",
      supportEmail: "help@liratek.test",
    });
  });

  it("refuses PASSWORD_ALREADY_SET for a user who has a password; nothing changes", () => {
    expect(codeOf(() => setInitial(20))).toBe(
      PASSWORD_RESET_CODES.PASSWORD_ALREADY_SET,
    );
    expect(hashOf(20)).toBe("old");
    expect(outbox()).toEqual([]);
  });

  it("refuses a weak password with the policy's own messages; nothing changes", () => {
    let caught: unknown;
    try {
      setInitial(21, "Abcdefg1");
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught) && caught.code).toBe("VALIDATION_ERROR");
    expect((caught as Error).message).toBe(
      validatePasswordComplexity("Abcdefg1").errors.join(", "),
    );
    expect(flagOf(21)).toBe(0);
  });

  it("sends no notice when email is off, or to no / an unconfirmed email — the password is still set", () => {
    expect(setInitial(21, CHROME_PASSWORD, false)).toEqual({
      hasPassword: true,
      noticeSent: false,
    });
    expect(setInitial(22)).toEqual({ hasPassword: true, noticeSent: false });
    expect(setInitial(23)).toEqual({ hasPassword: true, noticeSent: false });
    expect(outbox()).toEqual([]);
    expect([flagOf(21), flagOf(22), flagOf(23)]).toEqual([1, 1, 1]);
  });

  it("refuses NOT_FOUND for another shop's user or an unknown id", () => {
    expect(codeOf(() => setInitial(999))).toBe(PASSWORD_RESET_CODES.NOT_FOUND);
  });
});

function mail(): PasswordResetMailOptions {
  return {
    now: T0,
    linkBaseUrl: (slug: string) => `https://${slug}.liratek.test`,
    emailConfigured: true,
    supportEmail: "help@liratek.test",
    ttlMinutes: 60,
  };
}

describe("set mode: the link's template follows has_password", () => {
  const last = () => outbox()[outbox().length - 1]!;

  it("forgot password for a user with NO password sends password-set, with the same data keys", () => {
    expect(
      service.requestByEmail({ ...mail(), tenantId: 2, email: "rami@gmail.com" }),
    ).toEqual({ queued: true, reason: "queued" });
    expect(last().template).toBe(PASSWORD_SET_TEMPLATE);
    expect(Object.keys(JSON.parse(last().data_json)).sort()).toEqual(
      [PASSWORD_RESET_URL_KEY, "username", "shopName", "expiresAtText", "supportEmail"].sort(),
    );
    expect(JSON.parse(last().data_json).username).toBe("rami");
  });

  it("forgot password for a user WITH a password still sends password-reset", () => {
    service.requestByEmail({ ...mail(), tenantId: 2, email: "boss@shop.com" });
    expect(last().template).toBe(PASSWORD_RESET_TEMPLATE);
  });

  it("the admin's send uses the same rule", () => {
    expect(service.sendForUser({ ...mail(), tenantId: 2, userId: 21 })).toEqual({ sent: true });
    expect(last().template).toBe(PASSWORD_SET_TEMPLATE);
    service.sendForUser({ ...mail(), tenantId: 2, userId: 20 });
    expect(last().template).toBe(PASSWORD_RESET_TEMPLATE);
  });

  it("completing a set link sets the password and KEEPS Google (FR-009)", () => {
    service.sendForUser({ ...mail(), tenantId: 2, userId: 21 });
    const done = service.reset("tok-1", CHROME_PASSWORD, T0, 2);
    expect(done?.userId).toBe(21);
    expect(verifyPassword(CHROME_PASSWORD, hashOf(21))).toBe(true);
    expect(flagOf(21)).toBe(1);
    expect(identities(21)).toEqual([{ subject: "sub-rami" }]);
  });
});

describe("check() reports hasPassword (LIRA-291, the page's wording)", () => {
  it("false for a user with no password, true otherwise", () => {
    service.sendForUser({ ...mail(), tenantId: 2, userId: 21 });
    expect(service.check("tok-1", T0, 2)).toEqual({
      username: "rami",
      shopName: "Corner Tech",
      hasPassword: false,
    });
    service.sendForUser({ ...mail(), tenantId: 2, userId: 20 });
    expect(service.check("tok-2", T0, 2)?.hasPassword).toBe(true);
  });
});

