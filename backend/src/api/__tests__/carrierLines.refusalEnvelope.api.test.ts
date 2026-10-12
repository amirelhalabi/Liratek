/**
 * Carrier line REST routes answer a refusal the IPC way — HTTP 200 with
 * `{ success: false, error }` (CLAUDE.md rule 19c, envelope parity).
 *
 * Found live on the test tenant 2026-10-12 (LIRA-309 check): adding a shop
 * line with the number of a line held for sale was refused correctly, but as
 * HTTP 400. The web adapter's `requestJson` throws on a 4xx, so the Carrier
 * Lines form showed a generic "Operation failed" instead of the reason.
 *
 * Written before the fix; first run failed on every case (400 received).
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    req.user = {
      userId: 42,
      username: "tester",
      role: req.headers["x-test-role"] ?? "admin",
      tenantId: 1,
      sessionToken: "test-session",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

const REFUSAL = {
  success: false,
  error: "This number is already one of your lines.",
};
const refuse = () => REFUSAL;
const service = {
  create: jest.fn(refuse),
  update: jest.fn(refuse),
  updateBalance: jest.fn(refuse),
  archive: jest.fn(refuse),
  toggleActive: jest.fn(refuse),
};

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return { ...actual, getCarrierLineService: () => service };
});

import express, { type Express } from "express";
import request from "supertest";
import carrierLinesRoutes from "../carrierLines.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/carrier-lines", carrierLinesRoutes);
  return app;
}

describe("Carrier line REST routes — refusals use the 200 envelope", () => {
  const app = buildApp();

  it("POST / (create) — refused → 200 + reason", async () => {
    const res = await request(app)
      .post("/api/carrier-lines")
      .send({ carrier: "alfa", phone_number: "70 444 202", credits: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(REFUSAL);
  });

  it("PUT /:id (update) — refused → 200 + reason", async () => {
    const res = await request(app)
      .put("/api/carrier-lines/3")
      .send({ phone_number: "70444202" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(REFUSAL);
  });

  it("PUT /:id/balance — refused → 200 + reason", async () => {
    const res = await request(app)
      .put("/api/carrier-lines/3/balance")
      .send({ credits: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(REFUSAL);
  });

  it("PUT /:id/archive — refused → 200 + reason", async () => {
    const res = await request(app).put("/api/carrier-lines/3/archive");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(REFUSAL);
  });

  it("PUT /:id/toggle-active — refused → 200 + reason", async () => {
    const res = await request(app).put("/api/carrier-lines/3/toggle-active");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(REFUSAL);
  });

  it("a bad id is refused with 200 + an error string", async () => {
    const res = await request(app).put("/api/carrier-lines/abc/archive");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
  });
});
