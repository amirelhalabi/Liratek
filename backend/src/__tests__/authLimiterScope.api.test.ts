/**
 * The login throttle must throttle LOGINS — and nothing else.
 *
 * `authLimiter` used to be mounted on the whole `/api/auth` router:
 *
 *     app.use("/api/auth", authLimiter, authRoutes);
 *
 * It counts FAILED requests (`skipSuccessfulRequests: true`), and
 * `GET /api/auth/me` answers 401 on every page load while logged out. So each
 * visit to the login page burned a slot, and after roughly five of them a
 * visitor who had never typed a password was locked out for 15 minutes — with
 * "Too many login attempts from this IP". Worse, `signup-status` was throttled
 * by the same counter, and the login page needs it to render, so the app could
 * not even bootstrap.
 *
 * Found in production while diagnosing "I can't log in on the test tenant".
 *
 * These use a REAL rate limiter with max: 2 so the exhaustion is genuine
 * rather than mocked — mocking the limiter would test nothing about mounting,
 * which is the entire bug.
 */

import { jest } from "@jest/globals";

jest.mock("../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";

/** A stand-in for authLimiter with the same options that caused the bug. */
function makeLimiter() {
  return rateLimit({
    windowMs: 60_000,
    max: 2,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many login attempts from this IP" },
  });
}

/** The router shape: a failing /me, a public /signup-status, and /login. */
function makeRouter(limiter?: express.RequestHandler): express.Router {
  const r = express.Router();
  // Mirrors reality: unauthenticated /me is a 401, i.e. a "failed" request.
  r.get("/me", (_req, res) => {
    res.status(401).json({ error: "Unauthorized" });
  });
  r.get("/signup-status", (_req, res) => {
    res.json({ success: true, data: { enabled: true } });
  });
  const loginHandlers = limiter ? [limiter] : [];
  r.post("/login", ...loginHandlers, (_req, res) => {
    res.status(401).json({ error: "Invalid credentials" });
  });
  return r;
}

function appWithRouterLevelLimiter(): Express {
  const app = express();
  app.use(express.json());
  // THE OLD, BROKEN MOUNTING.
  app.use("/api/auth", makeLimiter(), makeRouter());
  return app;
}

function appWithRouteLevelLimiter(): Express {
  const app = express();
  app.use(express.json());
  // THE FIX: the limiter lives on /login inside the router.
  app.use("/api/auth", makeRouter(makeLimiter()));
  return app;
}

describe("auth rate limiting — scope", () => {
  it("REGRESSION: router-level mounting let logged-out page loads lock out login", async () => {
    const app = appWithRouterLevelLimiter();

    // Two ordinary page loads while signed out. No login attempted.
    await request(app).get("/api/auth/me").expect(401);
    await request(app).get("/api/auth/me").expect(401);

    // The quota is already gone — the THIRD page load is itself refused, even
    // though loading a login page is not a login attempt.
    const thirdPageLoad = await request(app).get("/api/auth/me");
    expect(thirdPageLoad.status).toBe(429);

    // And when the visitor finally types their password for the first time,
    // they are locked out. This is the behaviour that shipped.
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(429);
  });

  it("route-level mounting leaves /me alone, so login still works", async () => {
    const app = appWithRouteLevelLimiter();

    await request(app).get("/api/auth/me").expect(401);
    await request(app).get("/api/auth/me").expect(401);
    await request(app).get("/api/auth/me").expect(401);

    // The first real login attempt reaches the handler and gets a real answer.
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(401);
  });

  it("signup-status stays reachable — the login page needs it to render", async () => {
    const app = appWithRouteLevelLimiter();

    for (let i = 0; i < 5; i++) await request(app).get("/api/auth/me").expect(401);

    // Under the old mounting this returned 429 and the page could not even
    // decide whether to show the "Create your shop" link.
    await request(app).get("/api/auth/signup-status").expect(200);
  });

  it("still throttles genuine repeated login failures", async () => {
    const app = appWithRouteLevelLimiter();

    // The protection itself must survive the fix: max is 2.
    await request(app).post("/api/auth/login").send({}).expect(401);
    await request(app).post("/api/auth/login").send({}).expect(401);
    const third = await request(app).post("/api/auth/login").send({});
    expect(third.status).toBe(429);
  });
});
