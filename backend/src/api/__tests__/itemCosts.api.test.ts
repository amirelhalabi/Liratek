/**
 * POST /api/item-costs (LIRA-297) — validated by core's `setItemCostSchema`,
 * the same schema `item-costs:set` uses on desktop (rule 14). Field names are
 * taken from the schema's own `.shape` (rule 24). Auth faked by header; the
 * service is spied on.
 */
import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));
jest.mock("../../middleware/auth.js", () => {
  const requireAuth = (req: any, _res: any, next: any) => {
    req.user = { userId: 1, role: req.headers["x-test-role"] ?? "admin", tenantId: 1 };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) =>
    roles.includes(req.user?.role) ? next() : res.status(403).json({ success: false, error: "Forbidden" });
  return { requireAuth, authenticateJWT: requireAuth, requireRole };
});

import express from "express";
import request from "supertest";
import { getItemCostService, setItemCostSchema } from "@liratek/core";
import itemCostsRouter from "../item-costs.js";

const app = express();
app.use(express.json());
app.use("/api/item-costs", itemCostsRouter);

const SCHEMA_KEYS = Object.keys(setItemCostSchema.shape);
const VALID = { provider: "MTC", category: "Vouchers", itemKey: "mtc-10", cost: 9.5, currency: "USD" };

describe("POST /api/item-costs", () => {
  beforeEach(() => jest.restoreAllMocks());

  it("the fixture covers exactly the schema's keys", () => {
    expect(Object.keys(VALID).sort()).toEqual([...SCHEMA_KEYS].sort());
  });

  it("forwards every schema key to the service and returns its result", async () => {
    const spy = jest.spyOn(getItemCostService(), "setCost").mockReturnValue({ success: true });
    const res = await request(app).post("/api/item-costs").send(VALID);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith(VALID.provider, VALID.category, VALID.itemKey, VALID.cost, VALID.currency);
  });

  it.each(SCHEMA_KEYS)("refuses a body missing %s with the 200 envelope, without calling the service", async (key) => {
    const spy = jest.spyOn(getItemCostService(), "setCost");
    const body: Record<string, unknown> = { ...VALID };
    delete body[key];
    const res = await request(app).post("/api/item-costs").send(body);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a non-numeric cost", async () => {
    const spy = jest.spyOn(getItemCostService(), "setCost");
    const res = await request(app).post("/api/item-costs").send({ ...VALID, cost: "9.5" });
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a failed save instead of claiming success", async () => {
    jest.spyOn(getItemCostService(), "setCost").mockReturnValue({ success: false, error: "disk full" });
    const res = await request(app).post("/api/item-costs").send(VALID);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "disk full" });
  });

  it("is admin-only", async () => {
    const spy = jest.spyOn(getItemCostService(), "setCost");
    const res = await request(app).post("/api/item-costs").set("x-test-role", "staff").send(VALID);
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});
