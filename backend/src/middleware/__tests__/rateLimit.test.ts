/**
 * Rate Limiting Middleware Tests
 *
 * Verifies all four rate-limit tiers enforce their limits correctly,
 * return proper 429 responses, and include standard RateLimit headers.
 */

import { jest } from "@jest/globals";

// Mock the logger used inside rateLimit.ts (re-exported from server.ts -> @liratek/core)
jest.mock("../../server.js", () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import express, { type Express } from "express";
import request from "supertest";
import {
  apiLimiter,
  authLimiter,
  strictLimiter,
  readLimiter,
} from "../rateLimit.js";

function createApp(limiter: express.RequestHandler): Express {
  const app = express();
  app.use(express.json());
  app.use(limiter);
  app.get("/test", (_req, res) => res.status(200).json({ ok: true }));
  app.post("/test", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("Rate Limiting Middleware", () => {
  describe("apiLimiter (100 req / 15 min)", () => {
    let app: Express;

    beforeEach(() => {
      app = createApp(apiLimiter);
    });

    it("allows requests under the limit", async () => {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
    });

    it("returns RateLimit headers", async () => {
      const res = await request(app).get("/test");
      expect(res.headers).toHaveProperty("ratelimit-limit");
      expect(res.headers).toHaveProperty("ratelimit-remaining");
    });

    it("returns 429 after 100 requests", async () => {
      for (let i = 0; i < 100; i++) {
        await request(app).get("/test");
      }
      const res = await request(app).get("/test");
      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.retryAfter).toBe("15 minutes");
    });
  });

  describe("authLimiter (5 failed req / 15 min, skipSuccessfulRequests)", () => {
    it("does not count successful (2xx) requests toward the limit", async () => {
      const app = express();
      app.use(express.json());
      app.use(authLimiter);
      // Successful endpoint
      app.post("/login", (_req, res) => res.status(200).json({ ok: true }));

      // 10 successful requests should all pass
      for (let i = 0; i < 10; i++) {
        const res = await request(app).post("/login");
        expect(res.status).toBe(200);
      }
    });

    it("returns 429 after 5 failed requests", async () => {
      const app = express();
      app.use(express.json());
      app.use(authLimiter);
      // Failed endpoint (401)
      app.post("/login", (_req, res) =>
        res.status(401).json({ error: "bad creds" }),
      );

      for (let i = 0; i < 5; i++) {
        await request(app).post("/login");
      }
      const res = await request(app).post("/login");
      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
    });
  });

  describe("strictLimiter (10 req / 15 min)", () => {
    let app: Express;

    beforeEach(() => {
      app = createApp(strictLimiter);
    });

    it("allows requests under the limit", async () => {
      const res = await request(app).post("/test");
      expect(res.status).toBe(200);
    });

    it("returns 429 after 10 requests", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).post("/test");
      }
      const res = await request(app).post("/test");
      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.retryAfter).toBe("15 minutes");
    });

    it("returns RateLimit headers", async () => {
      const res = await request(app).post("/test");
      expect(res.headers).toHaveProperty("ratelimit-limit");
      expect(res.headers).toHaveProperty("ratelimit-remaining");
    });
  });

  describe("readLimiter (300 req / 15 min)", () => {
    let app: Express;

    beforeEach(() => {
      app = createApp(readLimiter);
    });

    it("allows 300 requests", async () => {
      // Verify request #300 still succeeds
      for (let i = 0; i < 300; i++) {
        await request(app).get("/test");
      }
      // Request #301 should be blocked
      const res = await request(app).get("/test");
      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
    });

    it("returns RateLimit headers", async () => {
      const res = await request(app).get("/test");
      expect(res.headers).toHaveProperty("ratelimit-limit");
      expect(res.headers).toHaveProperty("ratelimit-remaining");
    });
  });
});
