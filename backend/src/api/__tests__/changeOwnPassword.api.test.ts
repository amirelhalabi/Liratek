/**
 * POST /api/password-reset/change — LIRA-293: a signed-in user who HAS a
 * password changes it with their current one.
 *
 * Supertest over a REAL in-memory SQLite database built from create_db.sql:
 * the router, AuthService, PasswordResetService, every repository, the audit
 * writer and the REAL per-user limiter all run. Stubbed: `isEmailConfigured`
 * and `authenticateJWT`, which reads the caller (and the session token the
 * request carries) from test headers and enters the shop scope like the real
 * middleware. Sessions are real `sessions` rows, so "sign out the other
 * devices" is checked against the table itself.
 *
 * Request bodies are parsed through the core schema first (rule 24).
 */

import { jest } from "@jest/globals";
import type { Express, NextFunction, Request, Response } from "express";
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

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
    const role = req.headers["x-test-role"];
    if (typeof role !== "string") {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    const tenantId = Number(req.headers["x-test-tenant"] ?? 2);
    (req as Request & { user?: unknown }).user = {
      userId: Number(req.headers["x-test-user"]),
      username: String(req.headers["x-test-username"] ?? "someone"),
      role,
      tenantId,
      sessionToken: String(req.headers["x-test-session"] ?? "tok-current"),
      ...(req.headers["x-test-impersonator"]
        ? { impersonatorId: Number(req.headers["x-test-impersonator"]) }
        : {}),
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runWithTenant } = require("@liratek/core");
    runWithTenant(tenantId, () => next());
  };
  const requireRole =
    (roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
      const user = (req as Request & { user?: { role: string } }).user;
      if (!user) {
        res.status(401).json({ success: false, error: "Not authenticated" });
        return;
      }
      if (!roles.includes(user.role)) {
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }
      next();
    };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const OLD = "Old!Passw0rd";
const NEW = "xY7-pq_Rt.9mZ";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let nextUser = 0;

/** A fresh staff user per test: the per-user limiter's memory store lives
 * for the whole file, so no two tests may share a user. */
function freshUser(
  opts: { email?: string; verified?: boolean; hasPassword?: boolean } = {},
) {
  nextUser += 1;
  const username = `chg_${nextUser}`;
  const id = Number(
    db
      .prepare(
        `INSERT INTO users (tenant_id, username, password_hash, role, is_active, email, email_verified_at, has_password)
         VALUES (2, ?, ?, 'staff', 1, ?, ?, ?)`,
      )
      .run(
        username,
        core.hashPassword(OLD),
        opts.email ?? null,
        opts.email && opts.verified !== false
          ? "2026-10-01T00:00:00.000Z"
          : null,
        opts.hasPassword === false ? 0 : 1,
      ).lastInsertRowid,
  );
  const future = "2099-01-01T00:00:00.000Z";
  const addSession = db.prepare(
    `INSERT INTO sessions (tenant_id, user_id, token, device_type, expires_at) VALUES (2, ?, ?, 'web', ?)`,
  );
  for (const t of ["current", "other1", "other2"])
    addSession.run(id, `tok-${t}-${id}`, future);
  return { id, username, current: `tok-current-${id}` };
}

function body(input: { currentPassword: string; newPassword: string }) {
  expect(core.changeOwnPasswordSchema.safeParse(input).success).toBe(
    core.validatePasswordComplexity(input.newPassword).valid &&
      input.currentPassword.length > 0,
  );
  return input;
}

function change(
  user: { id: number; username: string; current: string },
  input: { currentPassword: string; newPassword: string },
  extra: Record<string, string> = {},
) {
  return request(app)
    .post("/api/password-reset/change")
    .set("x-test-role", "staff")
    .set("x-test-user", String(user.id))
    .set("x-test-username", user.username)
    .set("x-test-session", user.current)
    .set(extra)
    .send(body(input));
}

const hashOf = (id: number) =>
  (
    db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(id) as {
      password_hash: string;
    }
  ).password_hash;
const tokensOf = (id: number) =>
  (
    db
      .prepare(`SELECT token FROM sessions WHERE user_id = ? ORDER BY token`)
      .all(id) as { token: string }[]
  ).map((r) => r.token);
const outboxTo = (to: string) =>
  db
    .prepare(`SELECT template, data_json FROM email_outbox WHERE to_email = ?`)
    .all(to) as {
    template: string;
    data_json: string;
  }[];

beforeAll(async () => {
  process.env.JWT_SECRET = "change-pw-test-secret-0123456789-0123456789-abcd";
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
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Cell City', 'cellcity', 'active')`,
  ).run();
  core.resetUserRepository();
  core.resetSessionRepository();
  core.resetAuthService();
  core.resetTenantRepository();
  core.resetAuditRepository();
  core.resetAuditService();
  core.resetEmailOutboxRepository();
  core.resetPasswordResetTokenRepository();
  core.resetPasswordResetService();

  const routes = (await import("../passwordReset")).default;
  app = express();
  app.use(express.json());
  app.use("/api/password-reset", routes);
});

afterAll(() => db.close());

beforeEach(() => {
  core.resetTenantContext();
  emailConfigured = true;
});

