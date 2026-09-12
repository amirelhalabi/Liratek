/**
 * Loto REST role-parity regression test (TRANSPORT_PARITY_AUDIT_PLAN.md
 * §6.4 follow-up item 4).
 *
 * The bug: `../loto.js` applies a ROUTER-LEVEL `requireRole(["admin"])`
 * (registered via `router.use(...)`) that every route defined after it
 * inherits. `POST /update-metadata` used to be registered after that gate,
 * so a staff JWT — which its IPC twin `loto:update-metadata` in
 * lotoHandlers.ts explicitly allows (`requireRole(["admin", "staff"])`) —
 * was refused on the web while working fine on desktop. The fix moves the
 * route's registration to sit BETWEEN `router.use(authenticateJWT)` and
 * `router.use(requireRole(["admin"]))`, with its own
 * `requireRole(["admin", "staff"])`.
 *
 * This suite proves two things, and BOTH matter — proving only the first
 * would be consistent with having widened the ENTIRE router to admin+staff,
 * which is not the change that was made and would silently loosen every
 * other admin-only loto route:
 *   1. a staff JWT CAN reach `/update-metadata` (the fix)
 *   2. the SAME staff JWT is still refused on another loto route that stays
 *      admin-only (`/sell`, `/report`) — proving only one route moved, not
 *      the whole router's gate.
 *
 * Pattern mirrors authSessions.api.test.ts (the most recent example of this
 * convention): `../../server.js` and `../../middleware/auth.js` are faked
 * (the latter via the same header-driven `x-test-role` stand-in used by
 * every REST route suite in this directory); `@liratek/core` keeps its real
 * schemas (`lotoUpdateMetadataSchema`, `lotoSellSchema`, ...) via
 * `jest.requireActual` and only `getLotoService` is swapped for a stub —
 * this is a ROUTE-wiring test (which role gate applies to which path), not
 * a LotoService/repository test (those are the core agent's own suites).
 *
 * Rule-17 note: the failing-first proof (temporarily reverting the route to
 * its pre-fix position after the router-level gate, watching test 1 below
 * fail, then reverting) is still owed — this file was written under a
 * constraint forbidding test runs; whoever runs the suite next should do
 * that proof once and record it here.
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

const updateLotoMetadata = jest.fn();
const sellTicket = jest.fn();
const getReportData = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getLotoService: () => ({
      updateLotoMetadata,
      sellTicket,
      getReportData,
    }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import lotoRoutes from "../loto.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/loto", lotoRoutes);
  return app;
}

describe("Loto REST route roles — /update-metadata widened to admin+staff", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    updateLotoMetadata.mockReset();
    sellTicket.mockReset();
    getReportData.mockReset();
  });

  it("a STAFF JWT can call POST /api/loto/update-metadata (matches the IPC twin's requireRole([admin, staff]))", async () => {
    updateLotoMetadata.mockReturnValue({
      success: true,
      entity: { id: 7, note: "updated note" },
      oldValues: { note: "old note" },
    });

    const res = await request(app)
      .post("/api/loto/update-metadata")
      .set("x-test-role", "staff")
      .send({ id: 7, note: "updated note" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { id: 7, note: "updated note" },
    });
    expect(updateLotoMetadata).toHaveBeenCalledTimes(1);
    // editedBy comes from the JWT's username, never from the request body.
    expect(updateLotoMetadata).toHaveBeenCalledWith(
      7,
      { note: "updated note" },
      "tester",
    );
  });

  it("an ADMIN JWT can still call POST /api/loto/update-metadata (unchanged)", async () => {
    updateLotoMetadata.mockReturnValue({
      success: true,
      entity: { id: 7, note: "updated note" },
      oldValues: {},
    });

    const res = await request(app)
      .post("/api/loto/update-metadata")
      .set("x-test-role", "admin")
      .send({ id: 7, note: "updated note" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("an unauthenticated request to /update-metadata is refused, service never called", async () => {
    const res = await request(app)
      .post("/api/loto/update-metadata")
      .send({ id: 7, note: "x" });

    expect(res.status).toBe(401);
    expect(updateLotoMetadata).not.toHaveBeenCalled();
  });

  it("the SAME staff JWT is still refused on POST /api/loto/sell — proves only /update-metadata moved, not the whole router's gate", async () => {
    const res = await request(app)
      .post("/api/loto/sell")
      .set("x-test-role", "staff")
      .send({});

    expect(res.status).toBe(403);
    expect(sellTicket).not.toHaveBeenCalled();
  });

  it("the SAME staff JWT is still refused on GET /api/loto/report — a second admin-only route, for confidence beyond one example", async () => {
    const res = await request(app)
      .get("/api/loto/report")
      .set("x-test-role", "staff")
      .query({ from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(403);
    expect(getReportData).not.toHaveBeenCalled();
  });

  it("an admin JWT is NOT refused on /sell by the router-level gate (sanity check that the gate itself still works)", async () => {
    sellTicket.mockReturnValue({ id: 1 });

    const res = await request(app)
      .post("/api/loto/sell")
      .set("x-test-role", "admin")
      .send({
        ticket_number: "T-1",
        sale_amount: 10,
        commission_rate: 0.1,
        currency: "USD",
        payment_method: "cash",
      });

    expect(res.status).toBe(200);
  });
});
