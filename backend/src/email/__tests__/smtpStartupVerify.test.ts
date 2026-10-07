/**
 * A wrong SMTP password is caught at startup, not at the first invite
 * (LIRA-267).
 *
 * Before this, a mistyped SMTP_PASS left email reading as ON: the admin
 * could send invites, every one failed permanently in the outbox, and the
 * only sign was a red "failed" badge later. Now the worker checks the login
 * once in the background after boot:
 *
 *   - the server refuses the login (EAUTH / 535)  -> email switches OFF, the
 *     same single switch a missing variable uses: admin invites answer 409
 *     EMAIL_NOT_CONFIGURED and signup-status reads emailInvitesEnabled false;
 *   - anything else (network, timeout, a 4xx such as 454)  -> only a warning,
 *     email stays ON, because that can clear up on its own;
 *   - success  -> email stays ON.
 *
 * Boot is never blocked and nothing is thrown. No secret reaches the log.
 *
 * The env is the real one an operator sets (full smtp config), parsed by
 * core exactly as production would; only nodemailer is mocked, so no
 * network is touched. Routes, service and repositories run for real against
 * an in-memory database built from create_db.sql.
 */

import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

type VerifyFn = () => Promise<true>;
type SendMailFn = (
  options: Record<string, unknown>,
) => Promise<{ messageId: string }>;

const mockVerify = jest.fn<VerifyFn>();
const mockSendMail = jest.fn<SendMailFn>();

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: () => ({
      verify: () => mockVerify(),
      sendMail: (options: Record<string, unknown>) => mockSendMail(options),
    }),
  },
}));

const PASSWORD = "Password123!";
const SMTP_USER = "mail@liratek.test";
const SMTP_PASS = "wr0ng-mailbox-pass";
const ENV_KEYS = [
  "EMAIL_TRANSPORT",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "APP_BASE_DOMAIN",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "JWT_SECRET",
] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

process.env.EMAIL_TRANSPORT = "smtp";
process.env.SMTP_HOST = "mail.spacemail.test";
process.env.SMTP_PORT = "465";
process.env.SMTP_USER = SMTP_USER;
process.env.SMTP_PASS = SMTP_PASS;
process.env.APP_BASE_DOMAIN = "liratek.test";
process.env.TURNSTILE_SITE_KEY = "site-key";
process.env.TURNSTILE_SECRET_KEY = "secret-key";
process.env.JWT_SECRET = "smtp-startup-verify-test-secret-0123456789-0123";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let app: Express;
let request: typeof import("supertest");
let worker: typeof import("../outboxWorker.js");
let transportModule: typeof import("../createTransport.js");

/** An error shaped like the ones nodemailer rejects with. */
function smtpError(
  message: string,
  fields: { code?: string; responseCode?: number; response?: string },
): Error {
  return Object.assign(new Error(message), fields);
}