describe("LIRA-293 POST /api/password-reset/change", () => {
  it("changes the password, keeps THIS session and signs out the user's other sessions", async () => {
    const user = freshUser();
    const before = hashOf(user.id);
    const res = await change(user, { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { sessionsRevoked: 2 },
    });
    expect(hashOf(user.id)).not.toBe(before);
    expect(core.verifyPassword(NEW, hashOf(user.id))).toBe(true);
    expect(tokensOf(user.id)).toEqual([user.current]);
  });

  it("does not touch another user's sessions", async () => {
    const other = freshUser();
    const user = freshUser();
    await change(user, { currentPassword: OLD, newPassword: NEW });
    expect(tokensOf(other.id)).toHaveLength(3);
  });

  it("a wrong current password is the generic WRONG_PASSWORD refusal: nothing changes", async () => {
    const user = freshUser();
    const before = hashOf(user.id);
    const res = await change(user, {
      currentPassword: "Not!theP4ss",
      newPassword: NEW,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, code: "WRONG_PASSWORD" });
    expect(hashOf(user.id)).toBe(before);
    expect(tokensOf(user.id)).toHaveLength(3);
  });

  it("a weak new password is refused by the ONE password rule: nothing changes", async () => {
    const user = freshUser();
    const before = hashOf(user.id);
    const res = await change(user, {
      currentPassword: OLD,
      newPassword: "weak",
    });
    expect(res.body.success).toBe(false);
    expect(hashOf(user.id)).toBe(before);
  });

  it("a user with NO password (joined with Google) is refused: they use Set a password", async () => {
    const user = freshUser({ hasPassword: false });
    const res = await change(user, { currentPassword: OLD, newPassword: NEW });
    expect(res.body).toMatchObject({
      success: false,
      code: "PASSWORD_NOT_SET",
    });
  });

  it("an impersonated session (a super admin acting as the user) is refused 403: nothing changes", async () => {
    const user = freshUser();
    const before = hashOf(user.id);
    const res = await change(
      user,
      { currentPassword: OLD, newPassword: NEW },
      { "x-test-impersonator": "1" },
    );
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(hashOf(user.id)).toBe(before);
  });

  it("rate limit: 5 wrong current passwords per user per 15 min, then 429 — even with the right one", async () => {
    const user = freshUser();
    for (let i = 0; i < 5; i++) {
      const res = await change(user, {
        currentPassword: `Wrong!pass${i}`,
        newPassword: NEW,
      });
      expect(res.body.code).toBe("WRONG_PASSWORD");
    }
    const blocked = await change(user, {
      currentPassword: OLD,
      newPassword: NEW,
    });
    expect(blocked.status).toBe(429);
    expect(core.verifyPassword(OLD, hashOf(user.id))).toBe(true);
  });

  it("the limit is per user: another user is not blocked by someone else's failures", async () => {
    const noisy = freshUser();
    for (let i = 0; i < 6; i++) {
      await change(noisy, {
        currentPassword: `Wrong!pass${i}`,
        newPassword: NEW,
      });
    }
    const quiet = freshUser();
    const res = await change(quiet, { currentPassword: OLD, newPassword: NEW });
    expect(res.body.success).toBe(true);
  });

  it("queues a 'password-changed' notice (no secret) to a CONFIRMED email", async () => {
    const email = `chg-${Date.now()}@cell.test`;
    const user = freshUser({ email });
    const res = await change(user, { currentPassword: OLD, newPassword: NEW });
    expect(res.body.data.noticeSent).toBe(true);
    const rows = outboxTo(email);
    expect(rows.map((r) => r.template)).toEqual(["password-changed"]);
    const data = JSON.parse(rows[0]!.data_json) as Record<string, unknown>;
    expect(data).toMatchObject({
      username: user.username,
      shopName: "Cell City",
    });
    expect(JSON.stringify(data)).not.toContain(NEW);
  });

  it("no notice when email is off, or the email is not confirmed", async () => {
    emailConfigured = false;
    const offEmail = `off-${Date.now()}@cell.test`;
    const off = freshUser({ email: offEmail });
    expect(
      (await change(off, { currentPassword: OLD, newPassword: NEW })).body.data
        .noticeSent,
    ).toBe(false);
    expect(outboxTo(offEmail)).toHaveLength(0);

    emailConfigured = true;
    const unconfirmedEmail = `unc-${Date.now()}@cell.test`;
    const unconfirmed = freshUser({ email: unconfirmedEmail, verified: false });
    expect(
      (await change(unconfirmed, { currentPassword: OLD, newPassword: NEW }))
        .body.data.noticeSent,
    ).toBe(false);
    expect(outboxTo(unconfirmedEmail)).toHaveLength(0);
  });

  it("writes an audit entry, without the password", async () => {
    const user = freshUser();
    await change(user, { currentPassword: OLD, newPassword: NEW });
    const row = db
      .prepare(
        `SELECT summary, metadata FROM audit_log WHERE entity_type = 'user' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(String(user.id)) as
      | { summary: string; metadata: string }
      | undefined;
    expect(row?.summary).toBe("Changed own password");
    expect(row?.metadata ?? "").not.toContain(NEW);
  });
});
