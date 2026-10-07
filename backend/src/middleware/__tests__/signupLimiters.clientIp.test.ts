/**
 * The sign-up limiters key on CLIENT_IP_HEADER when it is set (LIRA-278) —
 * and, since LIRA-283, only for a request carrying the Vercel proxy secret.
 *
 * Production today: every visitor reaches Fly through the same proxy, so
 * `req.ip` (trust proxy = 1) is one address for everyone and the per-IP
 * sign-up budget is shared by the whole internet. With the header set, two
 * visitors behind that one proxy get separate budgets.
 *
 * CLIENT_IP_HEADER is read from @liratek/core's env at import time, so it is
 * set before the limiters are loaded; jest gives this file its own module
 * registry.
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import express, { type Express, type RequestHandler } from "express";
import request from "supertest";

const PROXY_IP = "66.241.124.103";
const PROXY_SECRET = "lira283-test-proxy-secret-0123456789abcdef";

let limiters: typeof import("../rateLimit.js");

beforeAll(async () => {
  process.env.CLIENT_IP_HEADER = "fly-client-ip";
  process.env.CLIENT_IP_PROXY_SECRET = PROXY_SECRET;
  // Pinned: a local backend/.env may raise these.
  process.env.SIGNUP_RATE_LIMIT_MAX = "5";
  process.env.SIGNUP_REQUEST_RATE_LIMIT_MAX = "5";
  process.env.SIGNUP_CHECK_RATE_LIMIT_MAX = "30";
  limiters = await import("../rateLimit.js");
});

afterAll(() => {
  delete process.env.CLIENT_IP_HEADER;
  delete process.env.CLIENT_IP_PROXY_SECRET;
  delete process.env.SIGNUP_RATE_LIMIT_MAX;
  delete process.env.SIGNUP_REQUEST_RATE_LIMIT_MAX;
  delete process.env.SIGNUP_CHECK_RATE_LIMIT_MAX;
});

function appWith(limiter: RequestHandler): Express {
  const app = express();
  // Same as server.ts: ONE trusted hop, so req.ip is the proxy's address.
  app.set("trust proxy", 1);
  app.post("/t", limiter, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function hit(app: Express, visitor: string) {
  return request(app)
    .post("/t")
    .set("X-Forwarded-For", PROXY_IP)
    .set("x-liratek-proxy-auth", PROXY_SECRET)
    .set("Fly-Client-IP", visitor);
}

describe.each([
  ["signupRequestLimiter", 5],
  ["signupCheckLimiter", 30],
  ["signupLimiter", 5],
] as const)("%s keys on the configured client-IP header", (name, max) => {
  it(`one visitor is throttled after ${max}; another visitor behind the SAME proxy is not`, async () => {
    const app = appWith(limiters[name]);
    for (let i = 0; i < max; i += 1) {
      expect((await hit(app, "203.0.113.1")).status).toBe(200);
    }
    expect((await hit(app, "203.0.113.1")).status).toBe(429);
    expect((await hit(app, "203.0.113.2")).status).toBe(200);
  });
});
