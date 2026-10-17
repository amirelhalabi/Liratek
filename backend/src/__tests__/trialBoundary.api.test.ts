/**
 * LIRA-332 US4 (SC-005, US4-1…4) — around midnight, on both sides of
 * Lebanon's DST changes, the shop's status route, the owner's list and the
 * write gate agree on the trial, whatever the server's own time zone.
 *
 * Only the SYSTEM TIME is faked (tasks.md "Clock"), and every quickstart §1
 * row is walked through:
 *   - GET /api/subscription/status `trial` deep-equals the owner's
 *     GET /api/admin/subscriptions row for that shop;
 *   - a write is refused exactly on the "ended" rows.
 * A forged `X-Client-Day` of the previous day never revives an ended trial
 * (research R3: the header is never trusted for enforcement).
 *
 * The machine's zone cannot be changed from inside a jest worker (jest gives
 * each test file its own copy of process.env), so the zone is the runner's:
 * CI runs on Ubuntu in UTC, like Fly. Run it locally as
 * `TZ=UTC jest src/__tests__/trialBoundary.api.test.ts` — it was run that way
 * and under TZ=Asia/Beirut (LIRA-332), with the same result, which is the
 * point: the answer does not depend on the server's zone (rule 27).
 *
 * Not proven failing-first (new contract) for the agreement half. The
 * forged-header half guards requireOpenTrial's design.
 */

import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const JWT_TEST_SECRET = "lira332-boundary-secret-0123456789-0123456789-0";
const PASSWORD = "Password123!";

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

beforeAll(async () => {
  jest.useFakeTimers({
    now: new Date("2026-07-01T09:00:00Z"),
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
      path.join(__dirname, "../../../electron-app/create_db.sql"),
      "utf8",
    ),
  );
  const hash = core.hashPassword(PASSWORD);
  db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (NULL, 'root', ?, 'super_admin', 1)`,
  ).run(hash);
  db.prepare(`INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Edge Shop', 'edge', 'active')`).run();
  db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (2, 'edge_admin', ?, 'admin', 1)`,
  ).run(hash);
  db.prepare(
    `INSERT INTO tenant_subscriptions (tenant_id, plan, status, trial_started_at, trial_ends_at)
     VALUES (2, 'standard', 'active', '2026-01-01 00:00:00', NULL)`,
  ).run();

  for (const reset of [
    core.resetUserRepository,
    core.resetSessionRepository,
    core.resetAuthService,
    core.resetTenantRepository,
    core.resetSubscriptionService,
    core.resetSubscriptionRepository,
  ]) {
    reset();
  }

  const { requireOpenTrial } = await import("../middleware/requireOpenTrial");
  const { requireWritableSubscription } = await import(
    "../middleware/requireWritableSubscription"
  );
  const authRoutes = (await import("../api/auth")).default;
  const adminRoutes = (await import("../api/admin")).default;
  const subscriptionRoutes = (await import("../api/subscription")).default;
  app = express();
  app.use(express.json());
  app.use(requireOpenTrial);
  app.use(requireWritableSubscription);
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/subscription", subscriptionRoutes);
  // A stand-in sale route: reaching it means the gates let the write through.
  app.post("/api/sales/process", (_req, res) => {
    res.json({ success: true, reached: true });
  });
});

afterAll(() => {
  jest.useRealTimers();
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

beforeEach(() => core.resetTenantContext());

type Row = [label: string, lastDay: string, nowUtc: string, ended: boolean, previousDay: string];
// quickstart §1 (instants verified with Python zoneinfo, 2026-10-17).
const ROWS: Row[] = [
  ["summer 07-15 00:30", "2026-07-15", "2026-07-14T21:30:00Z", false, "2026-07-14"],
  ["summer 07-15 02:59 (server day 07-14)", "2026-07-15", "2026-07-14T23:59:00Z", false, "2026-07-14"],
  ["summer 07-15 23:30", "2026-07-15", "2026-07-15T20:30:00Z", false, "2026-07-14"],
  ["summer 07-16 00:30 (server day 07-15)", "2026-07-15", "2026-07-15T21:30:00Z", true, "2026-07-15"],
  ["summer 07-16 02:59", "2026-07-15", "2026-07-15T23:59:00Z", true, "2026-07-15"],
  ["winter 11-01 00:30", "2026-11-01", "2026-10-31T22:30:00Z", false, "2026-10-31"],
  ["winter 11-01 02:59", "2026-11-01", "2026-11-01T00:59:00Z", false, "2026-10-31"],
  ["winter 11-01 23:30", "2026-11-01", "2026-11-01T21:30:00Z", false, "2026-10-31"],
  ["winter 11-02 00:30", "2026-11-01", "2026-11-01T22:30:00Z", true, "2026-11-01"],
  ["autumn DST 10-24 23:30 (1st)", "2026-10-24", "2026-10-24T20:30:00Z", false, "2026-10-23"],
  ["autumn DST 10-24 23:30 (2nd)", "2026-10-24", "2026-10-24T21:30:00Z", false, "2026-10-23"],
  ["autumn DST 10-25 00:30", "2026-10-24", "2026-10-24T22:30:00Z", true, "2026-10-24"],
  ["spring DST 03-27 23:30", "2027-03-27", "2027-03-27T21:30:00Z", false, "2027-03-26"],
  ["spring DST 03-28 01:00", "2027-03-27", "2027-03-27T22:00:00Z", true, "2027-03-27"],
];

describe("status, owner list and gate agree at every boundary (server in UTC)", () => {
  it.each(ROWS)("%s", async (_label, lastDay, nowUtc, ended, previousDay) => {
    db.prepare(`UPDATE tenant_subscriptions SET trial_ends_at = ? WHERE tenant_id = 2`).run(
      core.toUtcSqlTimestamp(core.endOfShopDay(lastDay)),
    );
    jest.setSystemTime(new Date(nowUtc));
    const shopToken = await token("edge_admin");
    const rootToken = await token("root");

    const status = await request(app)
      .get("/api/subscription/status")
      .set("Authorization", `Bearer ${shopToken}`);
    const list = await request(app)
      .get("/api/admin/subscriptions")
      .set("Authorization", `Bearer ${rootToken}`);
    const ownerRow = (list.body.data.subscriptions as Array<Record<string, unknown>>).find(
      (r) => r.tenant_id === 2,
    )!;

    expect(status.body.data.trial).toEqual(ownerRow.trial);
    expect(status.body.data.standing).toBe(ownerRow.standing);
    expect(status.body.data.trial).toMatchObject({ lastDay, ended });
    expect(status.body.data.standing).toBe(ended ? "trial_ended" : "trial");

    const sale = await request(app)
      .post("/api/sales/process")
      .set("Authorization", `Bearer ${shopToken}`)
      .set("X-Client-Day", previousDay)
      .send({});
    if (ended) {
      // Refused even though the client claims it is still the day before.
      expect(sale.body).toMatchObject({ success: false, code: "TRIAL_ENDED" });
    } else {
      expect(sale.body).toEqual({ success: true, reached: true });
    }
  });
});
