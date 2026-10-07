/**
 * LIRA-283: a web login records the RESOLVED client IP on its session, not
 * the proxy address every shop shares (measured in production: every session
 * on cornertech had ip_address = 66.241.124.103).
 *
 * The route hands `ipAddress` to `authService.login()`, which writes it to
 * `sessions.ip_address`; the stub captures it. A direct request with forged
 * forwarded headers must still record `req.ip`.
 */
import { jest } from "@jest/globals";

jest.mock("../../middleware/rateLimit.js", () => ({
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  signupLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  signupCheckLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  signupRequestLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../middleware/tenantHost.js", () => ({
  resolveTenantHost: () => ({ kind: "disabled" }),
  isHostTenancyActive: () => false,
  NO_SUCH_REALM: -1,
}));

let capturedIp: unknown;

const login = jest.fn(async (...args: unknown[]) => {
  capturedIp = (args[2] as { ipAddress?: unknown }).ipAddress;
  return {
    success: true,
    user: { id: 42, username: "amir", role: "admin", tenant_id: 7 },
    token: "session-token",
  };
});

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getAuthService: () => ({ login, logout: jest.fn(async () => true) }),
    JWT_SECRET: "auth-sessionip-secret-0123456789-0123456789-0123456789",
    JWT_EXPIRES_IN: "7d",
  };
});

import express, { type Express } from "express";
import request from "supertest";
import authRoutes from "../auth.js";

const PROXY_IP = "66.241.124.103";
const SECRET = "lira283-test-proxy-secret-0123456789abcdef";

function buildApp(): Express {
  const app = express();
  app.set("trust proxy", 1); // as server.ts
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

function post() {
  return request(buildApp())
    .post("/api/auth/login")
    .send({ username: "amir", password: "Str0ng-Password!" });
}

beforeAll(() => {
  process.env.CLIENT_IP_PROXY_SECRET = SECRET;
});
afterAll(() => {
  delete process.env.CLIENT_IP_PROXY_SECRET;
});
beforeEach(() => {
  capturedIp = undefined;
  login.mockClear();
});

it("a login that came through Vercel records the real client IP", async () => {
  await post()
    .set("x-liratek-proxy-auth", SECRET)
    .set("X-Vercel-Forwarded-For", "185.187.131.199")
    .set("X-Forwarded-For", `185.187.131.199, ${PROXY_IP}`)
    .expect(200);
  expect(login).toHaveBeenCalledTimes(1);
  expect(capturedIp).toBe("185.187.131.199");
});

it("a direct login with forged headers records req.ip, not the forged value", async () => {
  await post()
    .set("X-Vercel-Forwarded-For", "198.51.100.66")
    .set("X-Real-IP", "198.51.100.66")
    .set("X-Forwarded-For", `198.51.100.66, ${PROXY_IP}`)
    .expect(200);
  expect(capturedIp).toBe(PROXY_IP);
});
