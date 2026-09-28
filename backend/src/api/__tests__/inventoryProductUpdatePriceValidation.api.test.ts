/**
 * LIRA-224 batch, "error message" fix — `PUT /api/inventory/products/:id`
 * answered a business-rule refusal (e.g. "Selling price must be greater than
 * cost price", from `InventoryService.updateProduct`) with HTTP 400, unlike
 * every sibling write route on this router (POST batch-delete, POST
 * batch-update, PUT .../:id's own DELETE sibling), which all answer HTTP 200
 * + `{ success: false, error }` — rule 19c's envelope parity, so the frontend
 * adapter (which branches on `result.success`, never on status code) sees the
 * real result instead of a thrown `ApiError`.
 *
 * Consequence on the web transport: `requestJson` (frontend/src/api/httpClient.ts)
 * THROWS a plain `{status, message, details}` object on any non-2xx, and
 * `frontend/src/api/backendApi.ts`'s `updateProduct` has no try/catch around
 * that call (unlike `createProduct`, which needs one anyway for REST field
 * remapping) — the throw propagates straight into `ProductForm.handleSubmit`'s
 * generic `catch`, which discards it and shows "An unexpected error occurred"
 * instead of the server's real message. Desktop (IPC) never had this bug:
 * `InventoryService.updateProduct`'s `{success:false, error}` return reaches
 * the IPC handler and then the form unchanged, with no HTTP layer to lose it
 * to a thrown status.
 *
 * Reproduced first (rule 17): asserts HTTP 200 (not 400) and the SAME error
 * string the service returns — fails against the pre-fix
 * `res.status(result.success ? 200 : 400).json(result)` line.
 *
 * Same harness as inventoryProductCategory.api.test.ts (real router + real
 * core service singleton, better-sqlite3 mocked) — copied rather than
 * imported so this file's one scenario stays readable on its own.
 */

import { jest } from "@jest/globals";

const TEST_TENANT_ID = 4711;

jest.mock("../../middleware/auth.js", () => {
  const { runWithTenant } =
    require("@liratek/core") as typeof import("@liratek/core");
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
      tenantId: TEST_TENANT_ID,
      sessionToken: "test-session",
    };
    runWithTenant(TEST_TENANT_ID, () => next());
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
import inventoryRouter from "../inventory.js";
import {
  mockDatabase,
  mockStatement,
  resetAllMocks,
} from "../../__mocks__/better-sqlite3";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/inventory", inventoryRouter);
  return app;
}

describe("PUT /api/inventory/products/:id — business-rule refusal envelope (LIRA-224 batch)", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    resetAllMocks();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__: unknown }
    ).__LIRATEK_TEST_DB__ = mockDatabase;

    (mockDatabase as unknown as { transaction: jest.Mock }).transaction =
      jest.fn((fn: (...a: unknown[]) => unknown) => {
        return (...args: unknown[]) => fn(...args);
      });

    mockStatement.run.mockImplementation(function (
      this: { _sql: string },
      ...args: unknown[]
    ) {
      return { changes: 1, lastInsertRowid: 1 };
    });

    mockStatement.get.mockImplementation(function (
      this: { _sql: string },
      ...args: unknown[]
    ) {
      const sql = this._sql;
      // `exists(id)` — the product being updated is there. This is the ONLY
      // read InventoryService.updateProduct performs before the price-order
      // guard fires, so nothing else needs stubbing.
      if (sql.includes("SELECT 1 FROM products WHERE id =")) return { 1: 1 };
      return undefined;
    });
  });

  it("answers HTTP 200 with {success:false, error} — not a thrown 400 — when retail_price <= cost_price", async () => {
    const res = await request(app)
      .put("/api/inventory/products/77")
      .set("x-test-role", "admin")
      .send({
        barcode: "REST-9999",
        name: "Underpriced Phone",
        category: "Phones",
        cost_price: 200,
        retail_price: 150,
        min_stock_level: 5,
      });

    // The bug: this used to be 400, matching the thrown ApiError the web
    // frontend then discarded down to "An unexpected error occurred".
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Selling price must be greater than cost price",
    });
  });

  it("still answers 200 + success:true for a valid price order (unchanged happy path)", async () => {
    const res = await request(app)
      .put("/api/inventory/products/77")
      .set("x-test-role", "admin")
      .send({
        barcode: "REST-9998",
        name: "Correctly Priced Phone",
        category: "Phones",
        cost_price: 100,
        retail_price: 150,
        min_stock_level: 5,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
