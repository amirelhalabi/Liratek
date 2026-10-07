/**
 * LIRA-282 — per-user API rate limiting.
 *
 * A shop's tills share one internet connection, so the general API limiter
 * used to put every till in ONE per-IP bucket: a page load is ~25–30
 * requests, so a few tills loading pages together exhausted it and every till
 * saw "Failed to load data". The general limiter (`apiLimiter`, mounted on
 * `/api/` in server.ts) now keys AUTHENTICATED traffic by the identity in a
 * VERIFIED token (tenant + user) and keeps per-IP keying for everything else.
 *
 * Driven through the same `apiLimiter` export server.ts mounts, with small
 * env-tuned limits loaded via `jest.isolateModules` so each test gets fresh
 * limiter stores. Supertest traffic all comes from 127.0.0.1 — exactly the
 * "one shop, one IP" case.
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

const SECRET = "test-secret-at-least-32-characters-long!";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    JWT_SECRET: SECRET,
    JWT_EXPIRES_IN: "7d",
  };
});

import express, { type Express, type RequestHandler } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const RATE_LIMIT_MESSAGE =
  "Too many requests — please wait a minute and try again.";

const ANON_MAX = 3;
const USER_MAX = 5;
const FLOOD_MAX = 8;

type RateLimitModule = typeof import("../rateLimit.js");

function loadRateLimit(): RateLimitModule {
  let mod: RateLimitModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../rateLimit.js") as RateLimitModule;
  });
  if (!mod) throw new Error("rateLimit module failed to load");
  return mod;
}

function appWith(limiter: RequestHandler): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/", limiter);
  app.get("/api/thing", (_req, res) => res.status(200).json({ ok: true }));
  app.post("/api/auth/login", (_req, res) =>
    res.status(401).json({ success: false, error: "bad creds" }),
  );
  return app;
}

function tokenFor(
  userId: number,
  tenantId: number | null,
  secret: string = SECRET,
): string {
  return jwt.sign(
    {
      userId,
      role: tenantId === null ? "super_admin" : "admin",
      sessionToken: `session-${userId}`,
      tenantId,
    },
    secret,
    { expiresIn: "1h" },
  );
}

async function hit(app: Express, n: number, token?: string): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) {
    const req = request(app).get("/api/thing");
    if (token) req.set("Authorization", `Bearer ${token}`);
    statuses.push((await req).status);
  }
  return statuses;
}

const ENV_KEYS = [
  "API_RATE_LIMIT_MAX",
  "API_USER_RATE_LIMIT_MAX",
  "API_IP_FLOOD_RATE_LIMIT_MAX",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.API_RATE_LIMIT_MAX = String(ANON_MAX);
  process.env.API_USER_RATE_LIMIT_MAX = String(USER_MAX);
  process.env.API_IP_FLOOD_RATE_LIMIT_MAX = String(FLOOD_MAX);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("apiLimiter — per-user buckets for authenticated traffic (LIRA-282)", () => {
  it("gives two users behind the same IP each their own budget", async () => {
    const app = appWith(loadRateLimit().apiLimiter);
    const a = tokenFor(1, 7);
    const b = tokenFor(2, 7);

    // USER_MAX (5) is above the anonymous per-IP cap (3): under per-IP
    // keying user A would already be refused on request 4.
    expect(await hit(app, USER_MAX, a)).toEqual(Array(USER_MAX).fill(200));
    expect(await hit(app, USER_MAX - 2, b)).toEqual(
      Array(USER_MAX - 2).fill(200),
    );
  });

  it("does not let the same user id in ANOTHER tenant share a bucket", async () => {
    const app = appWith(loadRateLimit().apiLimiter);
    expect(await hit(app, USER_MAX, tokenFor(1, 7))).toEqual(
      Array(USER_MAX).fill(200),
    );
    // Same user id 1, different shop: a fresh budget.
    expect((await hit(app, 1, tokenFor(1, 8)))[0]).toBe(200);
  });

  it("answers 429 with the clear message once ONE user exceeds their budget", async () => {
    const app = appWith(loadRateLimit().apiLimiter);
    const a = tokenFor(1, 7);
    await hit(app, USER_MAX, a);

    const res = await request(app)
      .get("/api/thing")
      .set("Authorization", `Bearer ${a}`);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      success: false,
      error: RATE_LIMIT_MESSAGE,
    });

    // ...and the other till in the same shop is unaffected.
    expect((await hit(app, 1, tokenFor(2, 7)))[0]).toBe(200);
  });

  it("caps total authenticated traffic per IP with a looser flood limit", async () => {
    const app = appWith(loadRateLimit().apiLimiter);
    // A: 5 (own cap), B: 3 → 8 = FLOOD_MAX across the IP.
    expect(await hit(app, USER_MAX, tokenFor(1, 7))).toEqual(
      Array(USER_MAX).fill(200),
    );
    expect(await hit(app, FLOOD_MAX - USER_MAX, tokenFor(2, 7))).toEqual(
      Array(FLOOD_MAX - USER_MAX).fill(200),
    );
    const res = await request(app)
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenFor(3, 7)}`);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      success: false,
      error: RATE_LIMIT_MESSAGE,
    });
  });

  it("reports the PER-USER limit in RateLimit headers, not the shop-wide flood cap", async () => {
    const app = appWith(loadRateLimit().apiLimiter);
    const res = await request(app)
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenFor(1, 7)}`);
    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBe(String(USER_MAX));
  });

  it("keeps unauthenticated requests on the strict per-IP bucket", async () => {
    const app = appWith(loadRateLimit().apiLimiter);
    expect(await hit(app, ANON_MAX)).toEqual(Array(ANON_MAX).fill(200));
    const res = await request(app).get("/api/thing");
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
  });

  it("does not give a forged or invalid token a fresh per-user bucket", async () => {
    const app = appWith(loadRateLimit().apiLimiter);
    // Exhaust the anonymous per-IP bucket.
    await hit(app, ANON_MAX);

    const forged = tokenFor(99, 7, "attacker-chosen-secret-0123456789abcdef");
    const unsigned = jwt.sign(
      { userId: 98, role: "admin", sessionToken: "x", tenantId: 7 },
      "",
      { algorithm: "none" },
    );
    for (const bad of [forged, unsigned, "not-a-jwt"]) {
      const res = await request(app)
        .get("/api/thing")
        .set("Authorization", `Bearer ${bad}`);
      expect(res.status).toBe(429);
    }
  });

  it("does not attach an identity to req.user (auth is still authenticateJWT's job)", async () => {
    const app = express();
    app.use("/api/", loadRateLimit().apiLimiter);
    app.get("/api/thing", (req, res) =>
      res.status(200).json({ hasUser: req.user !== undefined }),
    );
    const res = await request(app)
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenFor(1, 7)}`);
    expect(res.status).toBe(200);
    expect(res.body.hasUser).toBe(false);
  });
});

describe("authLimiter — login stays strictly per-IP (LIRA-282)", () => {
  it("does not split the login bucket by bearer token", async () => {
    const { authLimiter } = loadRateLimit();
    const app = express();
    app.use(express.json());
    app.post("/login", authLimiter, (_req, res) =>
      res.status(401).json({ success: false, error: "bad creds" }),
    );
    const max = Number(process.env.AUTH_RATE_LIMIT_MAX) || 5;
    for (let i = 0; i < max; i++) {
      await request(app)
        .post("/login")
        .set("Authorization", `Bearer ${tokenFor(1, 7)}`);
    }
    const res = await request(app)
      .post("/login")
      .set("Authorization", `Bearer ${tokenFor(2, 7)}`);
    expect(res.status).toBe(429);
  });
});