beforeAll(async () => {
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;

  const fs = await import("node:fs");
  const path = await import("node:path");
  core = await import("@liratek/core");
  db.exec(
    fs.readFileSync(
      path.join(__dirname, "../../../../electron-app/create_db.sql"),
      "utf8",
    ),
  );
  db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
     VALUES (NULL, 'root', ?, 'super_admin', 1)`,
  ).run(core.hashPassword(PASSWORD));
  for (const reset of [
    core.resetUserRepository,
    core.resetSessionRepository,
    core.resetAuthService,
    core.resetTenantRepository,
    core.resetAuditRepository,
    core.resetAuditService,
    core.resetSignupInvitationRepository,
    core.resetEmailOutboxRepository,
    core.resetSignupInvitationService,
  ]) {
    reset();
  }

  worker = await import("../outboxWorker.js");
  transportModule = await import("../createTransport.js");
  request = (await import("supertest")).default;
  const express = (await import("express")).default;
  const authRoutes = (await import("../../api/auth")).default;
  const adminRoutes = (await import("../../api/admin")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
});

afterAll(() => {
  worker?.stopEmailOutbox();
  db?.close();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

let errorLog: ReturnType<typeof jest.spyOn>;
let warnLog: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  worker.stopEmailOutbox();
  // Each case starts from an empty outbox, so a row a previous case queued
  // cannot be picked up by this case's first worker run.
  db.exec(`DELETE FROM signup_invitations; DELETE FROM email_outbox;`);
  transportModule.resetEmailTransportState();
  mockVerify.mockReset();
  mockSendMail.mockReset();
  errorLog = jest.spyOn(core.emailLogger, "error").mockImplementation(() => {});
  warnLog = jest.spyOn(core.emailLogger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
  warnLog.mockRestore();
});

/** Starts the worker the way server.ts does and waits for the background
 * login check to settle. */
async function boot(): Promise<void> {
  let result: unknown;
  expect(() => {
    result = worker.startEmailOutbox();
  }).not.toThrow();
  await result;
}

function loggedText(): string {
  return JSON.stringify([...errorLog.mock.calls, ...warnLog.mock.calls]);
}

async function adminInvite() {
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "root", password: PASSWORD });
  expect(login.status).toBe(200);
  return request(app)
    .post("/api/admin/signup-invitations")
    .set("Authorization", `Bearer ${login.body.data.token as string}`)
    .send({ email: `someone-${Date.now()}@example.com` });
}

describe("SMTP login checked once at startup", () => {
  describe("the server rejects the login (EAUTH 535)", () => {
    beforeEach(() => {
      mockVerify.mockRejectedValue(
        smtpError(`Invalid login: 535 Authentication failed for ${SMTP_USER}`, {
          code: "EAUTH",
          responseCode: 535,
          response: `535 Authentication failed for ${SMTP_USER}`,
        }),
      );
    });

    it("switches email OFF and says so clearly, without any secret", async () => {
      await boot();

      expect(mockVerify).toHaveBeenCalledTimes(1);
      expect(transportModule.isEmailConfigured()).toBe(false);
      const errors = JSON.stringify(errorLog.mock.calls);
      expect(errors).toContain(
        "SMTP login failed at startup — check SMTP_USER/SMTP_PASS; email is OFF",
      );
      const all = loggedText();
      expect(all).not.toContain(SMTP_PASS);
      expect(all).not.toContain(SMTP_USER);
    });

    it("admin invite -> 409 EMAIL_NOT_CONFIGURED; nothing queued", async () => {
      await boot();
      const before = db
        .prepare(`SELECT COUNT(*) AS n FROM email_outbox`)
        .get() as {
        n: number;
      };

      const res = await adminInvite();

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("EMAIL_NOT_CONFIGURED");
      const after = db
        .prepare(`SELECT COUNT(*) AS n FROM email_outbox`)
        .get() as {
        n: number;
      };
      expect(after.n).toBe(before.n);
    });

    it("signup-status -> emailInvitesEnabled false", async () => {
      await boot();
      const res = await request(app).get("/api/auth/signup-status").expect(200);
      expect(res.body.data.emailInvitesEnabled).toBe(false);
      expect(res.body.data.selfServeEnabled).toBe(false);
    });

    it("the worker sends nothing", async () => {
      await boot();
      const summary = await worker.runOutboxOnce();
      expect(summary).toEqual({
        accepted: 0,
        retried: 0,
        failed: 0,
        skipped: 0,
      });
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  it("a 535 reply without the EAUTH code also switches email OFF", async () => {
    mockVerify.mockRejectedValue(
      smtpError("Authentication failed", { responseCode: 535 }),
    );
    await boot();
    expect(transportModule.isEmailConfigured()).toBe(false);
  });

  describe("anything else only warns and leaves email ON", () => {
    it.each([
      [
        "a network failure",
        smtpError("connect ECONNREFUSED", { code: "ECONNECTION" }),
      ],
      ["a timeout", smtpError("Connection timeout", { code: "ETIMEDOUT" })],
      [
        "a temporary 454 auth failure",
        smtpError("454 Temporary authentication failure", {
          code: "EAUTH",
          responseCode: 454,
        }),
      ],
    ])("%s", async (_label, error) => {
      mockVerify.mockRejectedValue(error);

      await boot();

      expect(transportModule.isEmailConfigured()).toBe(true);
      expect(errorLog).not.toHaveBeenCalled();
      expect(warnLog).toHaveBeenCalled();
      const all = loggedText();
      expect(all).not.toContain(SMTP_PASS);
    });
  });

  it("a successful login leaves email ON with no warning", async () => {
    mockVerify.mockResolvedValue(true);

    await boot();

    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(transportModule.isEmailConfigured()).toBe(true);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
    const res = await request(app).get("/api/auth/signup-status").expect(200);
    expect(res.body.data.emailInvitesEnabled).toBe(true);
  });

  it("a verify that throws synchronously never escapes startEmailOutbox", async () => {
    mockVerify.mockImplementation(() => {
      throw new Error("boom");
    });
    await boot();
    expect(transportModule.isEmailConfigured()).toBe(true);
  });
});
