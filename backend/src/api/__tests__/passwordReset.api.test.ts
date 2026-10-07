/**
 * /api/password-reset — forgot, check, reset, and the admin's send
 * (LIRA-275/276, contract C).
 *
 * Supertest over a REAL in-memory SQLite database built from create_db.sql:
 * the router, PasswordResetService, every repository, the audit writer and
 * the REAL per-IP limiter all run. Stubbed: `isEmailConfigured` (no mail
 * transport in tests) and `authenticateJWT`, which here reads the actor from
 * test headers and enters the JWT's shop scope like the real middleware.
 *
 * The test app trusts one proxy hop, like server.ts; the shop comes from
 * X-Forwarded-Host, exactly as Vercel -> Fly delivers it. The per-IP limiter
 * keys on CLIENT_IP_HEADER (`fly-client-ip`), believed only with the Vercel
 * proxy secret (LIRA-283); each test sends its own.
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
      userId: 20,
      username: "boss",
      role,
      tenantId,
      sessionToken: "test-session",
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

const PASSWORD = "N3w!Passw0rd";
const GENERIC_SENT = {
  success: true,
  data: {
    message:
      "If this email belongs to an account in this shop, we've sent a link.",
  },
};
const INVALID_LINK = "This reset link is not valid. Ask for a new one.";
const GENERIC_SENT_EVERY_SHOP = {
  success: true,
  data: {
    message:
      "If this email belongs to a LiraTek account, we've sent a reset link for each shop it signs in to.",
  },
};

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let ipCounter = 0;

function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

const SHOP_HOST = "cellcity.liratek.test";
const OTHER_HOST = "other.liratek.test";
const WWW_HOST = "www.liratek.test";

function forgot(
  host: string,
  input: { email: string; shop?: string },
  ip = nextIp(),
) {
  expect(core.forgotPasswordSchema.safeParse(input).success).toBe(true);
  return request(app)
    .post("/api/password-reset/forgot")
    .set("X-Forwarded-Host", host)
    .set("x-liratek-proxy-auth", "lira283-test-proxy-secret-0123456789abcdef")
    .set("fly-client-ip", ip)
    .send(input);
}

function check(host: string, token: string) {
  const input = { token };
  expect(core.checkResetTokenSchema.safeParse(input).success).toBe(true);
  return request(app)
    .post("/api/password-reset/check")
    .set("X-Forwarded-Host", host)
    .set("x-liratek-proxy-auth", "lira283-test-proxy-secret-0123456789abcdef")
    .set("fly-client-ip", nextIp())
    .send(input);
}

function reset(host: string, token: string, password = PASSWORD) {
  return request(app)
    .post("/api/password-reset/reset")
    .set("X-Forwarded-Host", host)
    .set("x-liratek-proxy-auth", "lira283-test-proxy-secret-0123456789abcdef")
    .set("fly-client-ip", nextIp())
    .send({ token, password });
}

function count(sql: string, ...args: unknown[]): number {
  return (db.prepare(sql).get(...args) as { n: number }).n;
}
const outboxRows = () => count(`SELECT COUNT(*) AS n FROM email_outbox`);

/** The token inside the newest emailed link (only the hash is stored). */
function lastEmailedToken(): string {
  const row = db
    .prepare(`SELECT data_json FROM email_outbox ORDER BY id DESC LIMIT 1`)
    .get() as { data_json: string };
  const url = String(JSON.parse(row.data_json).resetUrl);
  return decodeURIComponent(url.split("token=")[1]!);
}
function lastEmailedUrl(): string {
  const row = db
    .prepare(`SELECT data_json FROM email_outbox ORDER BY id DESC LIMIT 1`)
    .get() as { data_json: string };
  return String(JSON.parse(row.data_json).resetUrl);
}

