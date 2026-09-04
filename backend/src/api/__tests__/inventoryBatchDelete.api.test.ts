/**
 * LIRA-149 — `POST /api/inventory/products/batch-delete`, the REST twin of
 * the `inventory:batch-delete` IPC channel (see ../inventory.ts).
 *
 * The two bugs this file guards (see the ticket / inventory.ts's own
 * comments for the full story):
 *
 *  (a) The route did not exist at all. The frontend's `handleBatchDelete`
 *      (ProductList.tsx) used to gate on raw `window.api` and silently no-op
 *      in the browser, reporting `ids.length` products "deleted" having
 *      deleted NOTHING — a false success. This file proves the route now
 *      exists, validates its body against the SAME `batchDeleteProductIdsSchema`
 *      the IPC handler validates (rule 14), matches the IPC handler's
 *      `["admin", "staff"]` role gate (NOT the singular DELETE's admin-only
 *      gate), calls the SAME `InventoryService.batchDeleteProducts` (rule 13),
 *      and mirrors its audit.
 *
 *  (b) Envelope parity: every REST route in this file must answer a
 *      business-rule failure with HTTP 200 + `{success:false}` (rule 19c) —
 *      never a 4xx — because the frontend adapter (`ipcOrHttp`) branches only
 *      on `result.success`, never on status code. This file proves the new
 *      route holds that contract on a service-level failure.
 *
 * Pattern mirrors inventoryProductList.api.test.ts: the REAL router with only
 * ../../middleware/auth.js faked (header-driven `x-test-role`), and the REAL
 * InventoryService singleton with `batchDeleteProducts` stubbed via
 * `jest.spyOn` so assertions land on the exact argument/response shape
 * without needing a live DB (this file doesn't drive the better-sqlite3
 * mock — nothing here depends on the SQL InventoryService's repository
 * emits, only on the route's own contract).
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

describe("POST /api/inventory/products/batch-delete", () => {
  let app: Express;
  const inventoryService = getInventoryService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("deletes the given ids, returning the service's envelope verbatim (rule 13/14/19b)", async () => {
    const spy = jest.spyOn(inventoryService, "batchDeleteProducts").mockReturnValue({
      success: true,
      deleted: 3,
      removed_unit_count: 2,
      removed_unit_imeis: ["IMEI-1", "IMEI-2"],
    });

    const res = await request(app)
      .post("/api/inventory/products/batch-delete")
      .set("x-test-role", "admin")
      .send({ ids: [11, 12, 13] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      deleted: 3,
      removed_unit_count: 2,
      removed_unit_imeis: ["IMEI-1", "IMEI-2"],
    });
    expect(spy).toHaveBeenCalledWith([11, 12, 13]);
  });

  it("matches the IPC handler's role gate — staff is allowed (NOT the singular DELETE's admin-only gate)", async () => {
    jest
      .spyOn(inventoryService, "batchDeleteProducts")
      .mockReturnValue({ success: true, deleted: 1 });

    const res = await request(app)
      .post("/api/inventory/products/batch-delete")
      .set("x-test-role", "staff")
      .send({ ids: [42] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects an unauthenticated request, never reaching the service", async () => {
    const spy = jest.spyOn(inventoryService, "batchDeleteProducts");

    const res = await request(app)
      .post("/api/inventory/products/batch-delete")
      .send({ ids: [1] });

    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an empty ids array — rule 19c: HTTP 200 + string error, service never called", async () => {
    const spy = jest.spyOn(inventoryService, "batchDeleteProducts");

    const res = await request(app)
      .post("/api/inventory/products/batch-delete")
      .set("x-test-role", "admin")
      .send({ ids: [] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a non-positive-integer id (rule 14 — same ids rule the IPC channel validates)", async () => {
    const spy = jest.spyOn(inventoryService, "batchDeleteProducts");

    const res = await request(app)
      .post("/api/inventory/products/batch-delete")
      .set("x-test-role", "admin")
      .send({ ids: [1, -2, 3] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces a service-level failure with HTTP 200 (envelope parity, rule 19c)", async () => {
    jest.spyOn(inventoryService, "batchDeleteProducts").mockReturnValue({
      success: false,
      error: "no such table: products",
    });

    const res = await request(app)
      .post("/api/inventory/products/batch-delete")
      .set("x-test-role", "admin")
      .send({ ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "no such table: products",
    });
  });
});

describe("DELETE /api/inventory/products/:id — envelope parity (LIRA-149)", () => {
  let app: Express;
  const inventoryService = getInventoryService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("answers a service-level failure with HTTP 200 + {success:false}, never a 4xx", async () => {
    jest.spyOn(inventoryService, "deleteProduct").mockReturnValue({
      success: false,
      error: "Product not found",
    });

    const res = await request(app)
      .delete("/api/inventory/products/999")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Product not found",
    });
  });

  it("answers an invalid :id with HTTP 200 + {success:false}, never a 4xx", async () => {
    const res = await request(app)
      .delete("/api/inventory/products/not-a-number")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Invalid id" });
  });
});
