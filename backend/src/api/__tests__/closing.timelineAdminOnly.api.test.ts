/**
 * Checkpoint Timeline reads are admin-only (owner decision 2026-10-12).
 *
 * The timeline's sidebar link was already admin-only, but the page route and
 * its three reads answered any signed-in role, so a staff user who typed
 * the URL saw every count and variance. `/last-checkpoint-per-drawer` stays
 * open on purpose: the Dashboard's drawer cards read it for staff too.
 *
 * Rule 17: written before the routes were gated and run against them.
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
import { getClosingService } from "@liratek/core";
import closingRouter from "../closing.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/closing", closingRouter);
  return app;
}

describe("Checkpoint Timeline reads — admin only", () => {
  let app: Express;
  const closingService = getClosingService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  const routes = [
    {
      path: "/api/closing/checkpoint-timeline",
      stub: () =>
        jest
          .spyOn(closingService, "getCheckpointTimeline")
          .mockResolvedValue({ success: true, checkpoints: [] }),
    },
    {
      path: "/api/closing/carrier-line-adjustments",
      stub: () =>
        jest
          .spyOn(closingService, "getCarrierLineAdjustments")
          .mockResolvedValue({ success: true, adjustments: [] }),
    },
    {
      path: "/api/closing/initial-checkpoint-date",
      stub: () =>
        jest
          .spyOn(closingService, "getInitialCheckpointDate")
          .mockReturnValue("2026-10-11"),
    },
  ];

  for (const { path, stub } of routes) {
    it(`${path}: staff is refused and the service is never read`, async () => {
      const spy = stub();
      const res = await request(app).get(path).set("x-test-role", "staff");
      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it(`${path}: admin still reads it`, async () => {
      const spy = stub();
      const res = await request(app).get(path).set("x-test-role", "admin");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalled();
    });
  }

  it("/api/closing/last-checkpoint-per-drawer stays readable by staff (Dashboard drawer cards)", async () => {
    jest
      .spyOn(closingService, "getLastCheckpointPerDrawer")
      .mockReturnValue({});
    const res = await request(app)
      .get("/api/closing/last-checkpoint-per-drawer")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
  });
});
