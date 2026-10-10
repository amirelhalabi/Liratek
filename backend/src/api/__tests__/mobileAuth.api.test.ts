/**
 * POST /api/mobile/auth/login — the phone app's sign-in by shop address
 * (LIRA-289, T016; contracts/mobile-api.md).
 *
 * Supertest over a REAL in-memory SQLite database built from create_db.sql:
 * the router, MobileAuthService, AuthService, the repositories and the real
 * failed-login limiter all run. Each test sends its own client IP (the
 * limiter counts failures per IP; CLIENT_IP_HEADER is believed only with the
 * proxy secret, LIRA-283).
 *
 * Request bodies are parsed through the core schema first (rule 24).
 *
 * Rule 17: NOT proven failing-first. The route and service were written
 * before this suite (2026-10-10), so these tests were never seen failing
 * against code without the feature.
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const PROXY_SECRET = "lira289-test-proxy-secret-0123456789abcdef";
const INVALID = {
  success: false,
  error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" },
};

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

function login(body: { shop: string; username: string; password: string; deviceName?: string }, ip = nextIp()) {
  expect(core.mobileLoginSchema.safeParse(body).success).toBe(true);
  return request(app)
    .post("/api/mobile/auth/login")
    .set("x-liratek-proxy-auth", PROXY_SECRET)
    .set("fly-client-ip", ip)
    .send(body);
}

const sessionsFor = (userId: number) =>
  db
    .prepare(`SELECT device_type, device_info FROM sessions WHERE user_id = ?`)
    .all(userId) as { device_type: string; device_info: string }[];

beforeAll(async () => {
  process.env.JWT_SECRET = "mobile-auth-test-secret-0123456789-0123456789";
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

  // Two shops with the SAME admin username and different passwords, a staff
  // user, and a suspended shop.
  const insertUser = db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
  );
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (2, 'Corner Tech', 'cornertech', 'active'),
      (3, 'Beta Phones', 'beta', 'active'),
      (4, 'Closed Shop', 'closed', 'suspended');
  `);
  insertUser.run(20, 2, "admin", core.hashPassword("Corner#2026"), "admin");
  insertUser.run(21, 2, "cashier", core.hashPassword("Cashier#2026"), "staff");
  insertUser.run(30, 3, "admin", core.hashPassword("Beta#2026"), "admin");
  insertUser.run(40, 4, "admin", core.hashPassword("Closed#2026"), "admin");

  const routes = (await import("../mobileAuth")).default;
  app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/mobile/auth", routes);
});

afterAll(() => {
  db.close();
  delete process.env.CLIENT_IP_PROXY_SECRET;
});

beforeEach(() => {
  core.resetTenantContext();
  db.exec(`DELETE FROM sessions`);
});

describe("POST /api/mobile/auth/login", () => {
  it("signs an admin in to the shop named by its address, with a mobile session", async () => {
    const res = await login({ shop: "cornertech", username: "admin", password: "Corner#2026", deviceName: "Rami's phone" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.shop).toEqual({ slug: "cornertech", name: "Corner Tech" });
    expect(res.body.data.user).toMatchObject({ id: 20, username: "admin", role: "admin" });
    expect(typeof res.body.data.token).toBe("string");
    expect(sessionsFor(20)).toEqual([{ device_type: "mobile", device_info: "Rami's phone" }]);
  });

  it("matches the shop address case-insensitively", async () => {
    const res = await login({ shop: "  CornerTech ", username: "admin", password: "Corner#2026" });
    expect(res.status).toBe(200);
    expect(res.body.data.shop.slug).toBe("cornertech");
  });

  it("checks the username inside that shop only: the same 'admin' in another shop does not get in", async () => {
    // Beta's admin password, addressed at Corner Tech.
    const res = await login({ shop: "cornertech", username: "admin", password: "Beta#2026" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID);
    expect(sessionsFor(20)).toEqual([]);
    expect(sessionsFor(30)).toEqual([]);
  });

  it("answers an unknown shop, a wrong password and a suspended shop with the identical generic refusal", async () => {
    const unknownShop = await login({ shop: "nosuchshop", username: "admin", password: "Corner#2026" });
    const wrongPassword = await login({ shop: "cornertech", username: "admin", password: "wrong" });
    const suspended = await login({ shop: "closed", username: "admin", password: "Closed#2026" });
    for (const res of [unknownShop, wrongPassword, suspended]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID);
    }
    // The suspended shop's correct login created a session; it must be revoked.
    expect(sessionsFor(40)).toEqual([]);
  });

  it("refuses a staff user with ADMIN_ONLY and leaves no session behind", async () => {
    const res = await login({ shop: "cornertech", username: "cashier", password: "Cashier#2026" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_ONLY");
    expect(sessionsFor(21)).toEqual([]);
  });

  it("rejects a body without a shop address (validation envelope, HTTP 200 per rule 19c) and creates no session", async () => {
    const res = await request(app)
      .post("/api/mobile/auth/login")
      .set("x-liratek-proxy-auth", PROXY_SECRET)
      .set("fly-client-ip", nextIp())
      .send({ username: "admin", password: "Corner#2026" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(sessionsFor(20)).toEqual([]);
  });
});
