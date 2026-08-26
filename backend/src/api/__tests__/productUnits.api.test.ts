/**
 * Product Unit REST route tests — HTTP twin of
 * electron-app/handlers/productUnitHandlers.ts (see ../productUnits.ts).
 *
 * Pattern mirrors drawerCashout.api.test.ts / partners.api.test.ts: the REAL
 * router (../productUnits.js) with only ../../middleware/auth.js faked
 * (header-driven `x-test-role`); ProductUnitService is the REAL singleton
 * with its methods stubbed via `jest.spyOn` so we can assert on the exact
 * argument the route builds and on the envelope shape.
 *
 * Admin-or-staff gate on the two writes (register/delete) — a caller with no
 * role header must be rejected and must never reach the service.
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
import { getProductUnitService } from "@liratek/core";
import productUnitsRouter from "../productUnits.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/product-units", productUnitsRouter);
  return app;
}

describe("Product Unit REST routes", () => {
  let app: Express;
  const productUnitService = getProductUnitService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("POST /api/product-units/register", () => {
    it("admin can register units — validated payload passes through to the service", async () => {
      const spy = jest.spyOn(productUnitService, "registerUnits").mockReturnValue({
        units: [{ id: 1 } as any],
        drift: { inStockUnits: 1, stockQuantity: 1, matches: true },
      });

      const res = await request(app)
        .post("/api/product-units/register")
        .set("x-test-role", "admin")
        .send({ product_id: 5, imeis: ["111111111111111"] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(5, ["111111111111111"]);
    });

    it("staff can also register units (admin-or-staff gate, not admin-only)", async () => {
      jest.spyOn(productUnitService, "registerUnits").mockReturnValue({
        units: [],
        drift: { inStockUnits: 0, stockQuantity: 0, matches: true },
      });

      const res = await request(app)
        .post("/api/product-units/register")
        .set("x-test-role", "staff")
        .send({ product_id: 5, imeis: ["111111111111111"] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("rejects (never reaches the service) an empty imeis array — rule 19c: 200 + string error", async () => {
      const spy = jest.spyOn(productUnitService, "registerUnits");

      const res = await request(app)
        .post("/api/product-units/register")
        .set("x-test-role", "admin")
        .send({ product_id: 5, imeis: [] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects an unauthenticated request with no role header, never reaching the service", async () => {
      const spy = jest.spyOn(productUnitService, "registerUnits");

      const res = await request(app)
        .post("/api/product-units/register")
        .send({ product_id: 5, imeis: ["111111111111111"] });

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/product-units/for-product/:productId", () => {
    it("passes productId and ?status= through to the service", async () => {
      const spy = jest
        .spyOn(productUnitService, "getUnitsForProduct")
        .mockReturnValue([]);

      const res = await request(app)
        .get("/api/product-units/for-product/5?status=IN_STOCK")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
      expect(spy).toHaveBeenCalledWith(5, "IN_STOCK");
    });
  });

  describe("POST /api/product-units/list", () => {
    it("passes the whole validated filters object through to the service", async () => {
      const spy = jest
        .spyOn(productUnitService, "listUnits")
        .mockReturnValue({ rows: [{ id: 1 } as any], total: 137 });

      const res = await request(app)
        .post("/api/product-units/list")
        .set("x-test-role", "staff")
        .send({
          status: "SOLD",
          defectiveOnly: true,
          search: "  3569  ",
          limit: 20,
          offset: 40,
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { rows: [{ id: 1 }], total: 137 },
      });
      // Zod trims `search`; validateRequest replaces req.body with the
      // parsed value, so the route hands the service the SAME object shape
      // the IPC handler does.
      expect(spy).toHaveBeenCalledWith({
        status: "SOLD",
        defectiveOnly: true,
        search: "3569",
        limit: 20,
        offset: 40,
      });
    });

    it("applies the shared schema's 50/0 page defaults on an empty body", async () => {
      const spy = jest
        .spyOn(productUnitService, "listUnits")
        .mockReturnValue({ rows: [], total: 0 });

      const res = await request(app)
        .post("/api/product-units/list")
        .set("x-test-role", "staff")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { rows: [], total: 0 } });
      expect(spy).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    });

    it("rejects an out-of-range limit — rule 19c: HTTP 200 + string error, service never called", async () => {
      const spy = jest.spyOn(productUnitService, "listUnits");

      const res = await request(app)
        .post("/api/product-units/list")
        .set("x-test-role", "staff")
        .send({ limit: 500 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects an unauthenticated request with no role header, never reaching the service", async () => {
      const spy = jest.spyOn(productUnitService, "listUnits");

      const res = await request(app)
        .post("/api/product-units/list")
        .send({ limit: 50, offset: 0 });

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });

    it("surfaces a service-level failure verbatim with HTTP 200", async () => {
      jest.spyOn(productUnitService, "listUnits").mockImplementation(() => {
        throw new Error("no such column: pu.bogus");
      });

      const res = await request(app)
        .post("/api/product-units/list")
        .set("x-test-role", "staff")
        .send({ limit: 50, offset: 0 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "no such column: pu.bogus",
      });
    });
  });

  describe("POST /api/product-units/summary", () => {
    it("returns the service's per-product rollup", async () => {
      jest.spyOn(productUnitService, "getSummaryForProducts").mockReturnValue({
        5: { in_stock: 2, sold: 1, defective: 0 },
      });

      const res = await request(app)
        .post("/api/product-units/summary")
        .set("x-test-role", "staff")
        .send({ product_ids: [5] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { 5: { in_stock: 2, sold: 1, defective: 0 } },
      });
    });
  });

  describe("GET /api/product-units/story", () => {
    it("passes ?imei= through to the service", async () => {
      const spy = jest
        .spyOn(productUnitService, "getUnitStory")
        .mockReturnValue([{ id: 1 } as any]);

      const res = await request(app)
        .get("/api/product-units/story?imei=111111111111111")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [{ id: 1 }] });
      expect(spy).toHaveBeenCalledWith("111111111111111");
    });
  });

  describe("POST /api/product-units/for-sale-items", () => {
    it("passes sale_item_ids through to the service", async () => {
      const spy = jest
        .spyOn(productUnitService, "getUnitsForSaleItems")
        .mockReturnValue([{ id: 1 } as any]);

      const res = await request(app)
        .post("/api/product-units/for-sale-items")
        .set("x-test-role", "staff")
        .send({ sale_item_ids: [1, 2] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [{ id: 1 }] });
      expect(spy).toHaveBeenCalledWith([1, 2]);
    });
  });

  describe("DELETE /api/product-units/:id", () => {
    it("admin/staff can delete; passes the numeric id through", async () => {
      const spy = jest
        .spyOn(productUnitService, "deleteUnit")
        .mockImplementation(() => {});

      const res = await request(app)
        .delete("/api/product-units/9")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(spy).toHaveBeenCalledWith(9);
    });

    it("surfaces a service-level failure (e.g. SOLD unit) verbatim with HTTP 200", async () => {
      jest.spyOn(productUnitService, "deleteUnit").mockImplementation(() => {
        throw new Error(
          "deleteUnit: product unit 9 is SOLD — a sold unit is history and cannot be deleted",
        );
      });

      const res = await request(app)
        .delete("/api/product-units/9")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error:
          "deleteUnit: product unit 9 is SOLD — a sold unit is history and cannot be deleted",
      });
    });
  });
});
