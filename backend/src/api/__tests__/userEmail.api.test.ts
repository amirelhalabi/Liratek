/**
 * /api/user-email (LIRA-279, feature B — contract B in
 * SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md).
 *
 * Supertest over a REAL in-memory SQLite database built from
 * electron-app/create_db.sql (same harness as userInvitations.api.test.ts).
 * Bodies are parsed through the core schemas first (rule 24).
 */

import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

let emailConfigured = true;
jest.mock("../../email/createTransport.js", () => ({
  isEmailConfigured: () => emailConfigured,
  createTransport: () => {
    throw new Error("not used in this suite");
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const PASSWORD = "Password123!";
const BASE = "/api/user-email";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
const ids: Record<string, number> = {};

async function loginToken(username: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

function count(sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function setBody(input: { email: string | null }) {
  expect(core.setUserEmailSchema.safeParse(input).success).toBe(true);
  return input;
}

function verifyBody(input: { token: string }) {
  expect(core.verifyUserEmailSchema.safeParse(input).success).toBe(true);
  return input;
}

function userEmail(username: string) {
  return db
    .prepare(`SELECT email, email_verified_at FROM users WHERE username = ?`)
    .get(username) as { email: string | null; email_verified_at: string | null };
}

/** The raw token from the newest verify-email to `to`. */
function tokenFromOutbox(to: string): { token: string; url: string; key: string } {
  const row = db
    .prepare(
      `SELECT data_json, idempotency_key FROM email_outbox
        WHERE template = 'verify-email' AND to_email = ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(to) as { data_json: string; idempotency_key: string } | undefined;
  expect(row).toBeDefined();
  const url = (JSON.parse(row!.data_json) as { verifyUrl: string }).verifyUrl;
  const token = new URLSearchParams(new URL(url).hash.split("?")[1] ?? "").get(
    "token",
  )!;
  return { token, url, key: row!.idempotency_key };
}

async function putEmail(adminToken: string, userId: number, email: string | null) {
  return request(app)
    .put(`${BASE}/${userId}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(setBody({ email }));
}

beforeAll(async () => {
  process.env.JWT_SECRET = "user-email-test-secret-0123456789-0123456789-ab";
  process.env.APP_BASE_DOMAIN = "liratek.test";

  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;

  core = await import("@liratek/core");
  db.exec(
    fs.readFileSync(
      path.join(__dirname, "../../../../electron-app/create_db.sql"),
      "utf8",
    ),
  );
  const hash = core.hashPassword(PASSWORD);
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Cell City', 'cellcity', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (3, 'Fone Fix', 'fonefix', 'active')`,
  ).run();
  const insertUser = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, 1)`,
  );
  for (const [tenant, username, role] of [
    [2, "cell_admin", "admin"],
    [2, "cell_staff", "staff"],
    [2, "cell_other", "staff"],
    [3, "fone_admin", "admin"],
    [3, "fone_staff", "staff"],
  ] as const) {
    ids[username] = Number(insertUser.run(tenant, username, hash, role).lastInsertRowid);
  }

  core.resetUserRepository();
  core.resetSessionRepository();
  core.resetAuthService();
  core.resetTenantRepository();
  core.resetAuditRepository();
  core.resetAuditService();
  core.resetEmailOutboxRepository();
  core.resetEmailVerificationTokenRepository();
  core.resetUserEmailService();

  const authRoutes = (await import("../auth")).default;
  const userEmailRoutes = (await import("../userEmail")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/user-email", userEmailRoutes);
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  core.resetTenantContext();
  emailConfigured = true;
  db.exec(
    `DELETE FROM email_verification_tokens; DELETE FROM email_outbox;
     UPDATE users SET email = NULL, email_verified_at = NULL, has_password = 1;
     DELETE FROM password_reset_tokens;
     DELETE FROM user_identities; DELETE FROM signin_directory; DELETE FROM audit_log;`,
  );
});

// ── LIRA-288: an admin sees and disconnects members' Google ──────────────

function linkGoogle(username: string, tenantId: number, subject: string, email: string) {
  db.prepare(
    `INSERT INTO user_identities (user_id, tenant_id, provider, subject, email, created_at, updated_at)
     VALUES (?, ?, 'google', ?, ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  ).run(ids[username], tenantId, subject, email);
  new core.SigninDirectoryService().rebuildAll("2026-10-01T00:00:00.000Z");
}

describe("LIRA-288 GET /api/user-email — Google", () => {
  it("each user carries google: { email } when connected, null otherwise", async () => {
    linkGoogle("cell_staff", 2, "sub-staff", "staff@gmail.com");
    const admin = await loginToken("cell_admin");
    const res = await request(app).get(BASE).set("Authorization", `Bearer ${admin}`);
    const users = res.body.data.users as Array<{ id: number; google: { email: string | null } | null }>;
    expect(users.find((u) => u.id === ids.cell_staff)?.google).toEqual({ email: "staff@gmail.com" });
    expect(users.find((u) => u.id === ids.cell_admin)?.google).toBeNull();
  });
});

describe("LIRA-291 GET /api/user-email — hasPassword", () => {
  it("each user carries hasPassword, for the Users list's Sign-in label", async () => {
    db.prepare(`UPDATE users SET has_password = 0 WHERE id = ?`).run(ids.cell_other);
    const admin = await loginToken("cell_admin");
    const res = await request(app).get(BASE).set("Authorization", `Bearer ${admin}`);
    const users = res.body.data.users as Array<{ id: number; hasPassword: boolean }>;
    expect(users.find((u) => u.id === ids.cell_other)?.hasPassword).toBe(false);
    expect(users.find((u) => u.id === ids.cell_admin)?.hasPassword).toBe(true);
  });
});

describe("LIRA-288 DELETE /api/user-email/:userId/google (admin)", () => {
  it("disconnects a member's Google in this shop only, re-syncs the directory, audits google_link.remove {by: admin}; a repeat changes nothing", async () => {
    linkGoogle("cell_staff", 2, "sub-shared", "staff@gmail.com");
    linkGoogle("fone_staff", 3, "sub-shared", "staff@gmail.com");
    expect(
      count(`SELECT COUNT(*) AS n FROM signin_directory WHERE kind = 'google' AND value = 'sub-shared'`),
    ).toBe(2);

    const admin = await loginToken("cell_admin");
    const res = await request(app)
      .delete(`${BASE}/${ids.cell_staff}/google`)
      .set("Authorization", `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        user: { id: ids.cell_staff, email: null, emailVerifiedAt: null, google: null, hasPassword: true },
      },
    });
    expect(count(`SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?`, ids.cell_staff)).toBe(0);
    // The other shop's link is untouched, in both places.
    expect(count(`SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?`, ids.fone_staff)).toBe(1);
    expect(
      db
        .prepare(`SELECT target_tenant_id AS t FROM signin_directory WHERE kind = 'google' AND value = 'sub-shared'`)
        .all(),
    ).toEqual([{ t: 3 }]);
    const audit = db
      .prepare(`SELECT action, entity_id, metadata FROM audit_log WHERE action = 'google_link.remove'`)
      .all() as Array<{ action: string; entity_id: string; metadata: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.entity_id).toBe(String(ids.cell_staff));
    expect(JSON.parse(audit[0]!.metadata)).toMatchObject({ by: "admin" });

    const again = await request(app)
      .delete(`${BASE}/${ids.cell_staff}/google`)
      .set("Authorization", `Bearer ${admin}`);
    expect(again.body.success).toBe(true);
    expect(count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'google_link.remove'`)).toBe(1);
  });

  it("NOT_FOUND for another shop's user; 403 for staff (even their own); 401 without a token; a bad id is refused", async () => {
    linkGoogle("fone_staff", 3, "sub-fone", "fone@gmail.com");
    linkGoogle("cell_other", 2, "sub-other", "other@gmail.com");
    const admin = await loginToken("cell_admin");
    const other = await request(app)
      .delete(`${BASE}/${ids.fone_staff}/google`)
      .set("Authorization", `Bearer ${admin}`);
    expect(other.body.success).toBe(false);
    expect(other.body.error.code).toBe("NOT_FOUND");
    expect(count(`SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?`, ids.fone_staff)).toBe(1);

    const staff = await loginToken("cell_staff");
    expect(
      (await request(app).delete(`${BASE}/${ids.cell_other}/google`).set("Authorization", `Bearer ${staff}`)).status,
    ).toBe(403);
    expect((await request(app).delete(`${BASE}/${ids.cell_other}/google`)).status).toBe(401);
    expect(count(`SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?`, ids.cell_other)).toBe(1);

    const bad = await request(app).delete(`${BASE}/abc/google`).set("Authorization", `Bearer ${admin}`);
    expect(bad.body.success).toBe(false);
  });
});

// ── LIRA-291: an admin disconnect never strands a user silently ──────────

describe("LIRA-291 DELETE /api/user-email/:userId/google — a user with no password", () => {
  const VERIFIED = "2026-10-01T00:00:00.000Z";
  function googleOnly(username: string, email: string | null, verified: string | null) {
    db.prepare(
      `UPDATE users SET has_password = 0, email = ?, email_verified_at = ? WHERE id = ?`,
    ).run(email, verified, ids[username]);
    linkGoogle(username, 2, `sub-${username}`, email ?? "x@gmail.com");
  }
  const disconnect = (token: string, username: string) =>
    request(app)
      .delete(`${BASE}/${ids[username]}/google`)
      .set("Authorization", `Bearer ${token}`);
  const outbox = () =>
    db.prepare(`SELECT template, to_email FROM email_outbox ORDER BY id`).all();

  it("confirmed email + email on: disconnected, ONE password-set email queued, passwordLink 'sent'", async () => {
    googleOnly("cell_other", "rami@gmail.com", VERIFIED);
    const admin = await loginToken("cell_admin");
    const res = await disconnect(admin, "cell_other");
    expect(res.body.success).toBe(true);
    expect(res.body.data.passwordLink).toBe("sent");
    expect(res.body.data.passwordLinkCode).toBeUndefined();
    expect(count(`SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?`, ids.cell_other)).toBe(0);
    expect(outbox()).toEqual([{ template: core.PASSWORD_SET_TEMPLATE, to_email: "rami@gmail.com" }]);
    const audit = db
      .prepare(`SELECT metadata FROM audit_log WHERE action = 'google_link.remove'`)
      .get() as { metadata: string };
    expect(JSON.parse(audit.metadata)).toEqual({ by: "admin", password_link: "sent" });
  });

  it.each([
    ["email is off", "rami@gmail.com", VERIFIED, false, "EMAIL_NOT_CONFIGURED"],
    ["no email", null, null, true, "USER_HAS_NO_EMAIL"],
    ["an unconfirmed email", "rami@gmail.com", null, true, "EMAIL_NOT_VERIFIED"],
  ] as const)("%s: still disconnected, nothing sent, passwordLink 'not_sent' with the code", async (_l, email, verified, on, code) => {
    googleOnly("cell_other", email, verified);
    emailConfigured = on;
    const admin = await loginToken("cell_admin");
    const res = await disconnect(admin, "cell_other");
    expect(res.body.success).toBe(true);
    expect(res.body.data.passwordLink).toBe("not_sent");
    expect(res.body.data.passwordLinkCode).toBe(code);
    expect(count(`SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?`, ids.cell_other)).toBe(0);
    expect(outbox()).toEqual([]);
  });

  it("a user WITH a password: no email and no passwordLink (unchanged)", async () => {
    db.prepare(`UPDATE users SET email = 'p@gmail.com', email_verified_at = ? WHERE id = ?`).run(
      VERIFIED,
      ids.cell_other,
    );
    linkGoogle("cell_other", 2, "sub-pw", "p@gmail.com");
    const admin = await loginToken("cell_admin");
    const res = await disconnect(admin, "cell_other");
    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toHaveProperty("passwordLink");
    expect(outbox()).toEqual([]);
  });

  it("nothing linked: a harmless repeat sends nothing", async () => {
    db.prepare(`UPDATE users SET has_password = 0, email = 'r@gmail.com', email_verified_at = ? WHERE id = ?`).run(
      VERIFIED,
      ids.cell_other,
    );
    const admin = await loginToken("cell_admin");
    const res = await disconnect(admin, "cell_other");
    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toHaveProperty("passwordLink");
    expect(outbox()).toEqual([]);
  });

  it("an admin with no password cannot disconnect their OWN Google here either (SET_PASSWORD_FIRST); the link is kept", async () => {
    const admin = await loginToken("cell_admin");
    googleOnly("cell_admin", "boss@gmail.com", VERIFIED);
    const res = await disconnect(admin, "cell_admin");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.code ?? res.body.error?.code).toBe(core.SET_PASSWORD_FIRST);
    expect(count(`SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?`, ids.cell_admin)).toBe(1);
    expect(outbox()).toEqual([]);
  });
});

describe("GET /api/user-email", () => {
  it("admin sees this shop's users only; staff 403; no token 401", async () => {
    db.prepare(`UPDATE users SET email = 'a@cell.test', email_verified_at = '2026-10-01T00:00:00.000Z' WHERE username = 'cell_staff'`).run();
    const admin = await loginToken("cell_admin");
    const res = await request(app).get(BASE).set("Authorization", `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const users = res.body.data.users as { id: number; email: string | null; emailVerifiedAt: string | null }[];
    expect(users.map((u) => u.id).sort()).toEqual(
      [ids.cell_admin, ids.cell_staff, ids.cell_other].sort(),
    );
    expect(users.find((u) => u.id === ids.cell_staff)).toEqual({
      id: ids.cell_staff,
      email: "a@cell.test",
      emailVerifiedAt: "2026-10-01T00:00:00.000Z",
      google: null,
      hasPassword: true,
    });

    const staff = await loginToken("cell_staff");
    expect((await request(app).get(BASE).set("Authorization", `Bearer ${staff}`)).status).toBe(403);
    expect((await request(app).get(BASE)).status).toBe(401);
  });
});

describe("PUT /api/user-email/:userId", () => {
  it("saves the address UNVERIFIED and queues a 24-hour verification link to the shop's subdomain", async () => {
    db.prepare(`UPDATE users SET email = 'old@cell.test', email_verified_at = '2026-10-01T00:00:00.000Z' WHERE username = 'cell_staff'`).run();
    const admin = await loginToken("cell_admin");
    const res = await putEmail(admin, ids.cell_staff!, "  New@Cell.TEST ");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { email: "new@cell.test", emailVerifiedAt: null, verificationSent: true },
    });
    expect(userEmail("cell_staff")).toEqual({ email: "new@cell.test", email_verified_at: null });

    const { token, url, key } = tokenFromOutbox("new@cell.test");
    expect(url.startsWith("https://cellcity.liratek.test/#/verify-email?token=")).toBe(true);
    const tokenRow = db
      .prepare(`SELECT id, tenant_id, user_id, email, token_hash, expires_at, created_at FROM email_verification_tokens`)
      .get() as { id: number; tenant_id: number; user_id: number; email: string; token_hash: string; expires_at: string; created_at: string };
    expect(tokenRow).toMatchObject({ tenant_id: 2, user_id: ids.cell_staff, email: "new@cell.test" });
    expect(tokenRow.token_hash).toBe(core.hashToken(token));
    expect(Date.parse(tokenRow.expires_at) - Date.parse(tokenRow.created_at)).toBe(24 * 60 * 60 * 1000);
    expect(key).toBe(`verify-email:2:${tokenRow.id}`);
    const data = JSON.parse(
      (db.prepare(`SELECT data_json FROM email_outbox`).get() as { data_json: string }).data_json,
    ) as Record<string, string>;
    expect(data).toMatchObject({ username: "cell_staff", shopName: "Cell City" });
    expect(JSON.stringify(res.body)).not.toContain(token);

    expect(
      count(`SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = 2 AND entity_type = 'user' AND entity_id = ?`, String(ids.cell_staff)),
    ).toBe(1);
  });

  it("EMAIL_TAKEN_IN_SHOP for another user's address here; NOT_FOUND for another shop's user", async () => {
    db.prepare(`UPDATE users SET email = 'taken@cell.test' WHERE username = 'cell_other'`).run();
    const admin = await loginToken("cell_admin");
    const taken = await putEmail(admin, ids.cell_staff!, "taken@cell.test");
    expect(taken.status).toBe(200);
    expect(taken.body).toMatchObject({ success: false, error: { code: "EMAIL_TAKEN_IN_SHOP" } });

    const foreign = await putEmail(admin, ids.fone_staff!, "x@fone.test");
    expect(foreign.status).toBe(200);
    expect(foreign.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(userEmail("fone_staff").email).toBeNull();
  });

  it("null clears the address and the stamp, and burns the open link", async () => {
    const admin = await loginToken("cell_admin");
    await putEmail(admin, ids.cell_staff!, "c@cell.test");
    const { token } = tokenFromOutbox("c@cell.test");

    const res = await putEmail(admin, ids.cell_staff!, null);
    expect(res.body).toEqual({
      success: true,
      data: { email: null, emailVerifiedAt: null, verificationSent: false },
    });
    expect(userEmail("cell_staff")).toEqual({ email: null, email_verified_at: null });

    const verify = await request(app).post(`${BASE}/verify`).send(verifyBody({ token }));
    expect(verify.body.success).toBe(false);
  });

  it("without a mail transport the address is still saved, verificationSent false", async () => {
    emailConfigured = false;
    const admin = await loginToken("cell_admin");
    const res = await putEmail(admin, ids.cell_staff!, "n@cell.test");
    expect(res.body.data).toEqual({ email: "n@cell.test", emailVerifiedAt: null, verificationSent: false });
    expect(count(`SELECT COUNT(*) AS n FROM email_outbox`)).toBe(0);
  });

  it("a non-numeric id is refused like a validation failure (200 + VALIDATION_ERROR)", async () => {
    const admin = await loginToken("cell_admin");
    const res = await request(app)
      .put(`${BASE}/abc`)
      .set("Authorization", `Bearer ${admin}`)
      .send(setBody({ email: "a@b.co" }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  });
});

describe("POST /api/user-email/:userId/send-verification", () => {
  it("refuses USER_HAS_NO_EMAIL, EMAIL_ALREADY_VERIFIED, EMAIL_NOT_CONFIGURED", async () => {
    const admin = await loginToken("cell_admin");
    const send = (id: number) =>
      request(app).post(`${BASE}/${id}/send-verification`).set("Authorization", `Bearer ${admin}`);

    expect((await send(ids.cell_staff!)).body).toMatchObject({
      success: false,
      error: { code: "USER_HAS_NO_EMAIL" },
    });

    db.prepare(`UPDATE users SET email = 'v@cell.test', email_verified_at = '2026-10-01T00:00:00.000Z' WHERE username = 'cell_staff'`).run();
    expect((await send(ids.cell_staff!)).body).toMatchObject({
      success: false,
      error: { code: "EMAIL_ALREADY_VERIFIED" },
    });

    db.prepare(`UPDATE users SET email_verified_at = NULL WHERE username = 'cell_staff'`).run();
    emailConfigured = false;
    const res = await send(ids.cell_staff!);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, error: { code: "EMAIL_NOT_CONFIGURED" } });
  });

  it("sends {sent:true}; the link issued by PUT counts toward 3 per hour, the 4th is RATE_LIMITED", async () => {
    const admin = await loginToken("cell_admin");
    await putEmail(admin, ids.cell_staff!, "r@cell.test"); // 1
    const send = () =>
      request(app)
        .post(`${BASE}/${ids.cell_staff}/send-verification`)
        .set("Authorization", `Bearer ${admin}`);
    expect((await send()).body).toEqual({ success: true, data: { sent: true } }); // 2
    expect((await send()).body.success).toBe(true); // 3
    const fourth = await send();
    expect(fourth.status).toBe(200);
    expect(fourth.body).toMatchObject({ success: false, error: { code: "RATE_LIMITED" } });
    expect(count(`SELECT COUNT(*) AS n FROM email_verification_tokens`)).toBe(3);
  });
});

describe("POST /api/user-email/verify (public)", () => {
  it("verifies the address the link was sent to; the link then is spent", async () => {
    const admin = await loginToken("cell_admin");
    await putEmail(admin, ids.cell_staff!, "me@cell.test");
    const { token } = tokenFromOutbox("me@cell.test");

    const res = await request(app)
      .post(`${BASE}/verify`)
      .set("Host", "cellcity.liratek.test")
      .send(verifyBody({ token }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { verified: true } });
    expect(userEmail("cell_staff").email_verified_at).not.toBeNull();

    const again = await request(app).post(`${BASE}/verify`).send(verifyBody({ token }));
    expect(again.status).toBe(200);
    expect(again.body.success).toBe(false);
    expect(again.body.error.message).toBe(core.EMAIL_VERIFY_INVALID_MESSAGE);
  });

  it("a link only verifies the address it was sent to", async () => {
    const admin = await loginToken("cell_admin");
    await putEmail(admin, ids.cell_staff!, "first@cell.test");
    const { token } = tokenFromOutbox("first@cell.test");
    // The address changes without going through PUT (so the link is not burned).
    db.prepare(`UPDATE users SET email = 'second@cell.test' WHERE username = 'cell_staff'`).run();

    const res = await request(app).post(`${BASE}/verify`).send(verifyBody({ token }));
    expect(res.body.success).toBe(false);
    expect(userEmail("cell_staff").email_verified_at).toBeNull();
  });

  it("another shop's host gets the generic refusal WITHOUT spending the link", async () => {
    const admin = await loginToken("cell_admin");
    await putEmail(admin, ids.cell_staff!, "h@cell.test");
    const { token } = tokenFromOutbox("h@cell.test");

    const wrong = await request(app)
      .post(`${BASE}/verify`)
      .set("Host", "fonefix.liratek.test")
      .send(verifyBody({ token }));
    expect(wrong.body.success).toBe(false);
    expect(wrong.body.error.message).toBe(core.EMAIL_VERIFY_INVALID_MESSAGE);

    const right = await request(app)
      .post(`${BASE}/verify`)
      .set("Host", "cellcity.liratek.test")
      .send(verifyBody({ token }));
    expect(right.body.success).toBe(true);
  });

  it("an unknown token is the same generic 200 refusal", async () => {
    const res = await request(app).post(`${BASE}/verify`).send(verifyBody({ token: "nope" }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe(core.EMAIL_VERIFY_INVALID_MESSAGE);
  });
});

// ── LIRA-292: a user's OWN email, for My account → Profile ───────────────

describe("LIRA-292 GET /api/user-email/me — my own email", () => {
  it("a STAFF user reads their own email and verified stamp (from the JWT, never a param)", async () => {
    db.prepare(
      `UPDATE users SET email = 'me@cell.test', email_verified_at = '2026-10-01T00:00:00.000Z' WHERE id = ?`,
    ).run(ids.cell_staff);
    db.prepare(`UPDATE users SET email = 'other@cell.test' WHERE id = ?`).run(ids.cell_other);
    const staff = await loginToken("cell_staff");
    const res = await request(app).get(`${BASE}/me`).set("Authorization", `Bearer ${staff}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { email: "me@cell.test", emailVerifiedAt: "2026-10-01T00:00:00.000Z" },
    });
  });

  it("no email yet answers nulls", async () => {
    const staff = await loginToken("cell_other");
    const res = await request(app).get(`${BASE}/me`).set("Authorization", `Bearer ${staff}`);
    expect(res.body).toMatchObject({ success: true, data: { email: null, emailVerifiedAt: null } });
  });

  it("needs a signed-in user", async () => {
    const res = await request(app).get(`${BASE}/me`);
    expect(res.status).toBe(401);
  });
});
