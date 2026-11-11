/**
 * LIRA-388 (FR-007) — "everyone may refund": POST /api/transactions/:id/refund
 * is the ONE refund entry point for every row type (core dispatches by
 * `refundPlanOf`), open to admin AND staff, and passes the caller's role to
 * the service (an owner that checks it itself — the warranty claim — reads
 * it). The IPC-identical envelope on a refusal stays HTTP 200.
 *
 * Rule 17 disclosure: written AFTER the role change — NOT proven
 * failing-first.
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
      userId: 7,
      username: "t",
      role,
      tenantId: 1,
      sessionToken: "s",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
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
import { getTransactionService } from "@liratek/core";
import transactionsRouter from "../transactions.js";
import salesRouter from "../sales.js";

function app(): Express {
  const a = express();
  a.use(express.json());
  a.use("/api/transactions", transactionsRouter);
  return a;
}

describe("LIRA-388 — refund is open to staff", () => {
  const svc = getTransactionService();
  beforeEach(() => jest.restoreAllMocks());

  it.each(["admin", "staff"])(
    "%s may refund; the role reaches the service",
    async (role) => {
      const spy = jest.spyOn(svc, "refundTransaction").mockReturnValue(55);
      const res = await request(app())
        .post("/api/transactions/9/refund")
        .set("x-test-role", role);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, refundId: 55 });
      expect(spy).toHaveBeenCalledWith(
        9,
        7,
        expect.objectContaining({ actorRole: role }),
      );
    },
  );

  it("a refusal keeps the IPC envelope (HTTP 200, success false)", async () => {
    jest.spyOn(svc, "refundTransaction").mockImplementation(() => {
      throw new Error("CHECKPOINT transactions cannot be voided or refunded");
    });
    const res = await request(app())
      .post("/api/transactions/9/refund")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/cannot be voided or refunded/);
  });

  it("undo refund stays admin-only", async () => {
    const a = express();
    a.use(express.json());
    a.use("/api/sales", salesRouter);
    const res = await request(a)
      .post("/api/sales/undo-item-refund")
      .set("x-test-role", "staff")
      .send({ refundTransactionId: 1 });
    expect(res.status).toBe(403);
  });
});
