/**
 * /api/auth/signin-code — "email me a code" on www, then "your shops"
 * (LIRA-287).
 *
 * Supertest over a REAL in-memory SQLite database built from create_db.sql:
 * the router, SigninCodeService, the repositories and the REAL per-IP
 * limiters all run. Stubbed: `isEmailConfigured` (no mail transport here).
 * The per-IP limiters key on CLIENT_IP_HEADER (`fly-client-ip`), believed
 * only with the Vercel proxy secret (LIRA-283); each test sends its own IP.
 *
 * Request bodies are parsed through the core schemas first (rule 24).
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

const PROXY_SECRET = "lira287-test-proxy-secret-0123456789abcdef";
const WWW_HOST = "www.liratek.test";
const GENERIC_SENT = {
  success: true,
  data: { message: "If this email has a LiraTek account, we've sent a code." },
};
const INVALID = {
  success: false,
  code: "SIGNIN_CODE_INVALID",
  error: {
    code: "SIGNIN_CODE_INVALID",
    message:
      "That code is not right or has expired. Check it, or ask for a new one.",
  },
};

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let ipCounter = 0;
const nextIp = () => `203.0.113.${++ipCounter}`;

function send(pathName: string, body: object, ip = nextIp(), host = WWW_HOST) {
  return request(app)
    .post(`/api/auth/signin-code${pathName}`)
    .set("X-Forwarded-Host", host)
    .set("x-liratek-proxy-auth", PROXY_SECRET)
    .set("fly-client-ip", ip)
    .send(body);
}

function requestCode(email: string, ip?: string, host?: string) {
  const input = { email };
  expect(core.requestSigninCodeSchema.safeParse(input).success).toBe(true);
  return send("/request", input, ip, host);
}

function verifyCode(email: string, code: string, ip?: string) {
  const input = { email, code };
  expect(core.verifySigninCodeSchema.safeParse(input).success).toBe(true);
  return send("/verify", input, ip);
}

const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const outboxRows = () => count(`SELECT COUNT(*) AS n FROM email_outbox`);

/** The code in the newest outbox row (only its hash is stored). */
function lastCode(): string {
  const row = db
    .prepare(`SELECT data_json FROM email_outbox ORDER BY id DESC LIMIT 1`)
    .get() as { data_json: string };
  return String(JSON.parse(row.data_json)[core.SIGNIN_CODE_SECRET_KEY]);
}

