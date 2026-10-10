/**
 * LIRA-296 P3 (T050, T051) — REST twins of the supplier-return and report
 * IPC channels:
 *   POST /api/warranty/supplier-returns, POST /api/warranty/supplier-returns/:id/close,
 *   GET /api/warranty/supplier-returns, GET /api/warranty/report.
 * All admin. The actor comes from the JWT (never the body); the envelope is
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

describe("warranty supplier-return and report REST routes", () => {
  const svc = getWarrantyService();
  beforeEach(() => jest.restoreAllMocks());

  it("POST /supplier-returns — admin, actor from the JWT", async () => {
    const spy = jest
      .spyOn(svc, "createSupplierReturn")
      .mockReturnValue({ success: true, data: { id: 5 } } as never);
    const res = await request(app())
      .post("/api/warranty/supplier-returns")
      .set("x-test-role", "admin")
      .send({ defective_item_id: 2, user_id: 999 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 5 } });
    expect(spy.mock.calls[0]![0]).toEqual({ defective_item_id: 2 });
    expect(spy.mock.calls[0]![1]).toEqual({ userId: 7, role: "admin" });
  });

  it("POST /supplier-returns — staff is refused", async () => {
    const spy = jest.spyOn(svc, "createSupplierReturn");
    const res = await request(app())
      .post("/api/warranty/supplier-returns")
      .set("x-test-role", "staff")
      .send({ defective_item_id: 2 });
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("POST /supplier-returns/:id/close — the id comes from the path; a refusal is a 200 envelope with its code", async () => {
    const spy = jest.spyOn(svc, "closeSupplierReturn").mockReturnValue({
      success: false,
      error: "closed",
      code: "RETURN_NOT_OPEN",
    } as never);
    const res = await request(app())
      .post("/api/warranty/supplier-returns/5/close")
      .set("x-test-role", "admin")
      .send({ outcome: "REPLACED" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "closed",
      code: "RETURN_NOT_OPEN",
    });
    expect(spy.mock.calls[0]![0]).toEqual({
      supplier_return_id: 5,
      outcome: "REPLACED",
    });
    expect(spy.mock.calls[0]![1]).toEqual({ userId: 7, role: "admin" });
  });

  it("POST /supplier-returns/:id/close — CREDITED without a credit never reaches the service", async () => {
    const spy = jest.spyOn(svc, "closeSupplierReturn");
    const res = await request(app())
      .post("/api/warranty/supplier-returns/5/close")
      .set("x-test-role", "admin")
      .send({ outcome: "CREDITED" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("GET /supplier-returns — admin list", async () => {
    jest
      .spyOn(svc, "listSupplierReturns")
      .mockReturnValue([{ id: 5 }] as never);
    const res = await request(app())
      .get("/api/warranty/supplier-returns?status=SENT")
      .set("x-test-role", "admin");
    expect(res.body).toEqual({ success: true, data: [{ id: 5 }] });
  });

  it("GET /report — admin, query validated", async () => {
    const spy = jest
      .spyOn(svc, "report")
      .mockReturnValue({ underWarranty: [], claims: { total: 0 } } as never);
    const ok = await request(app())
      .get(
        "/api/warranty/report?from=2026-10-01&to=2026-10-10&client_day=2026-10-10",
      )
      .set("x-test-role", "admin");
    expect(ok.body).toEqual({
      success: true,
      data: { underWarranty: [], claims: { total: 0 } },
    });
    const bad = await request(app())
      .get("/api/warranty/report?from=2026-10-10&to=2026-10-01&client_day=2026-10-10")
      .set("x-test-role", "admin");
    expect(bad.body.success).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    const staff = await request(app())
      .get(
        "/api/warranty/report?from=2026-10-01&to=2026-10-10&client_day=2026-10-10",
      )
      .set("x-test-role", "staff");
    expect(staff.status).toBe(403);
  });
});