beforeAll(async () => {
  process.env.JWT_SECRET = "password-reset-test-secret-0123456789-0123456789";
  process.env.APP_BASE_DOMAIN = "liratek.test";
  process.env.CLIENT_IP_HEADER = "fly-client-ip";
  // LIRA-283: the header is only believed alongside the Vercel proxy secret.
  process.env.CLIENT_IP_PROXY_SECRET =
    "lira283-test-proxy-secret-0123456789abcdef";

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
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (2, 'Cell City', 'cellcity', 'active'),
      (3, 'Other Shop', 'other', 'active');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'old', 'admin', 1, 'boss@shop.com', '2026-10-01T00:00:00.000Z'),
      (21, 2, 'cashier', 'old', 'staff', 1, 'cashier@shop.com', NULL),
      (22, 2, 'nomail', 'old', 'staff', 1, NULL, NULL),
      (24, 2, 'clerk', 'old', 'staff', 1, 'clerk@shop.com', '2026-10-01T00:00:00.000Z'),
      (30, 3, 'otherboss', 'old', 'admin', 1, 'boss@other.com', '2026-10-01T00:00:00.000Z'),
      (31, 3, 'owner2', 'old', 'admin', 1, 'boss@shop.com', '2026-10-01T00:00:00.000Z'),
      (32, 3, 'unverified', 'old', 'staff', 1, 'cashier@shop.com', NULL);
  `);

  core.resetTenantRepository();
  core.resetEmailOutboxRepository();
  core.resetPasswordResetService();

  const routes = (await import("../passwordReset")).default;
  app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/password-reset", routes);
});

afterAll(() => {
  db.close();
  delete process.env.CLIENT_IP_PROXY_SECRET;
});

beforeEach(() => {
  core.resetTenantContext();
  emailConfigured = true;
  db.exec(`DELETE FROM password_reset_tokens; DELETE FROM email_outbox;`);
});

describe("POST /forgot", () => {
  it("on a shop's address: emails a link on that shop's address and answers the generic message", async () => {
    const res = await forgot(SHOP_HOST, { email: "boss@shop.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC_SENT);
    expect(outboxRows()).toBe(1);
    expect(lastEmailedUrl()).toMatch(
      /^https:\/\/cellcity\.liratek\.test\/#\/reset-password\?token=.+/,
    );
  });

  it("answers IDENTICALLY for an unknown or unverified email, and sends nothing", async () => {
    const unknown = await forgot(SHOP_HOST, { email: "nobody@shop.com" });
    const unverified = await forgot(SHOP_HOST, { email: "cashier@shop.com" });
    expect(unknown.body).toEqual(GENERIC_SENT);
    expect(unverified.body).toEqual(GENERIC_SENT);
    expect(outboxRows()).toBe(0);
  });

  // LIRA-287: www no longer asks for the shop. It mails one reset link per
  // shop the email signs in to (verified, active user, active shop), each on
  // that shop's own address, and answers one generic message either way.
  it("on www without a shop: one reset link per shop the email signs in to", async () => {
    const res = await forgot(WWW_HOST, { email: "boss@shop.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC_SENT_EVERY_SHOP);
    expect(
      db
        .prepare(
          `SELECT tenant_id, user_id FROM password_reset_tokens ORDER BY tenant_id`,
        )
        .all(),
    ).toEqual([
      { tenant_id: 2, user_id: 20 },
      { tenant_id: 3, user_id: 31 },
    ]);
    const urls = (
      db.prepare(`SELECT data_json FROM email_outbox ORDER BY id`).all() as {
        data_json: string;
      }[]
    ).map((r) => String(JSON.parse(r.data_json).resetUrl));
    expect(urls[0]).toMatch(/^https:\/\/cellcity\.liratek\.test\/#\/reset-password\?token=/);
    expect(urls[1]).toMatch(/^https:\/\/other\.liratek\.test\/#\/reset-password\?token=/);
  });

  it("on www without a shop: the same reply, and nothing sent, for an unknown or unverified email", async () => {
    const unknown = await forgot(WWW_HOST, { email: "nobody@shop.com" });
    const unverified = await forgot(WWW_HOST, { email: "cashier@shop.com" });
    expect(unknown.body).toEqual(GENERIC_SENT_EVERY_SHOP);
    expect(unverified.body).toEqual(GENERIC_SENT_EVERY_SHOP);
    expect(outboxRows()).toBe(0);
  });

  it("on www with a shop address: uses that shop", async () => {
    const res = await forgot(WWW_HOST, {
      email: "boss@shop.com",
      shop: "cellcity",
    });
    expect(res.body).toEqual(GENERIC_SENT);
    expect(outboxRows()).toBe(1);
  });

  it("on www with an unknown shop: the generic reply, nothing sent", async () => {
    const res = await forgot(WWW_HOST, {
      email: "boss@shop.com",
      shop: "nosuchshop",
    });
    expect(res.body).toEqual(GENERIC_SENT);
    expect(outboxRows()).toBe(0);
  });

  it("on a shop's address, a typed shop is ignored: the host decides", async () => {
    await forgot(SHOP_HOST, { email: "boss@other.com", shop: "other" });
    expect(outboxRows()).toBe(0);
    await forgot(SHOP_HOST, { email: "boss@shop.com", shop: "other" });
    expect(
      db.prepare(`SELECT tenant_id, user_id FROM password_reset_tokens`).all(),
    ).toEqual([{ tenant_id: 2, user_id: 20 }]);
  });

  it("on an unknown subdomain: the generic reply, nothing sent", async () => {
    const res = await forgot("nosuchshop.liratek.test", {
      email: "boss@shop.com",
    });
    expect(res.body).toEqual(GENERIC_SENT);
    expect(outboxRows()).toBe(0);
  });

  it("limits each client IP (the real-IP header, not the proxy hop) to 5 per hour", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      const ok = await forgot(SHOP_HOST, { email: "nobody@shop.com" }, ip);
      expect(ok.status).toBe(200);
    }
    const blocked = await forgot(SHOP_HOST, { email: "nobody@shop.com" }, ip);
    expect(blocked.status).toBe(429);
    // Another real client behind the same proxy is not affected.
    const other = await forgot(SHOP_HOST, { email: "nobody@shop.com" });
    expect(other.status).toBe(200);
  });

  // validateRequest answers zod failures with HTTP 200 + a string error
  // (rule 19c), not the 400 the contract's convention list says.
  it("rejects a malformed email (200, success:false, nothing sent)", async () => {
    const res = await request(app)
      .post("/api/password-reset/forgot")
      .set("X-Forwarded-Host", SHOP_HOST)
      .set("x-liratek-proxy-auth", "lira283-test-proxy-secret-0123456789abcdef")
      .set("fly-client-ip", nextIp())
      .send({ email: "not-an-email" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(outboxRows()).toBe(0);
  });
});

describe("POST /check and /reset", () => {
  async function emailedToken(): Promise<string> {
    await forgot(SHOP_HOST, { email: "boss@shop.com" });
    return lastEmailedToken();
  }

  it("check: shows the username and shop for a usable link", async () => {
    const token = await emailedToken();
    const res = await check(SHOP_HOST, token);
    expect(res.body).toEqual({
      success: true,
      data: { username: "boss", shopName: "Cell City" },
    });
  });

  it("check: the generic refusal for an unknown link or another shop's address", async () => {
    const token = await emailedToken();
    for (const res of [
      await check(SHOP_HOST, "nope"),
      await check(OTHER_HOST, token),
    ]) {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe(INVALID_LINK);
    }
  });

  it("reset: sets the password, signs the user out everywhere, audits, and works once", async () => {
    db.exec(`DELETE FROM sessions;
      INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES
        (2, 20, 's1', '2099-01-01'), (2, 20, 's2', '2099-01-01'), (2, 24, 's3', '2099-01-01');`);
    const token = await emailedToken();
    expect(
      core.resetPasswordSchema.safeParse({ token, password: PASSWORD }).success,
    ).toBe(true);

    const res = await reset(SHOP_HOST, token);
    expect(res.body).toEqual({
      success: true,
      data: { loginUrl: "https://cellcity.liratek.test" },
    });
    const hash = (
      db.prepare(`SELECT password_hash FROM users WHERE id = 20`).get() as {
        password_hash: string;
      }
    ).password_hash;
    expect(core.verifyPassword(PASSWORD, hash)).toBe(true);
    expect(count(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 20`)).toBe(
      0,
    );
    expect(count(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 24`)).toBe(
      1,
    );
    const audit = db
      .prepare(
        `SELECT tenant_id, user_id, username, entity_type, entity_id, summary FROM audit_log ORDER BY id DESC LIMIT 1`,
      )
      .get();
    expect(audit).toEqual({
      tenant_id: 2,
      user_id: 20,
      username: "boss",
      entity_type: "user",
      entity_id: "20",
      summary: "Password reset by emailed link",
    });

    const again = await reset(SHOP_HOST, token, "An0ther!Pass");
    expect(again.body.success).toBe(false);
    expect(again.body.error.message).toBe(INVALID_LINK);
  });

  it("reset: another shop's address gets the generic refusal and the link still works", async () => {
    const token = await emailedToken();
    const wrong = await reset(OTHER_HOST, token);
    expect(wrong.body.success).toBe(false);
    expect(wrong.body.error.message).toBe(INVALID_LINK);
    const right = await reset(SHOP_HOST, token);
    expect(right.body.success).toBe(true);
  });

  it("reset: a weak password is refused with the policy message and does not use up the link", async () => {
    const token = await emailedToken();
    const weak = await reset(SHOP_HOST, token, "weak");
    expect(weak.body.success).toBe(false);
    expect(String(weak.body.error)).toMatch(/Password must/);
    const res = await check(SHOP_HOST, token);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /send/:userId (LIRA-276)", () => {
  const send = (userId: string | number, role?: string, tenant = 2) => {
    const req = request(app)
      .post(`/api/password-reset/send/${userId}`)
      .set("X-Forwarded-Host", SHOP_HOST);
    return role
      ? req.set("x-test-role", role).set("x-test-tenant", String(tenant))
      : req;
  };

  it("needs a signed-in admin", async () => {
    expect((await send(24)).status).toBe(401);
    expect((await send(24, "staff")).status).toBe(403);
    expect(outboxRows()).toBe(0);
  });

  it("emails the user's verified address and audits it", async () => {
    const res = await send(24, "admin");
    expect(res.body).toEqual({ success: true, data: { sent: true } });
    const row = db
      .prepare(`SELECT to_email FROM email_outbox ORDER BY id DESC LIMIT 1`)
      .get() as { to_email: string };
    expect(row.to_email).toBe("clerk@shop.com");
    const audit = db
      .prepare(
        `SELECT user_id, entity_type, entity_id, summary FROM audit_log ORDER BY id DESC LIMIT 1`,
      )
      .get();
    expect(audit).toEqual({
      user_id: 20,
      entity_type: "user",
      entity_id: "24",
      summary: "Sent a password reset link",
    });
  });

  it("refuses with a clear code (HTTP 200, code at the top level and in error)", async () => {
    const cases: Array<[number, string]> = [
      [22, "USER_HAS_NO_EMAIL"],
      [21, "EMAIL_NOT_VERIFIED"],
      [30, "NOT_FOUND"], // another shop's user
    ];
    for (const [userId, code] of cases) {
      const res = await send(userId, "admin");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(code);
      expect(res.body.error.code).toBe(code);
    }
    emailConfigured = false;
    const off = await send(24, "admin");
    expect(off.body.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(outboxRows()).toBe(0);
  });

  it("RATE_LIMITED after 3 links in an hour", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await send(24, "admin")).body.success).toBe(true);
    }
    expect((await send(24, "admin")).body.code).toBe("RATE_LIMITED");
  });

  it("rejects a non-numeric id", async () => {
    const res = await send("1e3", "admin");
    expect(res.body.success).toBe(false);
    expect(outboxRows()).toBe(0);
  });
});
