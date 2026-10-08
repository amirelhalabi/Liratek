/**
 * SigninCodeService (LIRA-287) — "email me a code" on www, then "your shops".
 *
 * Real in-memory database from create_db.sql: the code table, the outbox,
 * users and tenants all run for real. The code generator is injected so the
 * test knows the code without reading it back out of the outbox.
 *
 * Guards:
 *   - a code is mailed ONLY when the email is a VERIFIED, ACTIVE user of an
 *     ACTIVE shop; every other case is a silent no (the route answers all
 *     of them identically);
 *   - only the hash is stored; the outbox row carries the code under the
 *     template's secret key and is written with the code row;
 *   - a new code supersedes older ones; per-email limit;
 *   - verify: wrong code counts an attempt, 5 attempts lock the code, expiry,
 *     single use, the shops list is only returned for a valid code.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runWithoutTenant } from "../../db/tenantContext.js";
import { SigninDirectoryService } from "../SigninDirectoryService.js";
import {
  SigninCodeService,
  SIGNIN_CODE_TEMPLATE,
} from "../SigninCodeService.js";
import {
  SIGNIN_CODE_MAX_ATTEMPTS,
  SIGNIN_CODE_PER_EMAIL_LIMIT,
  SIGNIN_CODE_SECRET_KEY,
} from "../../constants/signinCode.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const NOW_MS = Date.parse("2026-10-07T10:00:00.000Z");
const at = (minutes: number) =>
  new Date(NOW_MS + minutes * 60_000).toISOString();
const NOW = at(0);

let db: Database.Database;
let nextCode = "123456";

function svc() {
  return new SigninCodeService({ newCode: () => nextCode });
}

function mail(now = NOW) {
  return { now, emailConfigured: true, supportEmail: "help@liratek.test" };
}

beforeEach(() => {
  nextCode = "123456";
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (2, 'Corner Tech', 'cornertech', 'active'),
      (3, 'Beta Shop', 'beta', 'active'),
      (4, 'Gone Shop', 'gone', 'suspended');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'x', 'admin', 1, 'owner@gmail.com', '2026-10-01T00:00:00.000Z'),
      (21, 2, 'cashier', 'x', 'staff', 1, 'cashier@gmail.com', NULL),
      (22, 2, 'retired', 'x', 'staff', 0, 'retired@gmail.com', '2026-10-01T00:00:00.000Z'),
      (30, 3, 'owner3', 'x', 'admin', 1, 'owner@gmail.com', '2026-10-01T00:00:00.000Z'),
      (40, 4, 'boss4', 'x', 'admin', 1, 'owner@gmail.com', '2026-10-01T00:00:00.000Z'),
      (41, 4, 'only4', 'x', 'admin', 1, 'only4@gmail.com', '2026-10-01T00:00:00.000Z');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  // LIRA-288: www reads the sign-in directory, which the app keeps in step
  // with the users above; seeded raw here, so it is built once.
  new SigninDirectoryService().rebuildAll(NOW);
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const outbox = () =>
  db.prepare(`SELECT * FROM email_outbox ORDER BY id`).all() as {
    idempotency_key: string;
    template: string;
    to_email: string;
    data_json: string;
    give_up_at: string;
  }[];

describe("requestCode", () => {
  it("mails a code to a verified active user, storing only its hash", () => {
    const result = runWithoutTenant(() =>
      svc().requestCode({ ...mail(), email: " Owner@Gmail.com " }),
    );
    expect(result).toEqual({ queued: true, reason: "queued" });

    const rows = db.prepare(`SELECT * FROM signin_codes`).all() as {
      id: number;
      email: string;
      code_hash: string;
      expires_at: string;
      attempts: number;
      email_outbox_id: number | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("owner@gmail.com");
    expect(rows[0]!.code_hash).not.toContain("123456");
    expect(rows[0]!.expires_at).toBe(at(10));
    expect(rows[0]!.attempts).toBe(0);

    const [sent] = outbox();
    expect(sent!.template).toBe(SIGNIN_CODE_TEMPLATE);
    expect(sent!.to_email).toBe("owner@gmail.com");
    expect(sent!.idempotency_key).toBe(`signin-code:${rows[0]!.id}`);
    expect(sent!.give_up_at).toBe(at(10));
    expect(JSON.parse(sent!.data_json)[SIGNIN_CODE_SECRET_KEY]).toBe("123456");
    expect(rows[0]!.email_outbox_id).not.toBeNull();
  });

  it.each([
    ["an unknown email", "nobody@gmail.com"],
    ["an unverified email", "cashier@gmail.com"],
    ["a deactivated user", "retired@gmail.com"],
    ["a user of a suspended shop only", "only4@gmail.com"],
  ])("sends nothing for %s", (_label, email) => {
    const result = runWithoutTenant(() =>
      svc().requestCode({ ...mail(), email }),
    );
    expect(result).toEqual({ queued: false, reason: "no_account" });
    expect(count(`SELECT COUNT(*) AS n FROM signin_codes`)).toBe(0);
    expect(outbox()).toHaveLength(0);
  });

  it("LIRA-288: reads the sign-in directory only — a confirmed user not (yet) in it gets no code and is not listed", () => {
    // Written straight to the shop records, never synced: www must not see
    // it (in per-tenant mode it would live in another file entirely).
    db.exec(`
      INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at)
      VALUES (31, 3, 'unsynced', 'x', 'staff', 1, 'unsynced@gmail.com', '2026-10-01T00:00:00.000Z')
    `);
    expect(
      runWithoutTenant(() => svc().requestCode({ ...mail(), email: "unsynced@gmail.com" })),
    ).toEqual({ queued: false, reason: "no_account" });
    // And a directory row alone is enough (the shop records are not re-read).
    db.exec(
      `INSERT INTO signin_directory (kind, value, target_tenant_id, target_user_id, username, display_email, created_at, updated_at)
       VALUES ('email', 'unsynced@gmail.com', 3, 31, 'unsynced', NULL, '${NOW}', '${NOW}')`,
    );
    db.exec(`UPDATE users SET email_verified_at = NULL WHERE id = 31`);
    expect(
      runWithoutTenant(() => svc().requestCode({ ...mail(), email: "unsynced@gmail.com" })).queued,
    ).toBe(true);
  });

  it("sends nothing when mail is not configured", () => {
    const result = runWithoutTenant(() =>
      svc().requestCode({
        ...mail(),
        emailConfigured: false,
        email: "owner@gmail.com",
      }),
    );
    expect(result.reason).toBe("not_configured");
    expect(outbox()).toHaveLength(0);
  });

  it("limits codes per email per hour", () => {
    for (let i = 0; i < SIGNIN_CODE_PER_EMAIL_LIMIT; i++) {
      expect(
        runWithoutTenant(() =>
          svc().requestCode({ ...mail(at(i)), email: "owner@gmail.com" }),
        ).queued,
      ).toBe(true);
    }
    const over = runWithoutTenant(() =>
      svc().requestCode({ ...mail(at(6)), email: "owner@gmail.com" }),
    );
    expect(over).toEqual({ queued: false, reason: "email_limit" });
    // An hour later it works again.
    expect(
      runWithoutTenant(() =>
        svc().requestCode({ ...mail(at(61)), email: "owner@gmail.com" }),
      ).queued,
    ).toBe(true);
  });
});

describe("verifyCode", () => {
  function request(code = "123456", now = NOW) {
    nextCode = code;
    runWithoutTenant(() =>
      svc().requestCode({ ...mail(now), email: "owner@gmail.com" }),
    );
  }
  const verify = (code: string, now = at(1), email = "owner@gmail.com") =>
    runWithoutTenant(() => svc().verifyCode({ email, code, now }));

  it("a valid code lists every ACTIVE shop where the email is a confirmed user", () => {
    request();
    expect(verify("123456", at(1), "OWNER@gmail.com")).toEqual({
      shops: [
        { slug: "beta", name: "Beta Shop", username: "owner3" },
        { slug: "cornertech", name: "Corner Tech", username: "boss" },
      ],
    });
  });

  it("works once", () => {
    request();
    expect(verify("123456")).not.toBeNull();
    expect(verify("123456")).toBeNull();
  });

  it("refuses an expired code", () => {
    request();
    expect(verify("123456", at(10))).toBeNull();
  });

  it("refuses a code for another email", () => {
    request();
    expect(verify("123456", at(1), "cashier@gmail.com")).toBeNull();
  });

  it(`a wrong code counts an attempt; after ${SIGNIN_CODE_MAX_ATTEMPTS} the code is locked`, () => {
    request();
    for (let i = 0; i < SIGNIN_CODE_MAX_ATTEMPTS; i++) {
      expect(verify("000000")).toBeNull();
    }
    expect(
      count(`SELECT attempts AS n FROM signin_codes`),
    ).toBe(SIGNIN_CODE_MAX_ATTEMPTS);
    // Even the right code no longer works.
    expect(verify("123456")).toBeNull();
  });

  it("a new code supersedes the old one", () => {
    request("111111");
    request("222222", at(1));
    expect(verify("111111", at(2))).toBeNull();
    expect(verify("222222", at(2))).not.toBeNull();
  });

  it("refuses when no code was ever sent", () => {
    expect(verify("123456")).toBeNull();
  });
});
