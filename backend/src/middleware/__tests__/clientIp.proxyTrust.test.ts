/**
 * LIRA-283: every per-IP limiter must key on the REAL client, and only a
 * request that provably came through Vercel may say who the client is.
 *
 * Production (measured 2026-10-07): every session recorded
 * `ip_address = 66.241.124.103` — the address `api.liratek.shop` itself
 * resolves to — while the shop's real address was 185.187.131.199. So
 * `req.ip` (trust proxy = 1) is one shared address for every shop, and the
 * failed-login, sign-up, profits-unlock, anonymous and flood buckets are all
 * shared by every shop at once.
 *
 * `api.liratek.shop` is publicly reachable, so ANY client can call it directly
 * with forged `X-Forwarded-For` / `X-Vercel-Forwarded-For` / `X-Real-IP`. A
 * forwarded header is therefore believed only when the request also carries
 * the shared proxy secret (`x-liratek-proxy-auth` == CLIENT_IP_PROXY_SECRET),
 * which Vercel adds on its rewrite to Fly and a direct caller cannot know.
 *
 * The requests below mimic Fly: Fly appends the address that connected to
 * it, so with trust proxy = 1 `req.ip` is that LAST entry (the proxy), never
 * the forged first entry.
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
const SECRET = "lira283-test-proxy-secret-0123456789abcdef";
const SECRET_HEADER = "x-liratek-proxy-auth";

let limiters: typeof import("../rateLimit.js");

beforeAll(async () => {
  // A header name configured, as the owner might: the spoof must still fail.
  process.env.CLIENT_IP_HEADER = "x-vercel-forwarded-for";
  process.env.CLIENT_IP_PROXY_SECRET = SECRET;
  // Pinned: a local backend/.env raises some of these (dotenv never
  // overrides a variable that is already set).
  process.env.API_RATE_LIMIT_MAX = "3";
  process.env.AUTH_RATE_LIMIT_MAX = "5";
  process.env.PROFITS_UNLOCK_RATE_LIMIT_MAX = "5";
  process.env.SIGNUP_RATE_LIMIT_MAX = "5";
  process.env.SIGNUP_REQUEST_RATE_LIMIT_MAX = "5";
  limiters = await import("../rateLimit.js");
});

afterAll(() => {
  delete process.env.CLIENT_IP_HEADER;
  delete process.env.CLIENT_IP_PROXY_SECRET;
  for (const name of [
    "API_RATE_LIMIT_MAX",
    "AUTH_RATE_LIMIT_MAX",
    "PROFITS_UNLOCK_RATE_LIMIT_MAX",
    "SIGNUP_RATE_LIMIT_MAX",
    "SIGNUP_REQUEST_RATE_LIMIT_MAX",
  ]) {
    delete process.env[name];
  }
});

/** `status` is what the route answers when the limiter lets it through:
 * 401 for a login/unlock failure (counted by skipSuccessfulRequests). */
function appWith(limiter: RequestHandler, status = 200): Express {
  const app = express();
  app.set("trust proxy", 1); // as server.ts
  app.post("/t", limiter, (_req, res) => {
    res.status(status).json({ ok: status === 200 });
  });
  return app;
}

/** A request that came through Vercel: the secret plus Vercel's headers. */
function viaVercel(app: Express, client: string, secret = SECRET) {
  return request(app)
    .post("/t")
    .set(SECRET_HEADER, secret)
    .set("X-Vercel-Forwarded-For", client)
    .set("X-Real-IP", client)
    .set("X-Forwarded-For", `${client}, ${PROXY_IP}`);
}

/** A direct call to the Fly hostname with every forwarded header forged. */
function directForged(app: Express, forged: string) {
  return request(app)
    .post("/t")
    .set("X-Vercel-Forwarded-For", forged)
    .set("X-Real-IP", forged)
    .set("Fly-Client-IP", forged)
    .set("X-Forwarded-For", `${forged}, ${PROXY_IP}`);
}

describe("a direct request with forged headers cannot pick its own bucket", () => {
  it("signupRequestLimiter: rotating forged headers does not reset the budget", async () => {
    const app = appWith(limiters.signupRequestLimiter);
    for (let i = 0; i < 5; i += 1) {
      expect((await directForged(app, `198.51.100.${i + 1}`)).status).toBe(200);
    }
    expect((await directForged(app, "198.51.100.200")).status).toBe(429);
  });

  it("authLimiter: a WRONG secret is treated exactly like no secret", async () => {
    const app = appWith(limiters.authLimiter, 401);
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await viaVercel(app, `198.51.100.${i + 1}`, "not-the-secret")).status,
      ).toBe(401);
    }
    expect(
      (await viaVercel(app, "198.51.100.99", "not-the-secret")).status,
    ).toBe(429);
  });
});

describe("a Vercel-marked request is keyed by the real client", () => {
  it("authLimiter: two clients get SEPARATE failed-login buckets", async () => {
    const app = appWith(limiters.authLimiter, 401);
    for (let i = 0; i < 5; i += 1) {
      expect((await viaVercel(app, "203.0.113.1")).status).toBe(401);
    }
    expect((await viaVercel(app, "203.0.113.1")).status).toBe(429);
    // Another shop behind the same proxy is NOT locked out.
    expect((await viaVercel(app, "203.0.113.2")).status).toBe(401);
  });

  it("profitsUnlockLimiter: two clients get separate buckets", async () => {
    const app = appWith(limiters.profitsUnlockLimiter, 401);
    for (let i = 0; i < 5; i += 1) {
      expect((await viaVercel(app, "203.0.113.11")).status).toBe(401);
    }
    expect((await viaVercel(app, "203.0.113.11")).status).toBe(429);
    expect((await viaVercel(app, "203.0.113.12")).status).toBe(401);
  });

  it("signupLimiter: two clients get separate buckets", async () => {
    const app = appWith(limiters.signupLimiter);
    for (let i = 0; i < 5; i += 1) {
      expect((await viaVercel(app, "203.0.113.21")).status).toBe(200);
    }
    expect((await viaVercel(app, "203.0.113.21")).status).toBe(429);
    expect((await viaVercel(app, "203.0.113.22")).status).toBe(200);
  });

  it("apiLimiter (anonymous bucket): two clients get separate buckets", async () => {
    const app = appWith(limiters.apiLimiter);
    for (let i = 0; i < 3; i += 1) {
      expect((await viaVercel(app, "203.0.113.31")).status).toBe(200);
    }
    expect((await viaVercel(app, "203.0.113.31")).status).toBe(429);
    expect((await viaVercel(app, "203.0.113.32")).status).toBe(200);
  });
});
