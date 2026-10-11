/**
 * LIRA-306 T081 — PINS TODAY'S BEHAVIOUR of the basket-line REST routes
 * (`POST /api/sessions/:id/cart`, `DELETE /api/sessions/:id/cart/:itemId`,
 * `DELETE /api/sessions/:id/cart`), written before their direct
 * `CustomerSessionRepository` calls moved behind `CustomerSessionService`
 * (rule 13). Not a failing-first guard: it must pass before AND after the
 * move. IPC twin: electron-app/handlers/__tests__/sessionHandlers.cartPin.test.ts.
 *
 * Real schema in memory (the real better-sqlite3, not the backend mock); the
 * JWT middleware is stubbed to a fixed user; tenant 1 comes from jest.setup.
 */
import { jest } from "@jest/globals";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));
jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, _res: any, next: any) => {
    req.user = { userId: 1, username: "admin", role: "admin", tenantId: 1, sessionToken: "s" };
    next();
  };
  const requireRole = () => (_req: any, _res: any, next: any) => next();
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;
import express from "express";
import request from "supertest";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let previousDb: unknown;

const LINE = {
  item_id: "line-1",
  module: "custom_service",
  label: "Screen protector",
  amount: 20,
  currency: "USD",
  form_data: JSON.stringify({ description: "Screen protector", price_usd: 20, cost_usd: 5 }),
  ipc_channel: "custom-services:add",
};

beforeEach(async () => {
  previousDb = (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db = new RealDatabase(":memory:");
  db.exec(fs.readFileSync(path.join(__dirname, "../../../../electron-app/create_db.sql"), "utf8"));
  db.exec(`INSERT INTO customer_sessions (id, tenant_id, customer_name, started_by) VALUES (1, 1, 'Walk-in', 'admin')`);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  const routes = (await import("../sessions.js")).default;
  app = express();
  app.use(express.json());
  app.use("/api/sessions", routes);
});

afterEach(() => {
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = previousDb;
  db.close();
});

const lines = () => db.prepare(`SELECT session_id, item_id, module, amount, currency, user_id FROM session_cart_items ORDER BY id`).all();

describe("session cart over REST — today's results (pin)", () => {
  it("add → { success: true, id }; remove → { success: true }; clear → { success: true }", async () => {
    expect((await request(app).post("/api/sessions/1/cart").send(LINE)).body).toEqual({ success: true, id: 1 });
    expect((await request(app).post("/api/sessions/1/cart").send({ ...LINE, item_id: "line-2" })).body).toEqual({ success: true, id: 2 });
    expect(lines()).toEqual([
      { session_id: 1, item_id: "line-1", module: "custom_service", amount: 20, currency: "USD", user_id: 1 },
      { session_id: 1, item_id: "line-2", module: "custom_service", amount: 20, currency: "USD", user_id: 1 },
    ]);
    expect((await request(app).delete("/api/sessions/1/cart/line-1")).body).toEqual({ success: true });
    expect(lines()).toHaveLength(1);
    expect((await request(app).delete("/api/sessions/1/cart")).body).toEqual({ success: true });
    expect(lines()).toEqual([]);
  });

  it("a custom-service line with no selling price is refused (HTTP 200, envelope)", async () => {
    const res = await request(app)
      .post("/api/sessions/1/cart")
      .send({ ...LINE, form_data: JSON.stringify({ description: "x" }) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(String(res.body.error).length).toBeGreaterThan(0);
    expect(lines()).toEqual([]);
  });

  it("an invalid session id is refused with the route's message", async () => {
    expect((await request(app).delete("/api/sessions/abc/cart")).body).toEqual({ success: false, error: "Invalid session ID" });
  });
});
