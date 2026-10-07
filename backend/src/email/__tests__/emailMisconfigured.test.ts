/**
 * A broken mail configuration must never take the API down, and must never
 * let invites queue up that cannot be sent (LIRA-267).
 *
 * The state under test is the real one an operator creates with a typo:
 * `EMAIL_TRANSPORT=smtp` with `SMTP_PASS` missing. Nothing email-related is
 * stubbed — the env is set BEFORE @liratek/core is first imported, so core
 * parses it exactly as production would, and the real transport resolution,
 * worker, routes, service and repositories run against an in-memory
 * database built from create_db.sql.
 */

import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const PASSWORD = "Password123!";
const SMTP_ENV_KEYS = [
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
for (const key of SMTP_ENV_KEYS) savedEnv[key] = process.env[key];

// Everything is configured EXCEPT the SMTP password. An empty value reads as
// unset (env.ts emptyToUndefined) and blocks dotenv from filling it in.
process.env.EMAIL_TRANSPORT = "smtp";
process.env.SMTP_HOST = "mail.spacemail.test";
process.env.SMTP_PORT = "465";
process.env.SMTP_USER = "mail@liratek.test";
process.env.SMTP_PASS = "";
process.env.APP_BASE_DOMAIN = "liratek.test";
// Turnstile IS configured, so self-serve being off can only be email's doing.
process.env.TURNSTILE_SITE_KEY = "site-key";
process.env.TURNSTILE_SECRET_KEY = "secret-key";
process.env.JWT_SECRET = "email-misconfigured-test-secret-0123456789-0123";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let app: Express;
let request: typeof import("supertest");
let worker: typeof import("../outboxWorker.js");
let transportModule: typeof import("../createTransport.js");

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
  for (const key of SMTP_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("EMAIL_TRANSPORT=smtp with SMTP_PASS missing", () => {
  it("startEmailOutbox() does not throw, logs which variable is missing, and email reads as OFF", () => {
    const logged = jest.spyOn(core.emailLogger, "error").mockImplementation(() => {});

    expect(() => worker.startEmailOutbox()).not.toThrow();

    expect(transportModule.isEmailConfigured()).toBe(false);
    // The config error names the variable, never a value.
    const messages = JSON.stringify(logged.mock.calls);
    expect(messages).toContain("SMTP_PASS");
    expect(messages).not.toContain("mail@liratek.test");
    expect(messages).not.toContain("mail.spacemail.test");
    logged.mockRestore();
  });

  it("the worker never sends: a run sees no usable transport and touches no row", async () => {
    const summary = await worker.runOutboxOnce();
    expect(summary).toEqual({ accepted: 0, retried: 0, failed: 0, skipped: 0 });
  });

  it("admin POST /signup-invitations -> 409 EMAIL_NOT_CONFIGURED; nothing queued", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: "root", password: PASSWORD });
    expect(login.status).toBe(200);

    const res = await request(app)
      .post("/api/admin/signup-invitations")
      .set("Authorization", `Bearer ${login.body.data.token as string}`)
      .send({ email: "someone@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("EMAIL_NOT_CONFIGURED");
    const queued = db.prepare(`SELECT COUNT(*) AS n FROM email_outbox`).get() as {
      n: number;
    };
    expect(queued.n).toBe(0);
  });

  it("signup-status -> emailInvitesEnabled false and selfServeEnabled false", async () => {
    const res = await request(app).get("/api/auth/signup-status").expect(200);
    expect(res.body.data.emailInvitesEnabled).toBe(false);
    expect(res.body.data.selfServeEnabled).toBe(false);
    expect(res.body.data.turnstileSiteKey).toBeNull();
  });
});
