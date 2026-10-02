/**
 * LIRA-147 — admin-only "Undo refund" REST parity: `POST
 * /api/sales/undo-item-refund` forwards the SAME payload shape to the SAME
 * core service the Electron IPC handler
 * (`sales:undo-item-refund`/`salesHandlers.ts`) uses
 * (`SalesService.undoItemRefund`), matches its `["admin"]`-only gate, and
 * keeps envelope parity (HTTP 200 even on a business-rule failure, rule
 * 19c).
 *
 * Follows the harness in `salesRefundOverride.api.test.ts`: hits the REAL
 * router (`../sales.js`) through a minimal Express app, faking only
 * `../../server.js` (logger), `../../middleware/audit.js` (`auditRest`) and
 * `../../middleware/auth.js` (an `x-test-role` stand-in). `SalesService` is
 * the REAL singleton with its method stubbed via `jest.spyOn`.
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

jest.mock("../../middleware/audit.js", () => ({
  auditRest: jest.fn(),
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
import { getSalesService } from "@liratek/core";
import { auditRest } from "../../middleware/audit.js";
import salesRouter from "../sales.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sales", salesRouter);
  return app;
}

describe("LIRA-147: POST /api/sales/undo-item-refund REST parity", () => {
  let app: Express;
  const salesService = getSalesService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    // `auditRest` is a `jest.fn()` from the `jest.mock(...)` factory above,
    // not a spy — `restoreAllMocks()` doesn't clear its call history between
    // tests, so a prior test's successful undo call would otherwise still
    // show up when a LATER test asserts "not called".
    (auditRest as jest.Mock).mockClear();
  });

  it("forwards refundTransactionId + the JWT userId to SalesService.undoItemRefund", async () => {
    const spy = jest
      .spyOn(salesService, "undoItemRefund")
      .mockReturnValue({ success: true, undoId: 88 });

    const res = await request(app)
      .post("/api/sales/undo-item-refund")
      .set("x-test-role", "admin")
      .send({ refundTransactionId: 42 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, undoId: 88 });
    expect(spy).toHaveBeenCalledWith({ refundTransactionId: 42, userId: 42 });
    expect(auditRest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "refund",
        entity_type: "transaction",
        entity_id: "42",
      }),
    );
  });

  it("rejects a staff caller with 403 before touching the service (admin-only, matches the IPC gate)", async () => {
    const spy = jest.spyOn(salesService, "undoItemRefund");

    const res = await request(app)
      .post("/api/sales/undo-item-refund")
      .set("x-test-role", "staff")
      .send({ refundTransactionId: 42 });

    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    const res = await request(app)
      .post("/api/sales/undo-item-refund")
      .send({ refundTransactionId: 42 });

    expect(res.status).toBe(401);
  });

  it("rejects a missing refundTransactionId with {success:false}, HTTP 200 (envelope parity)", async () => {
    const spy = jest.spyOn(salesService, "undoItemRefund");

    const res = await request(app)
      .post("/api/sales/undo-item-refund")
      .set("x-test-role", "admin")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a business-rule failure (already undone) comes back {success:false}, HTTP 200 — never 4xx", async () => {
    jest.spyOn(salesService, "undoItemRefund").mockReturnValue({
      success: false,
      error: "This refund has already been undone.",
    });

    const res = await request(app)
      .post("/api/sales/undo-item-refund")
      .set("x-test-role", "admin")
      .send({ refundTransactionId: 42 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "This refund has already been undone.",
    });
    expect(auditRest).not.toHaveBeenCalled();
  });

  it("a service-level throw also comes back {success:false}, HTTP 200", async () => {
    jest.spyOn(salesService, "undoItemRefund").mockImplementation(() => {
      throw new Error("boom");
    });

    const res = await request(app)
      .post("/api/sales/undo-item-refund")
      .set("x-test-role", "admin")
      .send({ refundTransactionId: 42 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "boom" });
  });
});