beforeAll(async () => {
  process.env.JWT_SECRET = "signin-code-test-secret-0123456789-0123456789";
  process.env.APP_BASE_DOMAIN = "liratek.test";
  process.env.CLIENT_IP_HEADER = "fly-client-ip";
  process.env.CLIENT_IP_PROXY_SECRET = PROXY_SECRET;

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
      (3, 'Beta Phones', 'beta', 'active'),
      (4, 'Closed Shop', 'closed', 'suspended');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'x', 'admin', 1, 'owner@gmail.com', '2026-10-01T00:00:00.000Z'),
      (21, 2, 'cashier', 'x', 'staff', 1, 'cashier@gmail.com', NULL),
      (30, 3, 'owner3', 'x', 'admin', 1, 'owner@gmail.com', '2026-10-01T00:00:00.000Z'),
      (40, 4, 'boss4', 'x', 'admin', 1, 'owner@gmail.com', '2026-10-01T00:00:00.000Z');
  `);

  core.resetEmailOutboxRepository();

  const routes = (await import("../signinCode")).default;
  app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/auth/signin-code", routes);
});

afterAll(() => {
  db.close();
  delete process.env.CLIENT_IP_PROXY_SECRET;
});

beforeEach(() => {
  core.resetTenantContext();
  emailConfigured = true;
  db.exec(`DELETE FROM signin_codes; DELETE FROM email_outbox;`);
});

describe("POST /request", () => {
  it("mails a code to an email with a confirmed account, and answers the generic message", async () => {
    const res = await requestCode("Owner@Gmail.com");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC_SENT);
    expect(outboxRows()).toBe(1);
    expect(lastCode()).toMatch(/^\d{6}$/);
    // Only the hash is stored.
    expect(
      count(`SELECT COUNT(*) AS n FROM signin_codes WHERE code_hash LIKE '%${lastCode()}%'`),
    ).toBe(0);
  });

  it("answers IDENTICALLY for an unknown or unverified email, and sends nothing", async () => {
    const unknown = await requestCode("nobody@gmail.com");
    const unverified = await requestCode("cashier@gmail.com");
    expect(unknown.body).toEqual(GENERIC_SENT);
    expect(unverified.body).toEqual(GENERIC_SENT);
    expect(outboxRows()).toBe(0);
  });

  it("answers identically and sends nothing when mail is not set up", async () => {
    emailConfigured = false;
    const res = await requestCode("owner@gmail.com");
    expect(res.body).toEqual(GENERIC_SENT);
    expect(outboxRows()).toBe(0);
  });

  it("limits codes per email (silently)", async () => {
    for (let i = 0; i < core.SIGNIN_CODE_PER_EMAIL_LIMIT + 2; i++) {
      const res = await requestCode("owner@gmail.com");
      expect(res.body).toEqual(GENERIC_SENT);
    }
    expect(outboxRows()).toBe(core.SIGNIN_CODE_PER_EMAIL_LIMIT);
  });

  it("limits each client IP to 10 requests per hour (429)", async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      expect((await requestCode("nobody@gmail.com", ip)).status).toBe(200);
    }
    expect((await requestCode("nobody@gmail.com", ip)).status).toBe(429);
    expect((await requestCode("nobody@gmail.com")).status).toBe(200);
  });

  it("an unknown shop subdomain gets the generic reply and nothing is sent", async () => {
    const res = await requestCode(
      "owner@gmail.com",
      undefined,
      "nosuchshop.liratek.test",
    );
    expect(res.body).toEqual(GENERIC_SENT);
    expect(outboxRows()).toBe(0);
  });

  it("rejects a malformed email (200, success:false, nothing sent)", async () => {
    const res = await send("/request", { email: "not-an-email" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(outboxRows()).toBe(0);
  });
});

describe("POST /verify", () => {
  async function emailedCode(): Promise<string> {
    await requestCode("owner@gmail.com");
    return lastCode();
  }

  it("a valid code returns every active shop where the email is a confirmed user", async () => {
    const code = await emailedCode();
    const res = await verifyCode("owner@gmail.com", code);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        shops: [
          { slug: "beta", name: "Beta Phones", username: "owner3" },
          { slug: "cellcity", name: "Cell City", username: "boss" },
        ],
      },
    });
  });

  it("a wrong code: the one generic refusal, and no shops", async () => {
    await emailedCode();
    const res = await verifyCode("owner@gmail.com", "000000");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(INVALID);
  });

  it(`locks the code after ${5} wrong tries`, async () => {
    const code = await emailedCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < core.SIGNIN_CODE_MAX_ATTEMPTS; i++) {
      expect((await verifyCode("owner@gmail.com", wrong)).body).toEqual(
        INVALID,
      );
    }
    expect((await verifyCode("owner@gmail.com", code)).body).toEqual(INVALID);
  });

  it("works once", async () => {
    const code = await emailedCode();
    expect((await verifyCode("owner@gmail.com", code)).body.success).toBe(true);
    expect((await verifyCode("owner@gmail.com", code)).body).toEqual(INVALID);
  });

  it("refuses an expired code", async () => {
    const code = await emailedCode();
    db.prepare(
      `UPDATE signin_codes SET expires_at = '2000-01-01T00:00:00.000Z'`,
    ).run();
    expect((await verifyCode("owner@gmail.com", code)).body).toEqual(INVALID);
  });

  it("a code for one email does not open another", async () => {
    const code = await emailedCode();
    expect((await verifyCode("cashier@gmail.com", code)).body).toEqual(
      INVALID,
    );
  });

  it("limits each client IP to 30 tries per hour (429)", async () => {
    const ip = nextIp();
    for (let i = 0; i < 30; i++) {
      expect((await verifyCode("nobody@gmail.com", "123456", ip)).status).toBe(
        200,
      );
    }
    expect((await verifyCode("nobody@gmail.com", "123456", ip)).status).toBe(
      429,
    );
  });
});
