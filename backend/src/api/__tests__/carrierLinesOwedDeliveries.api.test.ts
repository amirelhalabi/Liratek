/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * #28 (LIRA-218, v184) — REST route coverage for the two "days still to
 * send" endpoints, closing the m4/both-transports gap the 2026-09-24
 * adversarial review found: zero backend-route, IPC-handler, or dual-mode
 * tests existed for either endpoint.
 *
 * Pattern mirrors `customServicesUpdateMetadata.api.test.ts` (the
 * established convention in this directory): `../../server.js` and
 * `../../middleware/auth.js` are faked with the header-driven `x-test-role`
 * stand-in; `@liratek/core` keeps its REAL schema
 * (`markCarrierLineOwedDeliverySentSchema`) via `jest.requireActual` so
 * this proves the route's validation against the real contract, not a stub
 * — only `getCarrierLineService` is swapped for a stub. This is a
 * ROUTE-WIRING test (roles, envelope, id parsing, actor-from-JWT), not
 * `CarrierLineOwedDeliveryRepository`/`CarrierLineService` internals,
 * which are core's own suites.
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

const getPendingOwedDeliveries = jest.fn();
const markOwedDeliverySent = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getCarrierLineService: () => ({
      getPendingOwedDeliveries,
      markOwedDeliverySent,
    }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import carrierLinesRoutes from "../carrierLines.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/carrier-lines", carrierLinesRoutes);
  return app;
}

describe("GET /api/carrier-lines/owed-deliveries/pending", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    getPendingOwedDeliveries.mockReset();
    markOwedDeliverySent.mockReset();
  });

  it("returns the pending deliveries list for an authenticated request (no role gate)", async () => {
    getPendingOwedDeliveries.mockReturnValue({
      success: true,
      data: [{ id: 1, carrier_line_id: 1, days_owed: 210, status: "PENDING" }],
    });

    const res = await request(app)
      .get("/api/carrier-lines/owed-deliveries/pending")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [{ id: 1, carrier_line_id: 1, days_owed: 210, status: "PENDING" }],
    });
  });

  it("rejects an unauthenticated request before touching the service", async () => {
    const res = await request(app).get(
      "/api/carrier-lines/owed-deliveries/pending",
    );

    expect(res.status).toBe(401);
    expect(getPendingOwedDeliveries).not.toHaveBeenCalled();
  });
});

describe("POST /api/carrier-lines/owed-deliveries/:id/mark-sent", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    getPendingOwedDeliveries.mockReset();
    markOwedDeliverySent.mockReset();
  });

  it("marks a delivery sent for an admin, with the actor taken from the JWT — never the body", async () => {
    markOwedDeliverySent.mockReturnValue({
      success: true,
      data: {
        id: 7,
        carrier_line_id: 1,
        days_owed: 210,
        status: "SENT",
      },
    });

    const res = await request(app)
      .post("/api/carrier-lines/owed-deliveries/7/mark-sent")
      .set("x-test-role", "admin")
      .send({ userId: 999 }); // must be IGNORED — actor comes from the JWT

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { id: 7, carrier_line_id: 1, days_owed: 210, status: "SENT" },
    });
    expect(markOwedDeliverySent).toHaveBeenCalledWith(7, 42); // 42 = JWT userId, not 999
  });

  it("allows staff too (roles mirror the IPC channel)", async () => {
    markOwedDeliverySent.mockReturnValue({ success: true, data: { id: 7 } });

    const res = await request(app)
      .post("/api/carrier-lines/owed-deliveries/7/mark-sent")
      .set("x-test-role", "staff")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects a non-numeric id through the SHARED schema, HTTP 200 with success:false (rule 19c) — never touches the service", async () => {
    const res = await request(app)
      .post("/api/carrier-lines/owed-deliveries/not-a-number/mark-sent")
      .set("x-test-role", "admin")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(markOwedDeliverySent).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request before touching the service", async () => {
    const res = await request(app)
      .post("/api/carrier-lines/owed-deliveries/7/mark-sent")
      .send({});

    expect(res.status).toBe(401);
    expect(markOwedDeliverySent).not.toHaveBeenCalled();
  });

  it("returns a business rejection (e.g. delivery not found) as HTTP 200 success:false (rule 19c) — never 4xx", async () => {
    markOwedDeliverySent.mockReturnValue({
      success: false,
      error: "Carrier line owed delivery #7 not found",
    });

    const res = await request(app)
      .post("/api/carrier-lines/owed-deliveries/7/mark-sent")
      .set("x-test-role", "admin")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Carrier line owed delivery #7 not found",
    });
  });
});
