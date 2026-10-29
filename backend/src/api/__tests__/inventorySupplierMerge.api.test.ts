/**
 * LIRA-361 — `POST /api/inventory/product-suppliers/merge` and
 * `GET /api/inventory/product-suppliers/:id/impact`, the web twins of IPC
 * `inventory:merge-product-supplier` / `inventory:product-supplier-impact`.
 * The merge route is static and must win over `/product-suppliers/:id`.
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

import express, { type Express } from "express";
import request from "supertest";
import { getProductSupplierRepository } from "@liratek/core";
import inventoryRouter from "../inventory.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/inventory", inventoryRouter);
  return app;
}

describe("product supplier merge over REST (LIRA-361)", () => {
  const repo = getProductSupplierRepository();
  beforeEach(() => jest.restoreAllMocks());

  it("POST /merge forwards sourceId and targetId and returns the envelope", async () => {
    const spy = jest
      .spyOn(repo, "merge")
      .mockReturnValue({ moved_products: 2, moved_ledger_entries: 3 });
    const res = await request(buildApp())
      .post("/api/inventory/product-suppliers/merge")
      .set("x-test-role", "staff")
      .send({ sourceId: 2, targetId: 1 });
    expect(res.body).toEqual({
      success: true,
      data: { moved_products: 2, moved_ledger_entries: 3 },
    });
    expect(spy).toHaveBeenCalledWith(2, 1);
  });

  it("POST /merge refuses a supplier merged into itself (200 failure envelope)", async () => {
    const spy = jest.spyOn(repo, "merge");
    const res = await request(buildApp())
      .post("/api/inventory/product-suppliers/merge")
      .set("x-test-role", "admin")
      .send({ sourceId: 2, targetId: 2 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("POST /merge is role-gated like the other supplier writes", async () => {
    const spy = jest.spyOn(repo, "merge");
    const res = await request(buildApp())
      .post("/api/inventory/product-suppliers/merge")
      .set("x-test-role", "viewer")
      .send({ sourceId: 2, targetId: 1 });
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("GET /:id/impact returns the repository's impact", async () => {
    const impact = {
      product_count: 2,
      ledger_entry_count: 1,
      balance_usd: 50,
      balance_lbp: 0,
    };
    const spy = jest.spyOn(repo, "getDeleteImpact").mockReturnValue(impact);
    const res = await request(buildApp())
      .get("/api/inventory/product-suppliers/4/impact")
      .set("x-test-role", "staff");
    expect(res.body).toEqual({ success: true, data: impact });
    expect(spy).toHaveBeenCalledWith(4);
  });

  it("DELETE passes the 'merge instead' refusal through as the error", async () => {
    jest.spyOn(repo, "delete").mockImplementation(() => {
      throw new Error(
        "This supplier has products or debt history — merge it into another supplier instead of deleting it",
      );
    });
    const res = await request(buildApp())
      .delete("/api/inventory/product-suppliers/4")
      .set("x-test-role", "admin");
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/merge/);
  });
});
