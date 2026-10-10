/**
 * POST /api/inventory/products — a refusal answers HTTP 200 with the
 * IPC-identical envelope (CLAUDE.md rule 19c).
 *
 * The defect: the route answered a refusal with HTTP 409 (duplicate barcode)
 * or 400 (anything else), wrapped in `createErrorResponse`'s object-shaped
 * `error: { code, message }`. `requestJson` (frontend/src/api/httpClient.ts)
 * throws on any non-2xx, and `backendApi.createProduct`'s catch could only
 * recover a message — so on the web app the ProductForm never received
 * `code: "DUPLICATE_BARCODE"` / `suggested_barcode` and could not offer
 * "use the suggested barcode", which desktop (IPC returns the service result
 * untouched) always did.
 *
 * Expected bodies are the service's own result objects (rule 24): the route
 * must pass `InventoryService.createProduct`'s result through unchanged,
 * exactly as `inventory:create-product` does on desktop.
 *
 * Rule 17: written before the route fix and run against the unfixed route
 * (2026-10-10). The three POST refusal cases and the PUT non-numeric-id case
 * FAILED there: `expect(res.status).toBe(200)` received 409 (both duplicate
 * cases) and 400 (other refusal, PUT invalid id). Two cases already passed
 * before the fix and are pins of behaviour that was already correct, NOT
 * failing-first guards: "schema rejection" (`validateRequest` already
 * answers 200) and the PUT edit-duplicate passthrough.
 */

import { jest } from "@jest/globals";

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
import { getInventoryService } from "@liratek/core";
import inventoryRouter from "../inventory.js";

type CreateResult = ReturnType<
  ReturnType<typeof getInventoryService>["createProduct"]
>;
type UpdateResult = ReturnType<
  ReturnType<typeof getInventoryService>["updateProduct"]
>;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/inventory", inventoryRouter);
  return app;
}

const VALID_BODY = {
  barcode: "ACC-0001",
  name: "USB cable",
  category: "Accessories",
  cost_price_usd: 2,
  retail_price_usd: 5,
  stock: 3,
  min_stock_threshold: 1,
};

describe("POST /api/inventory/products — refusal envelope (rule 19c)", () => {
  const app = buildApp();

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("duplicate barcode: HTTP 200 with code + suggested_barcode, as on desktop", async () => {
    const serviceResult: CreateResult = {
      success: false,
      error: "Barcode already exists",
      code: "DUPLICATE_BARCODE",
      suggested_barcode: "ACC-0001DUP1",
    };
    jest
      .spyOn(getInventoryService(), "createProduct")
      .mockReturnValue(serviceResult);

    const res = await request(app)
      .post("/api/inventory/products")
      .set("x-test-role", "staff")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(serviceResult);
  });

  it("phone-line duplicate (no suggestion offered): HTTP 200 with the code and no suggested_barcode", async () => {
    const serviceResult: CreateResult = {
      success: false,
      error: "This number is already listed",
      code: "DUPLICATE_BARCODE",
    };
    jest
      .spyOn(getInventoryService(), "createProduct")
      .mockReturnValue(serviceResult);

    const res = await request(app)
      .post("/api/inventory/products")
      .set("x-test-role", "staff")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(serviceResult);
  });

  it("any other refusal: HTTP 200 with the service's plain-string error", async () => {
    const serviceResult: CreateResult = {
      success: false,
      error: "Selling price must be greater than cost price",
    };
    jest
      .spyOn(getInventoryService(), "createProduct")
      .mockReturnValue(serviceResult);

    const res = await request(app)
      .post("/api/inventory/products")
      .set("x-test-role", "staff")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(serviceResult);
  });

  it("schema rejection: HTTP 200 with a plain-string error", async () => {
    const spy = jest.spyOn(getInventoryService(), "createProduct");

    const res = await request(app)
      .post("/api/inventory/products")
      .set("x-test-role", "staff")
      .send({ ...VALID_BODY, name: "" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("PUT /api/inventory/products/:id — refusal envelope (rule 19c)", () => {
  const app = buildApp();

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("non-numeric id: HTTP 200 + {success:false, error}, like the DELETE sibling", async () => {
    const res = await request(app)
      .put("/api/inventory/products/abc")
      .set("x-test-role", "staff")
      .send({ name: "x" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Invalid id" });
  });

  it("duplicate barcode on edit: HTTP 200 with code + suggested_barcode passed through", async () => {
    const serviceResult: UpdateResult = {
      success: false,
      error: "Barcode already exists",
      code: "DUPLICATE_BARCODE",
      suggested_barcode: "ACC-0001DUP1",
    };
    jest
      .spyOn(getInventoryService(), "getProductById")
      .mockImplementation(() => {
        throw new Error("not needed");
      });
    jest
      .spyOn(getInventoryService(), "updateProduct")
      .mockReturnValue(serviceResult);

    const res = await request(app)
      .put("/api/inventory/products/7")
      .set("x-test-role", "staff")
      .send({ name: "USB cable", barcode: "ACC-0001" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(serviceResult);
  });
});
