/**
 * POST /api/auth/signup/request — self-serve "email me a sign-up link"
 * (LIRA-267, US4, T049), and the sign-up limiters' scope.
 *
 * Supertest over a REAL in-memory SQLite database built from create_db.sql:
 * the route, SignupInvitationService.requestSelfServe, both repositories and
 * the REAL rate limiters all run. Stubbed: Turnstile verification (no
 * network) and `isEmailConfigured` (so self-serve can be switched off).
 *
 * The test app trusts one proxy hop, like server.ts, and every test sends
 * its own X-Forwarded-For — so the per-IP limiter is real but a test only
 * exhausts its own IP's budget.
 *
 * Request bodies are parsed through the core schemas first (rule 24).
 *
 * LIRA-278: the switch is SIGNUP_SELF_SERVE_ENABLED (set here, before core is
 * imported; the "switch off" case lives in signupSelfServeOff.api.test.ts
 * because the env is read once at import). Turnstile is an optional extra
 * layer, verified only when its keys are configured.
 */

import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import type { RequestSignupLinkInput } from "@liratek/core";
import fs from "node:fs";
import path from "node:path";

const routeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock("../../server.js", () => ({ logger: routeLogger }));

let emailConfigured = true;
jest.mock("../../email/createTransport.js", () => ({
  isEmailConfigured: () => emailConfigured,
  createTransport: () => {
    throw new Error("not used in this suite");
  },
}));

