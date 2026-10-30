/**
 * LIRA-332 US1 — GET /api/subscription/status carries the derived trial
 * standing, the server-computed trial view and the shop's name/address (for
 * the WhatsApp activation link). GET /api/subscription/by-key (the desktop
 * licence channel) must NOT change shape (FR-021).
 *
 * Real router, real core and a real in-memory DB from create_db.sql, like
 * wp5_wp6_admin_tenant.api.test.ts. Only the system time is faked (tasks.md
 * "Clock"): faking timers hangs supertest.
 *
 * Failing-first: the trial, shop and by-key cases were run before
 * subscription.ts changed and failed (no `standing`/`trial`/`shop`;
 * by-key leaked `standing`/`trial` and `canWrite:false` for an ended trial).
 */

import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const JWT_TEST_SECRET = "lira332-status-secret-0123456789-0123456789-0123";
const PASSWORD = "Password123!";
const NOW = new Date("2026-10-20T09:00:00Z"); // Beirut 2026-10-20 12:00

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");

async function token(username: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

async function status(username: string) {
  const res = await request(app)
    .get("/api/subscription/status")
    .set("Authorization", `Bearer ${await token(username)}`);
  expect(res.status).toBe(200);
  return res.body.data as Record<string, unknown>;
}

beforeAll(async () => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      "nextTick",
      "setImmediate",
      "setTimeout",
      "setInterval",
      "queueMicrotask",
    ],
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
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, 'active')`,
  );
  const user = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`,
  );
  const sub = db.prepare(
    `INSERT INTO tenant_subscriptions
       (tenant_id, plan, status, license_key, trial_started_at, trial_ends_at)
     VALUES (?, 'standard', 'active', ?, ?, ?)`,
  );
  user.run(null, "root", hash, "super_admin");
  // 2: on a trial, last day 2026-11-01 (ends 2026-11-01 22:00 UTC).
  tenant.run(2, "Abou Ali Phones", "abouali");
  user.run(2, "trial_admin", hash, "admin");
  sub.run(2, "KEY-TRIAL", "2026-10-19 09:00:00", "2026-11-01 22:00:00");
  // 3: trial ended yesterday, with a licence key (desktop channel guard).
  tenant.run(3, "Ended Shop", "endedshop");
  user.run(3, "ended_staff", hash, "staff");
  sub.run(3, "KEY-ENDED", "2026-10-05 09:00:00", "2026-10-19 21:00:00");
  // 4: no subscription row at all.
  tenant.run(4, "No Row", "norow");
  user.run(4, "norow_admin", hash, "admin");

  core.resetUserRepository();
  core.resetSessionRepository();
  core.resetAuthService();
  core.resetTenantRepository();
  core.resetSubscriptionService();

  const authRoutes = (await import("../auth")).default;
  const subscriptionRoutes = (await import("../subscription")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/subscription", subscriptionRoutes);
});

afterAll(() => {
  jest.useRealTimers();
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

beforeEach(() => core.resetTenantContext());

describe("GET /api/subscription/status — trial", () => {
  it("a trial shop: standing, the server's trial view and the shop's address", async () => {
    const data = await status("trial_admin");
    expect(data).toMatchObject({
      status: "active",
      standing: "trial",
      canWrite: true,
      trial: {
        endsAt: "2026-11-01T22:00:00.000Z",
        lastDay: "2026-11-01",
        daysLeft: 13,
        endsSoon: false,
        ended: false,
      },
      shop: { name: "Abou Ali Phones", address: "abouali.liratek.test" },
    });
  });

  it("an ended trial: trial_ended, canWrite false — for every role", async () => {
    const data = await status("ended_staff");
    expect(data).toMatchObject({
      standing: "trial_ended",
      canWrite: false,
      trial: { lastDay: "2026-10-19", daysLeft: 0, ended: true },
      shop: { name: "Ended Shop", address: "endedshop.liratek.test" },
    });
  });

  it("fallbacks (no row, platform user) report active with no trial (SC-006)", async () => {
    expect(await status("norow_admin")).toMatchObject({
      status: "active",
      standing: "active",
      canWrite: true,
      trial: null,
    });
    expect(await status("root")).toMatchObject({
      standing: "active",
      canWrite: true,
      trial: null,
      shop: null,
    });
  });
});

describe("GET /api/subscription/by-key — desktop channel unchanged (FR-021)", () => {
  it.each(["KEY-TRIAL", "KEY-ENDED"])(
    "%s: today's shape — no standing/trial/shop, and canWrite from the paid reading",
    async (key) => {
      const res = await request(app)
        .get("/api/subscription/by-key")
        .set("x-liratek-license-key", key);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("standing");
      expect(data).not.toHaveProperty("trial");
      expect(data).not.toHaveProperty("shop");
      expect(data).toMatchObject({ status: "active", canWrite: true });
      expect(Object.keys(data).sort()).toEqual(
        [
          "canWrite",
          "currentPeriodEnd",
          "entitledModules",
          // LIRA-364: super admin's per-shop opt-in switches.
          "enabledFeatures",
          "graceEndsAt",
          "plan",
          "status",
          "tenantId",
        ].sort(),
      );
    },
  );
});
