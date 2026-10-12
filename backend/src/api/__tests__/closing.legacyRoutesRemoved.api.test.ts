/**
 * The legacy POST /api/closing/opening-balances and /daily-closing routes
 * are gone (removed 2026-10-12).
 *
 * Nothing called them — no frontend, mobile, script or test, and their IPC
 * twins were already removed — yet they were live: no admin gate, and they
 * wrote an all-drawers checkpoint through `createCheckpoint`, which can move
 * drawer money. Any signed-in staff user could reach them. Their schema
 * also took `{currency, amount}` lines while the service wanted
 * `{drawer_name, currency_code, expected_amount, physical_amount}`.
 *
 * Checkpoints are written by POST /api/closing/checkpoint (admin only).
 *
 * Rule 17: run against the router while the routes still existed.
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

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = {
      userId: 42,
      username: "tester",
      role,
      tenantId: 1,
      sessionToken: "test-session",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

import express, { type Express } from "express";
import request from "supertest";

import closingRouter from "../closing.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/closing", closingRouter);
  return app;
}

describe("legacy closing write routes are removed", () => {
  const app = buildApp();
  const body = {
    closingDate: "2026-10-12",
    amounts: [{ currency: "USD", amount: 100 }],
    userId: 1,
    notes: "legacy",
  };

  for (const path of [
    "/api/closing/opening-balances",
    "/api/closing/daily-closing",
  ]) {
    for (const role of ["staff", "admin"]) {
      it(`POST ${path} as ${role} is not found`, async () => {
        const res = await request(app)
          .post(path)
          .set("x-test-role", role)
          .send(body);
        expect(res.status).toBe(404);
      });
    }
  }
});
