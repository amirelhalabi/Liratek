/**
 * LIRA-278: self-serve sign-up is behind ONE switch, SIGNUP_SELF_SERVE_ENABLED.
 *
 * With the switch unset, email working AND Turnstile configured, a visitor
 * still cannot ask for a link, and the login page is not told to offer one.
 * Before LIRA-278, Turnstile keys alone turned self-serve on.
 *
 * Its own file because the switch is read from @liratek/core's env once, at
 * import; signupRequest.api.test.ts covers the switch ON.
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

jest.mock("../../email/createTransport.js", () => ({
  isEmailConfigured: () => true,
  createTransport: () => {
    throw new Error("not used in this suite");
  },
}));

const verifyTurnstile = jest.fn(async () => "passed" as const);
jest.mock("../../security/turnstile.js", () => ({
  isTurnstileConfigured: () => true,
  verifyTurnstile: () => verifyTurnstile(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");

beforeAll(async () => {
  process.env.JWT_SECRET = "signup-off-test-secret-0123456789-0123456789-xx";
  process.env.APP_BASE_DOMAIN = "liratek.test";
  // Pinned empty, not deleted: core loads .env files with dotenv, which
  // never overrides a variable that is already set, so a developer's local
  // SIGNUP_SELF_SERVE_ENABLED=true cannot flip this test. "" reads as off,
  // exactly like unset.
  process.env.SIGNUP_SELF_SERVE_ENABLED = "";

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
});

describe("SIGNUP_SELF_SERVE_ENABLED unset (the default)", () => {
  it("the switch reads false", () => {
    expect(core.SIGNUP_SELF_SERVE_ENABLED).toBe(false);
  });

  it("POST /signup/request: 'not available' even with email and Turnstile configured; nothing queued", async () => {
    const input = {
      email: "visitor@example.com",
      turnstileToken: "cf-token",
      formElapsedMs: 8_000,
    };
    expect(core.requestSignupLinkSchema.safeParse(input).success).toBe(true);
    const res = await request(app)
      .post("/api/auth/signup/request")
      .set("X-Forwarded-For", "198.51.100.200")
      .send(input);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Sign-up is not available right now.",
    });
    expect(verifyTurnstile).not.toHaveBeenCalled();
    const n = (
      db.prepare(`SELECT COUNT(*) AS n FROM signup_invitations`).get() as {
        n: number;
      }
    ).n;
    expect(n).toBe(0);
  });

  it("GET /signup-status: selfServeEnabled false and no site key", async () => {
    const res = await request(app).get("/api/auth/signup-status");
    expect(res.body.success).toBe(true);
    expect(res.body.data.selfServeEnabled).toBe(false);
    expect(res.body.data.turnstileSiteKey).toBeNull();
  });
});
