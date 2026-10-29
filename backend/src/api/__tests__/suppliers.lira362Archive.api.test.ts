/**
 * LIRA-362 — `PUT /api/suppliers/:id/archived`, the web twin of IPC
 * `suppliers:set-archived`: admin-only, the SAME core schema
 * (`supplierArchiveSchema`), `:id` taken from the URL, and the HTTP-200
 * envelope when the repository refuses (rule 19c).
 *
 * Harness copied from suppliers.lira343DayDetail.api.test.ts.
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
import { getSupplierService, supplierArchiveSchema } from "@liratek/core";
import suppliersRouter from "../suppliers.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/suppliers", suppliersRouter);
  return app;
}

describe("PUT /api/suppliers/:id/archived (LIRA-362)", () => {
  const supplierService = getSupplierService();
  beforeEach(() => jest.restoreAllMocks());

  it("forwards the URL id and the flag, in the schema's own shape", async () => {
    const spy = jest
      .spyOn(supplierService, "setSupplierArchived")
      .mockReturnValue({ success: true, id: 46 });
    const res = await request(buildApp())
      .put("/api/suppliers/46/archived")
      .set("x-test-role", "admin")
      .send({ archived: true });
    expect(res.body).toEqual({ success: true, id: 46 });
    expect(spy).toHaveBeenCalledWith(
      supplierArchiveSchema.parse({ supplier_id: 46, archived: true }),
    );
  });

  it("passes the 'settle first' refusal through as a 200 envelope", async () => {
    jest.spyOn(supplierService, "setSupplierArchived").mockReturnValue({
      success: false,
      error: "Settle this supplier to $0 before archiving it",
    });
    const res = await request(buildApp())
      .put("/api/suppliers/46/archived")
      .set("x-test-role", "admin")
      .send({ archived: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/settle/i);
  });

  it("is admin-only", async () => {
    const spy = jest.spyOn(supplierService, "setSupplierArchived");
    const res = await request(buildApp())
      .put("/api/suppliers/46/archived")
      .set("x-test-role", "staff")
      .send({ archived: true });
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a payload without the flag", async () => {
    const spy = jest.spyOn(supplierService, "setSupplierArchived");
    const res = await request(buildApp())
      .put("/api/suppliers/46/archived")
      .set("x-test-role", "admin")
      .send({});
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