type Outcome = "passed" | "rejected" | "unavailable";
let turnstileConfigured = true;
const verifyTurnstile = jest.fn(
  async (_token: string, _ip: string | undefined): Promise<Outcome> => "passed",
);
jest.mock("../../security/turnstile.js", () => ({
  isTurnstileConfigured: () => turnstileConfigured,
  verifyTurnstile: (token: string, ip: string | undefined) =>
    verifyTurnstile(token, ip),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const DAILY_CAP = 5;
const GENERIC = {
  success: true,
  data: { message: "If this address can be used, we've emailed a link." },
};

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let ipCounter = 0;

/** A fresh client IP for each test, so one test's budget is its own. */
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function body(input: RequestSignupLinkInput) {
  expect(core.requestSignupLinkSchema.safeParse(input).success).toBe(true);
  return input;
}

function post(ip: string, input: RequestSignupLinkInput) {
  return request(app)
    .post("/api/auth/signup/request")
    .set("X-Forwarded-For", ip)
    .send(body({ turnstileToken: "cf-token", ...input }));
}

/** A request as the LIRA-278 form sends it: no Turnstile token. */
function postNoTurnstile(ip: string, input: RequestSignupLinkInput) {
  return request(app)
    .post("/api/auth/signup/request")
    .set("X-Forwarded-For", ip)
    .send(body(input));
}

function count(sql: string, ...args: unknown[]): number {
  return (db.prepare(sql).get(...args) as { n: number }).n;
}
const selfInvites = (email?: string) =>
  email
    ? count(
        `SELECT COUNT(*) AS n FROM signup_invitations WHERE source = 'self' AND email = ?`,
        email,
      )
    : count(`SELECT COUNT(*) AS n FROM signup_invitations WHERE source = 'self'`);
const outboxRows = () => count(`SELECT COUNT(*) AS n FROM email_outbox`);

beforeAll(async () => {
  process.env.JWT_SECRET = "signup-request-test-secret-0123456789-0123456789";
  process.env.APP_BASE_DOMAIN = "liratek.test";
  process.env.SIGNUP_SELF_SERVE_DAILY_CAP = String(DAILY_CAP);
  process.env.SIGNUP_SELF_SERVE_ENABLED = "true";
  // Pinned (dotenv never overrides a set variable): a local .env with a
  // CLIENT_IP_HEADER would otherwise change which IP the limiter keys on.
  process.env.CLIENT_IP_HEADER = "";

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
    `INSERT INTO tenants (id, name, slug, status, contact_email)
     VALUES (2, 'Cell City', 'cellcity', 'active', 'taken@example.com')`,
  ).run();

  core.resetTenantRepository();
  core.resetSignupInvitationRepository();
  core.resetEmailOutboxRepository();
  core.resetSignupInvitationService();

  const authRoutes = (await import("../auth")).default;
  app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/auth", authRoutes);
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  core.resetTenantContext();
  emailConfigured = true;
  turnstileConfigured = true;
  verifyTurnstile.mockReset();
  verifyTurnstile.mockResolvedValue("passed");
  routeLogger.info.mockClear();
  routeLogger.warn.mockClear();
  db.exec(`DELETE FROM signup_invitations; DELETE FROM email_outbox;`);
});

describe("POST /api/auth/signup/request", () => {
  it("self-serve off (no email transport): 200 success:false 'not available', Turnstile not called", async () => {
    emailConfigured = false;
    const res = await post(nextIp(), { email: "a@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Sign-up is not available right now.",
    });
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(selfInvites()).toBe(0);
  });

  // LIRA-278: Turnstile no longer gates self-serve. This test used to assert
  // "no Turnstile keys -> not available"; it now guards the opposite.
  it("switch on, Turnstile NOT configured: no token needed, queued, Cloudflare never asked", async () => {
    turnstileConfigured = false;
    const res = await postNoTurnstile(nextIp(), { email: "no-turnstile@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(selfInvites("no-turnstile@example.com")).toBe(1);
    expect(outboxRows()).toBe(1);
  });

  it("Turnstile rejects: 200 success:false 'complete the check', nothing queued", async () => {
    verifyTurnstile.mockResolvedValue("rejected");
    const res = await post(nextIp(), { email: "a@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Please complete the check and try again.",
    });
    expect(selfInvites()).toBe(0);
    expect(outboxRows()).toBe(0);
  });

  it("Turnstile configured but NO token sent (the field is optional since v196): refused, Cloudflare never asked, nothing queued", async () => {
    const res = await request(app)
      .post("/api/auth/signup/request")
      .set("X-Forwarded-For", nextIp())
      .send({ email: "a@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Please complete the check and try again.",
    });
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(selfInvites()).toBe(0);
    expect(outboxRows()).toBe(0);
  });

  it("Turnstile unreachable or timed out: 200 success:false 'try again in a few minutes', nothing queued", async () => {
    verifyTurnstile.mockResolvedValue("unavailable");
    const res = await post(nextIp(), { email: "a@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Please try again in a few minutes.",
    });
    expect(selfInvites()).toBe(0);
    expect(outboxRows()).toBe(0);
  });

  it("valid: the generic 200, one self invite and one outbox row; Turnstile got the token and the client IP", async () => {
    const ip = nextIp();
    const res = await post(ip, { email: "  New.Visitor@Example.com " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    expect(verifyTurnstile).toHaveBeenCalledWith("cf-token", ip);
    expect(selfInvites("new.visitor@example.com")).toBe(1);
    expect(
      count(
        `SELECT COUNT(*) AS n FROM signup_invitations WHERE source = 'self' AND invited_by_user_id IS NULL`,
      ),
    ).toBe(1);
    expect(outboxRows()).toBe(1);
  });

  it("an address that already has a shop: the same generic 200, nothing queued", async () => {
    const res = await post(nextIp(), { email: "Taken@Example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    expect(selfInvites()).toBe(0);
    expect(outboxRows()).toBe(0);
  });

  it("the 4th request in an hour for one email: the same generic 200, nothing more queued", async () => {
    // Different IPs, so only the per-EMAIL limit is in play.
    for (let i = 0; i < 3; i += 1) {
      const res = await post(nextIp(), { email: "busy@example.com" });
      expect(res.body).toEqual(GENERIC);
    }
    expect(selfInvites("busy@example.com")).toBe(3);

    const fourth = await post(nextIp(), { email: "busy@example.com" });
    expect(fourth.status).toBe(200);
    expect(fourth.body).toEqual(GENERIC);
    expect(selfInvites("busy@example.com")).toBe(3);
    expect(outboxRows()).toBe(3);
  });

  it("daily cap reached: the same generic 200, nothing queued, and a warning is logged", async () => {
    const warn = jest.spyOn(core.authLogger, "warn");
    // Seed the cap with explicit ISO created_at (the column default's
    // format would sort below the ISO cutoff and count as zero).
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO signup_invitations
         (email, token_hash, source, expires_at, created_at, updated_at)
       VALUES (?, ?, 'self', ?, ?, ?)`,
    );
    for (let i = 0; i < DAILY_CAP; i += 1) {
      insert.run(`seed${i}@example.com`, `hash-${i}`, "2999-01-01T00:00:00.000Z", now, now);
    }

    const res = await post(nextIp(), { email: "late@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    expect(selfInvites("late@example.com")).toBe(0);
    expect(outboxRows()).toBe(0);
    expect(JSON.stringify(warn.mock.calls)).toContain("cap");
    warn.mockRestore();
  });

  it("the 6th request from one IP in an hour: 429, whatever the email", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i += 1) {
      const res = await post(ip, { email: `ip${i}@example.com` });
      expect(res.status).toBe(200);
    }
    const sixth = await post(ip, { email: "someone-else@example.com" });
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({
      success: false,
      error: "Too many requests, please try again later",
    });
    expect(selfInvites("someone-else@example.com")).toBe(0);

    // Another IP is unaffected.
    const other = await post(nextIp(), { email: "someone-else@example.com" });
    expect(other.status).toBe(200);
  });

  it("an invalid body is refused by the schema (200 success:false), nothing queued", async () => {
    const res = await request(app)
      .post("/api/auth/signup/request")
      .set("X-Forwarded-For", nextIp())
      .send({ email: "not-an-email", turnstileToken: "cf-token" });
    expect(res.body.success).toBe(false);
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(selfInvites()).toBe(0);
  });

  it("never logs the plain email address (route or service)", async () => {
    const info = jest.spyOn(core.authLogger, "info");
    const warn = jest.spyOn(core.authLogger, "warn");
    const secretEmail = "private.person@example.com";
    await post(nextIp(), { email: secretEmail });
    await post(nextIp(), { email: "Taken@Example.com" });
    const everything = JSON.stringify([
      routeLogger.info.mock.calls,
      routeLogger.warn.mock.calls,
      routeLogger.error.mock.calls,
      info.mock.calls,
      warn.mock.calls,
    ]);
    expect(everything).not.toContain(secretEmail);
    expect(everything).not.toContain("taken@example.com");
    expect(everything).toContain(core.hashToken(secretEmail));
    info.mockRestore();
    warn.mockRestore();
  });
});

describe("POST /api/auth/signup/request — LIRA-278 bot checks and shop name", () => {
  beforeEach(() => {
    turnstileConfigured = false;
  });

  function inviteRow(email: string) {
    return db
      .prepare(
        `SELECT shop_name_hint, email_outbox_id FROM signup_invitations
          WHERE source = 'self' AND email = ?`,
      )
      .get(email) as { shop_name_hint: string | null; email_outbox_id: number } | undefined;
  }

  it("honeypot filled: the SAME generic success, nothing queued, the reason logged", async () => {
    const res = await postNoTurnstile(nextIp(), {
      email: "bot@example.com",
      website: "http://spam.example",
      formElapsedMs: 10_000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    expect(selfInvites()).toBe(0);
    expect(outboxRows()).toBe(0);
    expect(JSON.stringify(routeLogger.info.mock.calls)).toContain("honeypot");
  });

  it("form submitted in under 3 seconds: the SAME generic success, nothing queued, the reason logged", async () => {
    const res = await postNoTurnstile(nextIp(), {
      email: "fast@example.com",
      formElapsedMs: 2_999,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    expect(selfInvites()).toBe(0);
    expect(outboxRows()).toBe(0);
    expect(JSON.stringify(routeLogger.info.mock.calls)).toContain("too_fast");
  });

  it("exactly 3 seconds, empty honeypot: queued", async () => {
    const res = await postNoTurnstile(nextIp(), {
      email: "human@example.com",
      website: "",
      formElapsedMs: 3_000,
    });
    expect(res.body).toEqual(GENERIC);
    expect(selfInvites("human@example.com")).toBe(1);
  });

  it("no formElapsedMs at all: the timing check is skipped, queued", async () => {
    const res = await postNoTurnstile(nextIp(), { email: "notiming@example.com" });
    expect(res.body).toEqual(GENERIC);
    expect(selfInvites("notiming@example.com")).toBe(1);
  });

  it("the shop name is stored on the invite and prefills the form, but is NOT in the email", async () => {
    const res = await postNoTurnstile(nextIp(), {
      email: "named@example.com",
      shopNameHint: "Click www.spam.example",
      formElapsedMs: 8_000,
    });
    expect(res.body).toEqual(GENERIC);
    const row = inviteRow("named@example.com");
    expect(row?.shop_name_hint).toBe("Click www.spam.example");
    const outbox = db
      .prepare(`SELECT data_json FROM email_outbox WHERE id = ?`)
      .get(row!.email_outbox_id) as { data_json: string };
    expect(outbox.data_json).not.toContain("spam.example");

    // The link's check hands the name to the sign-up form.
    const token = /invite=([A-Za-z0-9_-]+)/.exec(
      JSON.parse(outbox.data_json).inviteUrl as string,
    )?.[1];
    expect(token).toBeTruthy();
    const check = await request(app)
      .post("/api/auth/signup/invite/check")
      .set("X-Forwarded-For", nextIp())
      .send({ token });
    expect(check.body.success).toBe(true);
    expect(check.body.data.shopNameHint).toBe("Click www.spam.example");
  });

  it("Turnstile configured: still required (token missing -> 'complete the check'), bot checks come after it", async () => {
    turnstileConfigured = true;
    const res = await postNoTurnstile(nextIp(), {
      email: "needs-check@example.com",
      formElapsedMs: 8_000,
    });
    expect(res.body).toEqual({
      success: false,
      error: "Please complete the check and try again.",
    });
    expect(selfInvites()).toBe(0);
  });

  it("TEMP diagnostic: logs which forwarded headers arrived, hashed — never the raw IP or the email", async () => {
    const visitor = "203.0.113.77";
    await request(app)
      .post("/api/auth/signup/request")
      .set("X-Forwarded-For", visitor)
      .set("Fly-Client-IP", visitor)
      .send(body({ email: "diag.person@example.com", formElapsedMs: 8_000 }));
    const diagnostic = routeLogger.warn.mock.calls.find((call) =>
      JSON.stringify(call).includes("LIRA-278 client-ip"),
    );
    expect(diagnostic).toBeDefined();
    const text = JSON.stringify(diagnostic);
    expect(text).toContain("fly-client-ip");
    expect(text).not.toContain(visitor);
    expect(text).not.toContain("diag.person@example.com");
  });
});

describe("GET /api/auth/signup-status — self-serve fields", () => {
  it("selfServeEnabled + turnstileSiteKey when email and Turnstile are configured", async () => {
    const res = await request(app).get("/api/auth/signup-status");
    expect(res.body.success).toBe(true);
    expect(res.body.data.selfServeEnabled).toBe(true);
    // The real env has no site key in this suite; the field is present
    // (string or null), never undefined.
    expect(res.body.data).toHaveProperty("turnstileSiteKey");
  });

  it("selfServeEnabled false and no site key when email is off", async () => {
    emailConfigured = false;
    const res = await request(app).get("/api/auth/signup-status");
    expect(res.body.data.selfServeEnabled).toBe(false);
    expect(res.body.data.turnstileSiteKey).toBeNull();
  });

  // LIRA-278: used to assert false; Turnstile is now an optional layer.
  it("selfServeEnabled TRUE when Turnstile is off (switch on + email), and no site key", async () => {
    turnstileConfigured = false;
    const res = await request(app).get("/api/auth/signup-status");
    expect(res.body.data.selfServeEnabled).toBe(true);
    expect(res.body.data.turnstileSiteKey).toBeNull();
  });
});

describe("sign-up limiters are separate", () => {
  it("checking an invite link does not use up the /signup budget", async () => {
    const ip = nextIp();
    for (let i = 0; i < 8; i += 1) {
      const check = await request(app)
        .post("/api/auth/signup/invite/check")
        .set("X-Forwarded-For", ip)
        .send({ token: `not-a-real-token-${i}` });
      expect(check.status).toBe(200);
    }

    const signup = {
      name: "Fresh Shop",
      slug: "fresh-shop",
      adminUsername: "fresh_admin",
      adminPassword: "FreshPass123!",
      inviteToken: "not-a-real-token",
    };
    expect(core.signupSchema.safeParse(signup).success).toBe(true);
    const res = await request(app)
      .post("/api/auth/signup")
      .set("X-Forwarded-For", ip)
      .send(signup);
    // Refused for the bad link (403), NOT throttled (429).
    expect(res.status).toBe(403);
  });

  it("invite checks have their own limit (30 per hour per IP)", async () => {
    const ip = nextIp();
    for (let i = 0; i < 30; i += 1) {
      const check = await request(app)
        .post("/api/auth/signup/invite/check")
        .set("X-Forwarded-For", ip)
        .send({ token: `t-${i}` });
      expect(check.status).toBe(200);
    }
    const over = await request(app)
      .post("/api/auth/signup/invite/check")
      .set("X-Forwarded-For", ip)
      .send({ token: "t-over" });
    expect(over.status).toBe(429);
  });
});
