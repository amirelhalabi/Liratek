/**
 * The public link limiter of Settings -> Users (join check/accept, email
 * verify) keys on the REAL client IP (CLIENT_IP_HEADER), through the same
 * helper as the sign-up limiters — not `req.ip`, which behind Vercel -> Fly
 * is one proxy address shared by every visitor.
 *
 * CLIENT_IP_HEADER is read from @liratek/core's env at import time, so it is
 * set before the module loads; jest gives this file its own module registry.
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import express, { type Express } from "express";
import request from "supertest";

const PROXY_IP = "66.241.124.103";
const ENV_NAME = "TEST_PUBLIC_LINK_RATE_LIMIT_MAX";

let shared: typeof import("../userAccountShared.js");

beforeAll(async () => {
  process.env.CLIENT_IP_HEADER = "fly-client-ip";
  process.env[ENV_NAME] = "3";
  shared = await import("../userAccountShared.js");
});

afterAll(() => {
  delete process.env.CLIENT_IP_HEADER;
  delete process.env[ENV_NAME];
});

function appWithLimiter(): Express {
  const app = express();
  app.set("trust proxy", 1); // as server.ts: req.ip is the proxy
  app.post("/t", shared.createPublicLinkLimiter(ENV_NAME, "test"), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function hit(app: Express, visitor: string) {
  return request(app)
    .post("/t")
    .set("X-Forwarded-For", PROXY_IP)
    .set("Fly-Client-IP", visitor);
}

it("one visitor is throttled; another visitor behind the SAME proxy is not", async () => {
  const app = appWithLimiter();
  for (let i = 0; i < 3; i += 1) {
    expect((await hit(app, "203.0.113.1")).status).toBe(200);
  }
  expect((await hit(app, "203.0.113.1")).status).toBe(429);
  expect((await hit(app, "203.0.113.2")).status).toBe(200);
});
