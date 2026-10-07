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
     UPDATE users SET email = NULL, email_verified_at = NULL;`,
  );
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
