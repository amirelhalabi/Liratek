/**
 * FIX 1 (security review) — /health/detailed must not leak cross-tenant
 * business aggregates.
 *
 * `/health` is mounted UNAUTHENTICATED (server.ts: `app.use("/health", ...)`,
 * no `/api` prefix, no `authenticateJWT`) — by design, for load balancers and
 * uptime monitors that carry no credentials. Before this fix, `checkDatabase()`
 * ran a raw, unscoped
 *   SELECT (SELECT COUNT(*) FROM clients), (SELECT COUNT(*) FROM products),
 *          (SELECT COUNT(*) FROM sales WHERE date(created_at) = date('now'))
 * with no `tenant_id` filter and returned it as `checks.database.stats` to
 * ANY anonymous caller — in multi-tenant mode that's a platform-wide,
 * cross-tenant business-data leak (every tenant's client/product/sales counts
 * summed and handed to whoever hits the endpoint). The fix removes the
 * aggregate entirely; a health check proves DB connectivity, not what's in
 * the DB. This suite proves the leaked fields are gone and the connectivity
 * signal still works.
 */

import { jest } from "@jest/globals";

jest.mock("../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockGet = jest.fn(() => ({ test: 1 }));
const mockPrepare = jest.fn(() => ({ get: mockGet }));
const mockDb = { prepare: mockPrepare };

jest.mock("../database/connection.js", () => ({
  getDatabase: jest.fn(() => mockDb),
}));

import express from "express";
import request from "supertest";
import healthRoutes from "../api/health";

describe("health routes", () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use("/health", healthRoutes);
  });

  afterEach(() => {
    mockPrepare.mockClear();
    mockGet.mockClear();
  });

  describe("GET /health/detailed", () => {
    it("is reachable without any auth header and reports DB connectivity healthy", async () => {
      // Overall response status also folds in memory/system checks (real
      // process heap/load, not mocked) — not this fix's concern. Only the DB
      // check (the thing we mock and the thing that leaked data) must be
      // deterministically healthy here.
      const res = await request(app).get("/health/detailed");
      expect([200, 503]).toContain(res.status);
      expect(res.body.checks.database.healthy).toBe(true);
    });

    it("does not include a `stats` field or any business-data counts", async () => {
      const res = await request(app).get("/health/detailed");
      const dbCheck = res.body.checks.database;

      expect(dbCheck.healthy).toBe(true);
      expect(dbCheck).not.toHaveProperty("stats");
      expect(dbCheck).not.toHaveProperty("clients");
      expect(dbCheck).not.toHaveProperty("products");
      expect(dbCheck).not.toHaveProperty("sales_today");

      // Belt-and-braces over the whole payload, not just the expected spot.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toMatch(/"clients"|"products"|"sales_today"/);
    });

    it("still reports DB latency (connectivity signal preserved)", async () => {
      const res = await request(app).get("/health/detailed");
      expect(typeof res.body.checks.database.latency).toBe("number");
    });

    it("only ever issues a bare connectivity probe — never queries clients/products/sales tables", async () => {
      await request(app).get("/health/detailed");
      const queriesIssued = mockPrepare.mock.calls.map((c) => String(c[0]));
      expect(queriesIssued.length).toBeGreaterThan(0);
      for (const q of queriesIssued) {
        expect(q).not.toMatch(/FROM\s+(clients|products|sales)\b/i);
      }
    });
  });

  describe("GET /health (basic)", () => {
    it("responds 200 and never touches the database", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(mockPrepare).not.toHaveBeenCalled();
    });
  });
});
