/**
 * LIRA-296 (T039) — REST twins of the claim IPC channels:
 *   POST /api/warranty/claims, GET /api/warranty/claims,
 *   POST /api/warranty/claims/:id/void, GET /api/warranty/defective,
 *   POST /api/warranty/defective/:id/resolve.
 * The actor comes from the JWT (never the body); the envelope is
 * IPC-identical (HTTP 200 even on a refusal).
 */
import { jest } from "@jest/globals";

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
    if (!roles.includes(req.user?.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});
jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));

import express, { type Express } from "express";
import request from "supertest";
import { getWarrantyService } from "@liratek/core";
import warrantyRouter from "../warranty.js";

function app(): Express {
  const a = express();
  a.use(express.json());
  a.use("/api/warranty", warrantyRouter);
  return a;
}

describe("warranty claim REST routes", () => {
  const svc = getWarrantyService();
  beforeEach(() => jest.restoreAllMocks());

  it("POST /claims — staff, actor from the JWT, body validated", async () => {
    const spy = jest
      .spyOn(svc, "createClaim")
      .mockReturnValue({ success: true, data: { claim: { id: 1 } } } as never);
    const res = await request(app())
      .post("/api/warranty/claims")
      .set("x-test-role", "staff")
      .send({
        sale_item_id: 4,
        action: "REPAIR",
        client_day: "2026-10-10",
        user_id: 999,
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { claim: { id: 1 } } });
    expect(spy.mock.calls[0]![1]).toEqual({ userId: 7, role: "staff" });
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("user_id");
  });

  it("POST /claims — a refusal is a 200 envelope with its code", async () => {
    jest
      .spyOn(svc, "createClaim")
      .mockReturnValue({
        success: false,
        error: "No",
        code: "NOT_COVERED",
      } as never);
    const res = await request(app())
      .post("/api/warranty/claims")
      .set("x-test-role", "admin")
      .send({ sale_item_id: 4, action: "REFUND", client_day: "2026-10-10" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "No",
      code: "NOT_COVERED",
    });
  });

  it("POST /claims — an invalid body never reaches the service", async () => {
    const spy = jest.spyOn(svc, "createClaim");
    const res = await request(app())
      .post("/api/warranty/claims")
      .set("x-test-role", "staff")
      .send({ action: "REPAIR" });
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("GET /claims?sale_item_id= — staff", async () => {
    const spy = jest
      .spyOn(svc, "claimsFor")
      .mockReturnValue([{ id: 1 }] as never);
    const res = await request(app())
      .get("/api/warranty/claims")
      .query({ sale_item_id: "4" })
      .set("x-test-role", "staff");
    expect(res.body).toEqual({ success: true, data: [{ id: 1 }] });
    expect(spy).toHaveBeenCalledWith({ sale_item_id: 4 });
  });

  it("POST /claims/:id/void — admin only", async () => {
    const spy = jest
      .spyOn(svc, "voidClaim")
      .mockReturnValue({ success: true, data: { id: 3 } } as never);
    expect(
      (
        await request(app())
          .post("/api/warranty/claims/3/void")
          .set("x-test-role", "staff")
      ).status,
    ).toBe(403);
    const res = await request(app())
      .post("/api/warranty/claims/3/void")
      .set("x-test-role", "admin");
    expect(res.body).toEqual({ success: true, data: { id: 3 } });
    expect(spy).toHaveBeenCalledWith(
      { claim_id: 3 },
      { userId: 7, role: "admin" },
    );
  });

  it("GET /defective and POST /defective/:id/resolve — admin only", async () => {
    jest.spyOn(svc, "listDefective").mockReturnValue([] as never);
    const resolve = jest
      .spyOn(svc, "resolveDefective")
      .mockReturnValue({ success: true, data: { id: 2 } } as never);
    expect(
      (
        await request(app())
          .get("/api/warranty/defective")
          .set("x-test-role", "staff")
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .get("/api/warranty/defective")
          .query({ status: "HELD" })
          .set("x-test-role", "admin")
      ).body,
    ).toEqual({ success: true, data: [] });
    const res = await request(app())
      .post("/api/warranty/defective/2/resolve")
      .set("x-test-role", "admin")
      .send({ outcome: "NOT_FAULTY" });
    expect(res.body).toEqual({ success: true, data: { id: 2 } });
    expect(resolve).toHaveBeenCalledWith(
      { defective_item_id: 2, outcome: "NOT_FAULTY" },
      { userId: 7, role: "admin" },
    );
  });
});
