/**
 * LIRA-296 (T017) — `PUT /api/inventory/categories/:id` forwards the
 * category's default warranty (`warranty_months`, 0–60 or null), the web
 * twin of IPC `inventory:update-category`; `GET /categories-full` returns it.
 */
import { jest } from "@jest/globals";

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = { userId: 7, username: "t", role, tenantId: 1, sessionToken: "s" };
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
import { getCategoryRepository } from "@liratek/core";
import inventoryRouter from "../inventory.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/inventory", inventoryRouter);
  return app;
}

describe("category default warranty over REST", () => {
  const repo = getCategoryRepository();
  beforeEach(() => jest.restoreAllMocks());

  it("PUT forwards warranty_months to the repository", async () => {
    const spy = jest.spyOn(repo, "update").mockReturnValue(true);
    const res = await request(buildApp())
      .put("/api/inventory/categories/3")
      .set("x-test-role", "admin")
      .send({ warranty_months: 1 });
    expect(res.body).toEqual({ success: true, updated: true });
    expect(spy).toHaveBeenCalledWith(3, {
      name: undefined,
      tracksImeiUnits: undefined,
      warrantyMonths: 1,
    });
  });

  it("PUT forwards null", async () => {
    const spy = jest.spyOn(repo, "update").mockReturnValue(true);
    await request(buildApp())
      .put("/api/inventory/categories/3")
      .set("x-test-role", "admin")
      .send({ warranty_months: null });
    expect((spy.mock.calls[0] as unknown[])[1]).toHaveProperty(
      "warrantyMonths",
      null,
    );
  });

  it("PUT refuses 61 months with a 200 failure envelope", async () => {
    const spy = jest.spyOn(repo, "update");
    const res = await request(buildApp())
      .put("/api/inventory/categories/3")
      .set("x-test-role", "admin")
      .send({ warranty_months: 61 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("GET /categories-full returns warranty_months", async () => {
    jest.spyOn(repo, "getAll").mockReturnValue([
      {
        id: 3,
        name: "Accessories",
        sort_order: 0,
        is_active: 1,
        tracks_imei_units: 0,
        warranty_months: 1,
        created_at: "x",
      },
    ] as never);
    const res = await request(buildApp())
      .get("/api/inventory/categories-full")
      .set("x-test-role", "staff");
    expect(res.body.data[0]).toHaveProperty("warranty_months", 1);
  });

  it("LIRA-296 P3: PUT forwards serial_label and serial_required (rule 23)", async () => {
    const spy = jest.spyOn(repo, "update").mockReturnValue(true);
    const res = await request(buildApp())
      .put("/api/inventory/categories/3")
      .set("x-test-role", "admin")
      .send({ serial_label: "Serial", serial_required: "WARN" });
    expect(res.body).toEqual({ success: true, updated: true });
    expect((spy.mock.calls[0] as unknown[])[1]).toMatchObject({
      serialLabel: "Serial",
      serialRequired: "WARN",
    });
  });

  it("LIRA-296 P3: GET /categories-full returns serial_label and serial_required", async () => {
    jest.spyOn(repo, "getAll").mockReturnValue([
      {
        id: 3,
        name: "Laptops",
        sort_order: 0,
        is_active: 1,
        tracks_imei_units: 1,
        warranty_months: null,
        serial_label: "Serial",
        serial_required: "WARN",
        created_at: "x",
      },
    ] as never);
    const res = await request(buildApp())
      .get("/api/inventory/categories-full")
      .set("x-test-role", "staff");
    expect(res.body.data[0]).toMatchObject({
      serial_label: "Serial",
      serial_required: "WARN",
    });
  });
});

