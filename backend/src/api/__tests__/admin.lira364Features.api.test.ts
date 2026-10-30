/**
 * LIRA-364 — super admin switches an opt-in feature (Monthly progress / KPI
 * snapshots) on or off for ONE shop from the Plan window:
 * PUT /api/admin/subscriptions/:tenantId/features { features }, a validated
 * route of its own (LIRA-332 research R10: never new keys on the unvalidated
 * PATCH), and GET /api/admin/subscriptions shows the switches per shop.
 *
 * Harness copied from admin.trial.api.test.ts (real routers, real core, a
 * real in-memory DB from create_db.sql).
 *
 * RULE 17 — written before the route existed.
 */

import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const JWT_TEST_SECRET = "lira364-admin-secret-0123456789-0123456789-01234";
const PASSWORD = "Password123!";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let rootToken: string;

async function token(username: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

function features(tenantId: number): unknown {
  return (
    db
      .prepare(
        `SELECT enabled_features FROM tenant_subscriptions WHERE tenant_id = ?`,
      )
      .get(tenantId) as { enabled_features: string | null }
  ).enabled_features;
}

function put(tenantId: number, body: unknown, bearer = rootToken) {
  return request(app)
    .put(`/api/admin/subscriptions/${tenantId}/features`)
    .set("Authorization", `Bearer ${bearer}`)
    .send(body as object);
}

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_TEST_SECRET;
  process.env.APP_BASE_DOMAIN = "liratek.test";

  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  core = await import("@liratek/core");
  db.exec(
    fs.readFileSync(
      path.join(__dirname, "../../../../electron-app/create_db.sql"),
      "utf8",
    ),
  );
  const hash = core.hashPassword(PASSWORD);
  const user = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`,
  );
  user.run(null, "root", hash, "super_admin");
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active'), (3, 'Other', 'other', 'active')`,
  ).run();
  user.run(2, "ct_admin", hash, "admin");
  db.prepare(
    `INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES (2, 'standard', 'active'), (3, 'standard', 'active')`,
  ).run();

  for (const reset of [
    core.resetUserRepository,
    core.resetSessionRepository,
    core.resetAuthService,
    core.resetTenantRepository,
    core.resetAuditRepository,
    core.resetAuditService,
    core.resetSubscriptionService,
    core.resetSubscriptionRepository,
  ]) {
    reset();
  }

  const authRoutes = (await import("../auth")).default;
  const adminRoutes = (await import("../admin")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  rootToken = await token("root");
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

beforeEach(() => core.resetTenantContext());

describe("Plan window → Features (LIRA-364)", () => {
  it("switches Monthly progress on for one shop only", async () => {
    const res = await put(2, { features: ["kpi_snapshots"] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(features(2)).toBe('["kpi_snapshots"]');
    expect(features(3)).toBeNull();
  });

  it("the subscriptions list shows each shop's switches", async () => {
    const res = await request(app)
      .get("/api/admin/subscriptions")
      .set("Authorization", `Bearer ${rootToken}`);
    const rows = res.body.data.subscriptions as Array<{
      tenant_id: number;
      enabledFeatures: string[];
    }>;
    expect(rows.find((r) => r.tenant_id === 2)?.enabledFeatures).toEqual([
      "kpi_snapshots",
    ]);
    expect(rows.find((r) => r.tenant_id === 3)?.enabledFeatures).toEqual([]);
  });

  it("switches it off again", async () => {
    await put(2, { features: [] });
    expect(features(2)).toBe("[]");
  });

  it("changing the modules leaves the switches alone", async () => {
    await put(2, { features: ["kpi_snapshots"] });
    await request(app)
      .patch(`/api/admin/subscriptions/2`)
      .set("Authorization", `Bearer ${rootToken}`)
      .send({ entitledModules: null });
    expect(features(2)).toBe('["kpi_snapshots"]');
  });

  it("refuses an unknown feature", async () => {
    // Validation answers with the 200 failure envelope (rule 6).
    const res = await put(3, { features: ["made_up"] });
    expect(res.body.success).toBe(false);
    expect(features(3)).toBeNull();
  });

  it("is written to the audit trail", async () => {
    await put(3, { features: ["kpi_snapshots"] });
    const row = db
      .prepare(
        `SELECT summary FROM audit_log WHERE entity_type = 'subscription' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { summary: string };
    expect(row.summary).toMatch(/kpi_snapshots/);
    await put(3, { features: [] });
  });

  it("a shop's own admin cannot switch it", async () => {
    const t = await token("ct_admin");
    const before = features(3);
    const res = await put(3, { features: ["kpi_snapshots"] }, t);
    expect(res.status).toBe(403);
    expect(features(3)).toBe(before);
  });
});
