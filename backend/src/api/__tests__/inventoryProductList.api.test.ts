/**
 * Inventory product-list REST route tests — the HTTP twin of the
 * `inventory:get-products` / `inventory:get-product-filter-options` IPC
 * channels (see ../inventory.ts).
 *
 * Pattern mirrors productUnits.api.test.ts: the REAL router with only
 * ../../middleware/auth.js faked (header-driven `x-test-role`), and the REAL
 * InventoryService singleton with its methods stubbed via `jest.spyOn` so we
 * can assert on the EXACT argument the route builds.
 *
 * What these guard, specifically:
 *  - the query string is the contract with the frontend agent's filter UI —
 *    repeated `category=`/`supplier=` params must reach the service as the
 *    plural `categories`/`suppliers` arrays the repository reads, and numeric
 *    params must arrive as real numbers, not the strings express hands over;
 *  - a no-params call must be byte-identical to the pre-filter behaviour
 *    (POS and every other consumer of this route);
 *  - `''` must never coerce to a real `0`/`false` bound;
 *  - rule 19c: a validation rejection is HTTP 200 + a string `error`, and the
 *    service is never reached.
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
import { getInventoryService } from "@liratek/core";
import inventoryRouter from "../inventory.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/inventory", inventoryRouter);
  return app;
}

describe("Inventory product-list REST routes", () => {
  let app: Express;
  const inventoryService = getInventoryService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("GET /api/inventory/products", () => {
    it("calls the service with NO filters when no params are sent (pre-filter behaviour is unchanged)", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts").mockReturnValue([]);

      const res = await request(app)
        .get("/api/inventory/products")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { products: [] } });

      // search is undefined and EVERY filter field is undefined, so
      // buildFilterClauses contributes no SQL and no params.
      const [search, filters] = spy.mock.calls[0] as [unknown, unknown];
      expect(search).toBeUndefined();
      expect(
        Object.values(filters as Record<string, unknown>).every(
          (v) => v === undefined,
        ),
      ).toBe(true);
      // The route must NOT leak the back-compat params into the filter set.
      expect(filters).not.toHaveProperty("barcode");
      expect(filters).not.toHaveProperty("activeOnly");
      expect(filters).not.toHaveProperty("search");
    });

    it("folds repeated ?category=/?supplier= params into the plural array keys", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts").mockReturnValue([]);

      const res = await request(app)
        .get(
          "/api/inventory/products?category=Phones&category=Cases&supplier=Acme",
        )
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const [, filters] = spy.mock.calls[0] as [
        unknown,
        { categories?: string[]; suppliers?: string[] },
      ];
      expect(filters.categories).toEqual(["Phones", "Cases"]);
      expect(filters.suppliers).toEqual(["Acme"]);
    });

    it("normalizes a SINGLE ?category= occurrence to a one-element array", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts").mockReturnValue([]);

      await request(app)
        .get("/api/inventory/products?category=Phones")
        .set("x-test-role", "staff");

      const [, filters] = spy.mock.calls[0] as [
        unknown,
        { categories?: string[] },
      ];
      expect(filters.categories).toEqual(["Phones"]);
    });

    it("parses every numeric/date bound into its real JS type and passes search through", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts").mockReturnValue([]);

      const res = await request(app)
        .get(
          "/api/inventory/products?search=iphone" +
            "&costMin=10.5&costMax=99" +
            "&retailMin=20&retailMax=200" +
            "&profitPctMin=-5&profitPctMax=80" +
            "&stockMin=1&stockMax=50" +
            "&addedFrom=2026-01-01&addedTo=2026-08-26",
        )
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("iphone", {
        categories: undefined,
        suppliers: undefined,
        costMin: 10.5,
        costMax: 99,
        retailMin: 20,
        retailMax: 200,
        profitPctMin: -5,
        profitPctMax: 80,
        stockMin: 1,
        stockMax: 50,
        addedFrom: "2026-01-01",
        addedTo: "2026-08-26",
      });
      // Guard the actual trap: express hands over strings, and a `"10.5"`
      // reaching the SQL binder would compare as text, not a number.
      const [, filters] = spy.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(typeof filters.costMin).toBe("number");
      expect(typeof filters.stockMax).toBe("number");
    });

    it("treats an EMPTY numeric/date param as 'no bound' — never as a real 0 / epoch filter", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts").mockReturnValue([]);

      const res = await request(app)
        .get("/api/inventory/products?costMin=&stockMax=&addedFrom=")
        .set("x-test-role", "staff");

      // A cleared <input type="number"> still submits `''`. Coercing that to
      // 0 would silently apply a real `>= 0` / `<= 0` filter, so the schema
      // preprocesses `''` to undefined instead (accepted, not rejected).
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const [, filters] = spy.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(filters.costMin).toBeUndefined();
      expect(filters.stockMax).toBeUndefined();
      expect(filters.addedFrom).toBeUndefined();
    });

    it("rejects an EMPTY ?category= — a blank string is not a selectable category", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts");

      const res = await request(app)
        .get("/api/inventory/products?category=")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a non-numeric bound — rule 19c: HTTP 200 + string error, service never called", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts");

      const res = await request(app)
        .get("/api/inventory/products?costMin=abc")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a malformed addedFrom date", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts");

      const res = await request(app)
        .get("/api/inventory/products?addedFrom=2026-13")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("still accepts the legacy ?barcode=/?activeOnly= params without applying them", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts").mockReturnValue([]);

      const res = await request(app)
        .get("/api/inventory/products?barcode=123&activeOnly=false")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const [, filters] = spy.mock.calls[0] as [unknown, unknown];
      expect(filters).not.toHaveProperty("barcode");
      expect(filters).not.toHaveProperty("activeOnly");
    });

    it("rejects an unauthenticated request, never reaching the service", async () => {
      const spy = jest.spyOn(inventoryService, "getProducts");

      const res = await request(app).get("/api/inventory/products?category=A");

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/inventory/product-filter-options", () => {
    it("returns the service's distinct categories/suppliers in the standard envelope", async () => {
      const spy = jest
        .spyOn(inventoryService, "getProductFilterOptions")
        .mockReturnValue({
          categories: ["Cases", "Phones"],
          suppliers: ["Acme", "Globex"],
        });

      const res = await request(app)
        .get("/api/inventory/product-filter-options")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          categories: ["Cases", "Phones"],
          suppliers: ["Acme", "Globex"],
        },
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("is NOT shadowed by /products/:id — the static path resolves to its own handler", async () => {
      jest
        .spyOn(inventoryService, "getProductFilterOptions")
        .mockReturnValue({ categories: [], suppliers: [] });
      const byId = jest.spyOn(inventoryService, "getProductById");

      const res = await request(app)
        .get("/api/inventory/product-filter-options")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ categories: [], suppliers: [] });
      expect(byId).not.toHaveBeenCalled();
    });

    it("surfaces a service-level failure verbatim with HTTP 200 (envelope parity)", async () => {
      jest
        .spyOn(inventoryService, "getProductFilterOptions")
        .mockImplementation(() => {
          throw new Error("no such column: p.supplier");
        });

      const res = await request(app)
        .get("/api/inventory/product-filter-options")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "no such column: p.supplier",
      });
    });

    it("requires authentication", async () => {
      const spy = jest.spyOn(inventoryService, "getProductFilterOptions");

      const res = await request(app).get(
        "/api/inventory/product-filter-options",
      );

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
