/**
 * PUT /api/closing/daily-closing/:id — LIRA-297 item 3.
 *
 * The route now validates against the SAME core schema the IPC handler uses
 * (`updateDailyClosingSchema`, packages/core/src/validators/closing.ts) and
 * answers every failure with the IPC-identical envelope (HTTP 200,
 * `{ success: false, error }`). Field names come from the schema itself
 * (rule 24), so a key added to the schema is automatically covered by the
 * "forwards every field" case.
 *
 * Failing-first (rule 17): the "invalid id", "wrong type" and "business
 * failure is HTTP 200" cases were run against the unfixed route and failed
 * (400 status, and the service was called with id NaN). The "forwards every
 * field" and "actor from the JWT" cases already passed before — they guard
 * against the schema stripping a field (rule 23), not a pre-existing bug.
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

jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));

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
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

import express, { type Express } from "express";
import request from "supertest";
import {
  getClosingService,
  updateDailyClosingSchema,
  type UpdateDailyClosingInput,
} from "@liratek/core";
import closingRouter from "../closing.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/closing", closingRouter);
  return app;
}

// One value per schema key, typed by the schema's own input type (rule 24).
const FULL_BODY: Required<UpdateDailyClosingInput> = {
  physical_usd: 10,
  physical_lbp: 900_000,
  physical_eur: 5,
  system_expected_usd: 11,
  system_expected_lbp: 910_000,
  variance_usd: -1,
  notes: "recount",
  report_path: "/reports/checkpoint.pdf",
};

describe("PUT /api/closing/daily-closing/:id", () => {
  let app: Express;
  const closingService = getClosingService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("forwards every schema field to the service, with the id from the path", async () => {
    const spy = jest
      .spyOn(closingService, "updateDailyClosing")
      .mockReturnValue({ success: true });

    // Guard: the fixture really covers the whole schema.
    expect(Object.keys(FULL_BODY).sort()).toEqual(
      Object.keys(updateDailyClosingSchema.shape).sort(),
    );

    const res = await request(app)
      .put("/api/closing/daily-closing/7")
      .set("x-test-role", "staff")
      .send(FULL_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith({ ...FULL_BODY, id: 7, user_id: 42 });
  });

  it("stamps the editor from the JWT, never from the body", async () => {
    const spy = jest
      .spyOn(closingService, "updateDailyClosing")
      .mockReturnValue({ success: true });

    await request(app)
      .put("/api/closing/daily-closing/7")
      .set("x-test-role", "admin")
      .send({ report_path: "/r.pdf", user_id: 999 });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, report_path: "/r.pdf", user_id: 42 }),
    );
  });

  it("an invalid id answers once with a 200 envelope and never reaches the service", async () => {
    const spy = jest.spyOn(closingService, "updateDailyClosing");

    const res = await request(app)
      .put("/api/closing/daily-closing/abc")
      .set("x-test-role", "staff")
      .send({ report_path: "/r.pdf" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a wrongly typed field is refused with a 200 envelope", async () => {
    const spy = jest.spyOn(closingService, "updateDailyClosing");

    const res = await request(app)
      .put("/api/closing/daily-closing/7")
      .set("x-test-role", "staff")
      .send({ physical_usd: "ten" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a business failure is HTTP 200 with success:false (IPC envelope parity)", async () => {
    jest
      .spyOn(closingService, "updateDailyClosing")
      .mockReturnValue({ success: false, error: "No record found with id 7" });

    const res = await request(app)
      .put("/api/closing/daily-closing/7")
      .set("x-test-role", "staff")
      .send({ notes: "x" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "No record found with id 7",
    });
  });
});
