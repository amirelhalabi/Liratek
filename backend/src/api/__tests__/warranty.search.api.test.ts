/**
 * LIRA-296 (T013) — REST `GET /api/warranty/search`, the web twin of IPC
 * `warranty:search` (electron-app/handlers/warrantyHandlers.ts).
 *
 * Same harness as productUnits.api.test.ts: the REAL router with only the
 * auth middleware faked (header-driven role); the REAL WarrantyService
 * singleton with `search` spied, so the test asserts the exact query the
 * route hands the service and the IPC-identical envelope (HTTP 200 even on
 * a refusal, rule 19c).
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
import { getWarrantyService } from "@liratek/core";
import warrantyRouter from "../warranty.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/warranty", warrantyRouter);
  return app;
}

describe("GET /api/warranty/search", () => {
  let app: Express;
  const service = getWarrantyService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("staff can search; the parsed query reaches the service; envelope matches IPC", async () => {
    const spy = jest
      .spyOn(service, "search")
      .mockReturnValue([{ saleItemId: 1 } as never]);
    const res = await request(app)
      .get("/api/warranty/search")
      .query({ q: "RCP-12", client_day: "2026-10-10", limit: "20" })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ saleItemId: 1 }] });
    expect(spy).toHaveBeenCalledWith({
      q: "RCP-12",
      client_day: "2026-10-10",
      limit: 20,
    });
  });

  it("admin can search", async () => {
    jest.spyOn(service, "search").mockReturnValue([]);
    const res = await request(app)
      .get("/api/warranty/search")
      .query({ client_day: "2026-10-10" })
      .set("x-test-role", "admin");
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it("refuses an unauthenticated caller without searching", async () => {
    const spy = jest.spyOn(service, "search");
    const res = await request(app)
      .get("/api/warranty/search")
      .query({ client_day: "2026-10-10" });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a role outside admin/staff", async () => {
    const spy = jest.spyOn(service, "search");
    const res = await request(app)
      .get("/api/warranty/search")
      .query({ client_day: "2026-10-10" })
      .set("x-test-role", "viewer");
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("an invalid query is a 200 { success:false } envelope, never a 4xx", async () => {
    const spy = jest.spyOn(service, "search");
    const res = await request(app)
      .get("/api/warranty/search")
      .query({ client_day: "10/10/2026" })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a thrown error becomes a failure envelope", async () => {
    jest.spyOn(service, "search").mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await request(app)
      .get("/api/warranty/search")
      .query({ client_day: "2026-10-10" })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "boom" });
  });
});
