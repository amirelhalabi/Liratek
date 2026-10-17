/**
 * LIRA-332 US3 — the owner's trial actions on the control plane:
 * POST /api/admin/subscriptions/:tenantId/activate, /extend-trial and
 * GET .../history, plus the trial fields on GET /api/admin/subscriptions.
 * Also FR-004: a shop the owner creates (POST /api/admin/tenants) is NOT on a
 * trial.
 *
 * Real routers, real core, a real in-memory DB from create_db.sql (the
 * wp5_wp6_admin_tenant.api.test.ts harness). Only the system time is faked.
 * `scheduleOfflineRound` is mocked to prove held PC events get a round
 * after the owner acts (research R8).
 *
 * Not proven failing-first (new routes): before them these requests 404'd.
 */

import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const scheduleOfflineRound = jest.fn();
jest.mock("../../offline/processorTimer.js", () => ({
  scheduleOfflineRound: (tenantId: number) => scheduleOfflineRound(tenantId),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";
// @liratek/core is imported in beforeAll, AFTER JWT_SECRET is set: core's
// env.ts parses process.env when the module first loads.

const JWT_TEST_SECRET = "lira332-admin-secret-0123456789-0123456789-01234";
const PASSWORD = "Password123!";
const NOW = new Date("2026-10-20T09:00:00Z"); // Beirut 2026-10-20

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

function subRow(tenantId: number) {
  return db
    .prepare(`SELECT * FROM tenant_subscriptions WHERE tenant_id = ?`)
    .get(tenantId) as Record<string, unknown>;
}

function post(path: string, body: unknown, bearer = rootToken) {
  return request(app)
    .post(path)
    .set("Authorization", `Bearer ${bearer}`)
    .send(body as object);
}

beforeAll(async () => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"],
  });
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
  const tenant = db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)`,
  );
  const user = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`,
  );
  const sub = db.prepare(
    `INSERT INTO tenant_subscriptions (tenant_id, plan, status, trial_started_at, trial_ends_at)
     VALUES (?, 'standard', 'active', ?, ?)`,
  );
  user.run(null, "root", hash, "super_admin");
  tenant.run(2, "Shop A", "shopa", "active");
  user.run(2, "a_admin", hash, "admin");
  user.run(2, "a_staff", hash, "staff");
  sub.run(2, "2026-10-10 09:00:00", "2026-10-23 21:00:00"); // trial, last day 10-23
  tenant.run(3, "Shop B", "shopb", "active");
  sub.run(3, "2026-10-01 09:00:00", "2026-10-14 21:00:00"); // trial ended
  tenant.run(4, "Shop C", "shopc", "suspended");
  sub.run(4, "2026-10-01 09:00:00", "2026-10-14 21:00:00"); // ended + suspended

  for (const reset of [
    core.resetUserRepository,
    core.resetSessionRepository,
    core.resetAuthService,
    core.resetTenantRepository,
    core.resetTenantProvisioningService,
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
  jest.useRealTimers();
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

beforeEach(() => {
  core.resetTenantContext();
  scheduleOfflineRound.mockReset();
});

describe("owner-only (FR-017)", () => {
  it.each(["a_admin", "a_staff"])("%s gets 403 on every new route", async (username) => {
    const t = await token(username);
    expect((await post("/api/admin/subscriptions/2/activate", { until: null }, t)).status).toBe(403);
    expect((await post("/api/admin/subscriptions/2/extend-trial", { lastDay: "2026-11-01" }, t)).status).toBe(403);
    const hist = await request(app)
      .get("/api/admin/subscriptions/2/history")
      .set("Authorization", `Bearer ${t}`);
    expect(hist.status).toBe(403);
    expect(subRow(2).trial_ends_at).toBe("2026-10-23 21:00:00");
  });

  it("an impersonation token gets 403", async () => {
    const imp = await request(app)
      .post("/api/admin/tenants/2/impersonate")
      .set("Authorization", `Bearer ${rootToken}`);
    expect(imp.status).toBe(200);
    const impToken = imp.body.data.token as string;
    expect((await post("/api/admin/subscriptions/2/activate", { until: null }, impToken)).status).toBe(403);
  });
});

describe("validation", () => {
  it.each([
    ["/api/admin/subscriptions/2/activate", { until: "2026-02-30" }],
    ["/api/admin/subscriptions/2/activate", {}],
    ["/api/admin/subscriptions/2/extend-trial", { lastDay: "31/10/2026" }],
    ["/api/admin/subscriptions/abc/extend-trial", { lastDay: "2026-11-01" }],
  ])("%s %j is refused", async (path, body) => {
    const res = await post(path, body);
    expect(res.body.success).toBe(false);
    expect(scheduleOfflineRound).not.toHaveBeenCalled();
  });

  it("a past day is refused with the service's text", async () => {
    const res = await post("/api/admin/subscriptions/2/extend-trial", { lastDay: "2026-10-19" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Choose a date in the future");
  });

  it("an unknown tenant is 404", async () => {
    const res = await post("/api/admin/subscriptions/99/activate", { until: null });
    expect(res.status).toBe(404);
  });

  it("the bodies used here are valid per the schemas (rule 24)", () => {
    expect(core.activateSubscriptionSchema.safeParse({ until: null }).success).toBe(true);
    expect(core.extendTrialSchema.safeParse({ lastDay: "2026-11-15" }).success).toBe(true);
  });
});

describe("extend, activate, history", () => {
  it("extend-trial on shop B (ended) → trial again; shop A untouched; audited; round scheduled", async () => {
    const aBefore = subRow(2);
    const res = await post("/api/admin/subscriptions/3/extend-trial", { lastDay: "2026-11-15" });
    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toMatchObject({
      standing: "trial",
      trial: { lastDay: "2026-11-15", ended: false },
    });
    expect(subRow(3).trial_ends_at).toBe("2026-11-15 22:00:00");
    expect(subRow(2)).toEqual(aBefore);
    expect(scheduleOfflineRound).toHaveBeenCalledWith(3);

    const hist = await request(app)
      .get("/api/admin/subscriptions/3/history")
      .set("Authorization", `Bearer ${rootToken}`);
    expect(hist.status).toBe(200);
    const [entry] = hist.body.data.entries;
    expect(entry).toMatchObject({
      actor: "root",
      action: "extend_trial",
      oldValues: {
        standing: "trial_ended",
        trialEndsAt: "2026-10-14T21:00:00.000Z",
        trialLastDay: "2026-10-14",
        currentPeriodEnd: null,
      },
      newValues: {
        standing: "trial",
        trialEndsAt: "2026-11-15T22:00:00.000Z",
        trialLastDay: "2026-11-15",
        currentPeriodEnd: null,
      },
    });
  });

  it("activate until a day on shop A → paying; shop B byte-identical (US3-4)", async () => {
    const bBefore = subRow(3);
    const res = await post("/api/admin/subscriptions/2/activate", { until: "2027-10-31" });
    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toMatchObject({ standing: "active", trial: null });
    expect(subRow(2)).toMatchObject({
      status: "active",
      current_period_end: "2027-10-31 22:00:00",
      trial_started_at: null,
      trial_ends_at: null,
    });
    expect(subRow(3)).toEqual(bBefore);
    expect(scheduleOfflineRound).toHaveBeenCalledWith(2);
    const audit = db
      .prepare(
        `SELECT action, entity_type, old_values, new_values FROM audit_log
          WHERE tenant_id IS NULL AND action = 'activate_subscription' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { old_values: string; new_values: string; entity_type: string };
    expect(audit.entity_type).toBe("subscription");
    expect(JSON.parse(audit.old_values)).toMatchObject({ standing: "trial" });
    expect(JSON.parse(audit.new_values)).toMatchObject({
      standing: "active",
      currentPeriodEnd: "2027-10-31 22:00:00",
      trialEndsAt: null,
    });
  });

  it("activate on a suspended shop leaves it suspended (FR-016)", async () => {
    const res = await post("/api/admin/subscriptions/4/activate", { until: null });
    expect(res.status).toBe(200);
    expect(
      (db.prepare(`SELECT status FROM tenants WHERE id = 4`).get() as { status: string }).status,
    ).toBe("suspended");
  });
});

describe("GET /api/admin/subscriptions (FR-015)", () => {
  it("each row carries standing, trial and the shop's creation date", async () => {
    // Fresh state for one row: put shop B back on an ended trial.
    db.prepare(
      `UPDATE tenant_subscriptions SET trial_ends_at = '2026-10-14 21:00:00' WHERE tenant_id = 3`,
    ).run();
    const res = await request(app)
      .get("/api/admin/subscriptions")
      .set("Authorization", `Bearer ${rootToken}`);
    expect(res.status).toBe(200);
    const rows = res.body.data.subscriptions as Array<Record<string, unknown>>;
    const b = rows.find((r) => r.tenant_id === 3)!;
    expect(b).toMatchObject({
      standing: "trial_ended",
      trial: { lastDay: "2026-10-14", ended: true, daysLeft: 0 },
    });
    expect(typeof b.tenant_created_at).toBe("string");
    const def = rows.find((r) => r.tenant_id === 1);
    if (def) expect(def).toMatchObject({ standing: "active", trial: null });
  });
});

describe("FR-004: owner-created shops are not on a trial", () => {
  it("POST /api/admin/tenants → active, no trial", async () => {
    const res = await post("/api/admin/tenants", {
      name: "Owner Made",
      slug: "ownermade",
      adminUsername: "om_admin",
      adminPassword: "Str0ng-Password!",
    });
    expect(res.status).toBe(201);
    const id = res.body.data.tenant.id as number;
    expect(subRow(id)).toMatchObject({
      status: "active",
      current_period_end: null,
      trial_started_at: null,
      trial_ends_at: null,
    });
    expect(core.getSubscriptionService().statusFor(id)).toMatchObject({
      standing: "active",
      trial: null,
    });
  });
});
