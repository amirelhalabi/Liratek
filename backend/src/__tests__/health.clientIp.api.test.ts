/**
 * LIRA-283: `GET /health/client-ip` tells the caller which address the server
 * resolved for THEM, and whether the request was proven to come through
 * Vercel. The deploy verifier (`scripts/deploy-api.mjs`) calls it twice —
 * through www.liratek.shop and directly with forged headers — so the owner
 * can confirm after a deploy that the server sees the shop's real IP and
 * that a forged header is ignored.
 *
 * Unauthenticated on purpose (load balancers and the verifier carry no
 * credentials): it only echoes the caller's own address, never another
 * request's and never the secret.
 */

import { jest } from "@jest/globals";

jest.mock("../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../database/connection.js", () => ({
  getDatabase: jest.fn(() => ({ prepare: () => ({ get: () => ({}) }) })),
}));

import express from "express";
import request from "supertest";
import healthRoutes from "../api/health";

const PROXY_IP = "66.241.124.103";
const SECRET = "lira283-test-proxy-secret-0123456789abcdef";

let app: express.Express;

beforeAll(() => {
  process.env.CLIENT_IP_PROXY_SECRET = SECRET;
  app = express();
  app.set("trust proxy", 1);
  app.use("/health", healthRoutes);
});
afterAll(() => {
  delete process.env.CLIENT_IP_PROXY_SECRET;
});

it("through Vercel: the real client, source 'vercel'", async () => {
  const res = await request(app)
    .get("/health/client-ip")
    .set("x-liratek-proxy-auth", SECRET)
    .set("X-Vercel-Forwarded-For", "185.187.131.199")
    .set("X-Forwarded-For", `185.187.131.199, ${PROXY_IP}`)
    .expect(200);
  expect(res.body).toEqual({
    success: true,
    ip: "185.187.131.199",
    source: "vercel",
    header: "x-vercel-forwarded-for",
    proxyVerified: true,
  });
});

it("direct with forged headers: req.ip, source 'direct'", async () => {
  const res = await request(app)
    .get("/health/client-ip")
    .set("x-liratek-proxy-auth", "guess")
    .set("X-Vercel-Forwarded-For", "203.0.113.99")
    .set("X-Forwarded-For", `203.0.113.99, ${PROXY_IP}`)
    .expect(200);
  expect(res.body).toEqual({
    success: true,
    ip: PROXY_IP,
    source: "direct",
    header: null,
    proxyVerified: false,
  });
  expect(JSON.stringify(res.body)).not.toContain(SECRET);
});

it("secret matched but no usable client header: 'direct' with proxyVerified true", async () => {
  const res = await request(app)
    .get("/health/client-ip")
    .set("x-liratek-proxy-auth", SECRET)
    .set("X-Forwarded-For", PROXY_IP)
    .expect(200);
  expect(res.body).toMatchObject({
    ip: PROXY_IP,
    source: "direct",
    proxyVerified: true,
  });
});
