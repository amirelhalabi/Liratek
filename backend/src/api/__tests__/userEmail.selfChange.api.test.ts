/**
 * POST /api/user-email/me/change — LIRA-293: a signed-in user changes their
 * OWN email (web only). The confirmation link goes to the NEW address and
 * the email only changes once that link is opened; the OLD confirmed address
 * gets a notice with the new one masked. Same rules as the admin path:
 * unique per shop, and the sign-in directory follows the confirmed change.
 *
 * Supertest over a REAL in-memory SQLite database built from create_db.sql.
 * Stubbed: `isEmailConfigured` and `authenticateJWT` (the caller comes from
 * test headers, the shop scope is entered like the real middleware). The
 * public `/verify` route runs for real.
 *
 * Request bodies are parsed through the core schemas first (rule 24).
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
      username: "someone",
      role,
      tenantId,
      sessionToken: "tok",
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

const BASE = "/api/user-email";
let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
const ids: Record<string, number> = {};

function changeBody(input: { email: string }) {
  expect(core.requestOwnEmailChangeSchema.safeParse(input).success).toBe(true);
  return input;
}

function requestChange(
  userId: number,
  email: string,
  extra: Record<string, string> = {},
) {
  return request(app)
    .post(`${BASE}/me/change`)
    .set("x-test-role", "staff")
    .set("x-test-user", String(userId))
    .set(extra)
    .send(changeBody({ email }));
}

function verify(token: string) {
  const input = { token };
  expect(core.verifyUserEmailSchema.safeParse(input).success).toBe(true);
  return request(app).post(`${BASE}/verify`).send(input);
}

const emailOf = (id: number) =>
  db
    .prepare(`SELECT email, email_verified_at FROM users WHERE id = ?`)
    .get(id) as {
    email: string | null;
    email_verified_at: string | null;
  };

const outbox = (template: string, to: string) =>
  db
    .prepare(
      `SELECT data_json FROM email_outbox WHERE template = ? AND to_email = ? ORDER BY id`,
    )
    .all(template, to) as { data_json: string }[];

function tokenSentTo(to: string): string {
  const rows = outbox("verify-email", to);
  expect(rows.length).toBeGreaterThan(0);
  const url = (
    JSON.parse(rows[rows.length - 1]!.data_json) as { verifyUrl: string }
  ).verifyUrl;
  return new URLSearchParams(new URL(url).hash.split("?")[1] ?? "").get(
    "token",
  )!;
}

const directoryEmails = (userId: number) =>
  (
    db
      .prepare(
        `SELECT value FROM signin_directory WHERE kind = 'email' AND target_user_id = ? ORDER BY value`,
      )
      .all(userId) as { value: string }[]
  ).map((r) => r.value);

beforeAll(async () => {
  process.env.JWT_SECRET = "self-email-test-secret-0123456789-0123456789-ab";
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
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (3, 'Fone Fix', 'fonefix', 'active')`,
  ).run();
  const insert = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (?, ?, 'x', 'staff', 1)`,
  );
  for (const [tenant, name] of [
    [2, "me"],
    [2, "colleague"],
    [3, "elsewhere"],
  ] as const) {
    ids[name] = Number(insert.run(tenant, name).lastInsertRowid);
  }
  core.resetUserRepository();
  core.resetTenantRepository();
  core.resetAuditRepository();
  core.resetAuditService();
  core.resetEmailOutboxRepository();
  core.resetEmailVerificationTokenRepository();
  core.resetUserEmailService();

  const routes = (await import("../userEmail")).default;
  app = express();
  app.use(express.json());
  app.use(BASE, routes);
});

afterAll(() => db.close());

beforeEach(() => {
  core.resetTenantContext();
  emailConfigured = true;
  db.exec(
    `DELETE FROM email_verification_tokens; DELETE FROM email_outbox; DELETE FROM signin_directory;
     UPDATE users SET email = NULL, email_verified_at = NULL;`,
  );
  db.prepare(
    `UPDATE users SET email = 'old@cell.test', email_verified_at = '2026-10-01T00:00:00.000Z' WHERE id = ?`,
  ).run(ids.me);
  new core.SigninDirectoryService().rebuildAll("2026-10-01T00:00:00.000Z");
});

describe("LIRA-293 change own email", () => {
  it("sends the link to the NEW address; the email does NOT change until the link is opened", async () => {
    const res = await requestChange(ids.me!, "New.Me@Cell.test");
    expect(res.body).toMatchObject({
      success: true,
      data: { pendingEmail: "new.me@cell.test" },
    });
    expect(outbox("verify-email", "new.me@cell.test")).toHaveLength(1);
    expect(outbox("verify-email", "old@cell.test")).toHaveLength(0);
    expect(emailOf(ids.me!)).toEqual({
      email: "old@cell.test",
      email_verified_at: "2026-10-01T00:00:00.000Z",
    });
  });

  it("notifies the OLD confirmed address, with the new address masked", async () => {
    await requestChange(ids.me!, "newname@gmail.com");
    const rows = outbox("email-change-notice", "old@cell.test");
    expect(rows).toHaveLength(1);
    const data = JSON.parse(rows[0]!.data_json) as Record<string, string>;
    expect(data.newEmailMasked).toBe("n***@gmail.com");
    expect(rows[0]!.data_json).not.toContain("newname@gmail.com");
    expect(data.username).toBe("me");
  });

  it("no notice when the old address was never confirmed", async () => {
    db.prepare(`UPDATE users SET email_verified_at = NULL WHERE id = ?`).run(
      ids.me,
    );
    await requestChange(ids.me!, "fresh@cell.test");
    expect(outbox("email-change-notice", "old@cell.test")).toHaveLength(0);
  });

  it("opening the link applies the change, confirmed, and the sign-in directory follows", async () => {
    expect(directoryEmails(ids.me!)).toEqual(["old@cell.test"]);
    await requestChange(ids.me!, "applied@cell.test");
    const res = await verify(tokenSentTo("applied@cell.test"));
    expect(res.body).toMatchObject({ success: true });
    const after = emailOf(ids.me!);
    expect(after.email).toBe("applied@cell.test");
    expect(after.email_verified_at).not.toBeNull();
    expect(directoryEmails(ids.me!)).toEqual(["applied@cell.test"]);
  });

  it("refuses an address another user of THIS shop has (EMAIL_TAKEN_IN_SHOP); nothing is sent", async () => {
    db.prepare(`UPDATE users SET email = 'taken@cell.test' WHERE id = ?`).run(
      ids.colleague,
    );
    const res = await requestChange(ids.me!, "taken@cell.test");
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("EMAIL_TAKEN_IN_SHOP");
    expect(outbox("verify-email", "taken@cell.test")).toHaveLength(0);
    expect(outbox("email-change-notice", "old@cell.test")).toHaveLength(0);
  });

  it("another SHOP's user may have the same address", async () => {
    db.prepare(`UPDATE users SET email = 'shared@x.test' WHERE id = ?`).run(
      ids.elsewhere,
    );
    const res = await requestChange(ids.me!, "shared@x.test");
    expect(res.body.success).toBe(true);
  });

  it("if someone in the shop takes the address before the link is opened, the link is refused and nothing changes", async () => {
    await requestChange(ids.me!, "race@cell.test");
    const token = tokenSentTo("race@cell.test");
    db.prepare(`UPDATE users SET email = 'race@cell.test' WHERE id = ?`).run(
      ids.colleague,
    );
    const res = await verify(token);
    expect(res.body.success).toBe(false);
    expect(emailOf(ids.me!).email).toBe("old@cell.test");
  });

  it("a normal verify link is never treated as a change", async () => {
    db.prepare(`UPDATE users SET email_verified_at = NULL WHERE id = ?`).run(
      ids.me,
    );
    // An ordinary "confirm your current address" link…
    // (issued through the admin path's sendVerification)
    core.runWithTenant(2, () =>
      core.getUserEmailService().sendVerification(ids.me!, {
        tenantId: 2,
        now: new Date().toISOString(),
        emailConfigured: true,
        supportEmail: "help@liratek.test",
        resolveLinkBase: () => "https://cellcity.liratek.test",
      }),
    );
    const token = tokenSentTo("old@cell.test");
    // …whose address then changes behind its back must not change it back.
    db.prepare(`UPDATE users SET email = 'moved@cell.test' WHERE id = ?`).run(
      ids.me,
    );
    const res = await verify(token);
    expect(res.body.success).toBe(false);
    expect(emailOf(ids.me!).email).toBe("moved@cell.test");
  });

  it("a newer change request burns the older link", async () => {
    await requestChange(ids.me!, "first@cell.test");
    const first = tokenSentTo("first@cell.test");
    await requestChange(ids.me!, "second@cell.test");
    expect((await verify(first)).body.success).toBe(false);
    expect(emailOf(ids.me!).email).toBe("old@cell.test");
  });

  it("rate limit: at most 3 links per user per hour (RATE_LIMITED)", async () => {
    for (const n of [1, 2, 3]) {
      expect(
        (await requestChange(ids.me!, `try${n}@cell.test`)).body.success,
      ).toBe(true);
    }
    const res = await requestChange(ids.me!, "try4@cell.test");
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect(outbox("verify-email", "try4@cell.test")).toHaveLength(0);
  });

  it("refused when email cannot be sent: nothing changes", async () => {
    emailConfigured = false;
    const res = await requestChange(ids.me!, "nomail@cell.test");
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(emailOf(ids.me!).email).toBe("old@cell.test");
  });

  it("refuses an impersonated session (a super admin acting as the user): 403", async () => {
    const res = await requestChange(ids.me!, "imp@cell.test", {
      "x-test-impersonator": "1",
    });
    expect(res.status).toBe(403);
    expect(outbox("verify-email", "imp@cell.test")).toHaveLength(0);
  });

  it("asking for the address you already have is refused (EMAIL_UNCHANGED)", async () => {
    const res = await requestChange(ids.me!, "OLD@cell.test");
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("EMAIL_UNCHANGED");
  });
});
