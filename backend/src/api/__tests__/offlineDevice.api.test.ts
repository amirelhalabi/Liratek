/**
 * LIRA-306 T048 — the PC (device-key) routes of /api/offline (FR-003,
 * contracts/rest-offline.md), over a REAL in-memory database.
 *
 * The shop under test is tenant 2: backend jest fixes a tenant-1 fallback
 * (jest.setup.ts), which would hide a route that forgot to enter the key's
 * tenant — every row asserted here must carry tenant_id 2.
 * Envelope: HTTP 200 on business failure (rule 19c). Bodies are built from
 * the core schemas' input types (rule 24).
 */
import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let deviceAuth: typeof import("../../middleware/deviceAuth.js");
let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

type PairBody = z.input<typeof import("@liratek/core").pairDeviceSchema>;
const PAIR: PairBody = { shop: "cornertech", username: "owner", password: "Owner-pass-2026", deviceName: "Front PC" };

function pair(body: PairBody) {
  expect(core.pairDeviceSchema.safeParse(body).success).toBe(true);
  return request(app).post("/api/offline/pair").set("fly-client-ip", nextIp()).send(body);
}

const COPY = "11111111-1111-4111-8111-111111111111";
function event(seq: number) {
  return {
    eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq,
    channel: "sales:update-metadata",
    payload: { id: 5, note: "x" },
    actorUserId: 20,
    occurredAt: "2026-10-10T20:50:00.000Z",
    clientDay: "2026-10-10",
    clientTzOffsetMinutes: 180,
    copyId: COPY,
    schemaShape: { type: "object" },
    rates: { LBP: { sell: 90000, buy: 89500, market: 89750, direction: 1 as const } },
    created: {},
    dependsOn: [],
  };
}

beforeAll(async () => {
  process.env.JWT_SECRET = "offline-device-test-secret-0123456789-0123456789";
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  core = await import("@liratek/core");
  db.exec(fs.readFileSync(path.join(__dirname, "../../../../electron-app/create_db.sql"), "utf8"));
  db.exec(`INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active')`);
  const ins = db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (?, 2, ?, ?, ?, 1)`,
  );
  ins.run(20, "owner", core.hashPassword("Owner-pass-2026"), "admin");
  ins.run(21, "cashier", core.hashPassword("Cash-pass-2026"), "staff");

  deviceAuth = await import("../../middleware/deviceAuth.js");
  const offline = (await import("../offline.js")).default;
  app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  app.use("/api/offline", offline);
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("POST /api/offline/pair", () => {
  it("pairs a PC of tenant 2 and returns its key once", async () => {
    const res = await pair(PAIR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ deviceNo: 1, tenantId: 2, shopSlug: "cornertech" });
    expect(res.body.data.deviceKey).toMatch(/^ltd_2_[0-9a-f]{12}_[0-9a-f]{64}$/);
    expect(db.prepare(`SELECT tenant_id, device_no FROM offline_devices`).all()).toEqual([{ tenant_id: 2, device_no: 1 }]);
    // the sign-in session was revoked at once
    expect(db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 20`).get()).toEqual({ n: 0 });
  });

  it("staff → ADMIN_ONLY, wrong password → INVALID_CREDENTIALS, both HTTP 200", async () => {
    const staff = await pair({ ...PAIR, username: "cashier", password: "Cash-pass-2026" });
    expect(staff.status).toBe(200);
    expect(staff.body).toMatchObject({ success: false, code: "ADMIN_ONLY" });
    const wrong = await pair({ ...PAIR, password: "nope-nope-nope" });
    expect(wrong.status).toBe(200);
    expect(wrong.body).toMatchObject({ success: false, code: "INVALID_CREDENTIALS" });
  });

  it("re-pair with deviceNo re-keys the same PC", async () => {
    const res = await pair({ ...PAIR, deviceNo: 1 });
    expect(res.body.data.deviceNo).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM offline_devices`).get()).toEqual({ n: 1 });
  });
});

describe("device-key routes", () => {
  let key = "";
  beforeAll(async () => {
    key = (await pair({ ...PAIR, deviceName: "Back PC" })).body.data.deviceKey;
  });

  it("refuses a malformed key without reading the database", async () => {
    const spy = jest.spyOn(core.OfflineDeviceRepository.prototype, "findByKeyId");
    const res = await request(app).post("/api/offline/checkin").set("x-liratek-device-key", "garbage").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, code: "INVALID_DEVICE_KEY" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("refuses a key whose tenant id was changed (cross-tenant)", async () => {
    const forged = key.replace(/^ltd_2_/, "ltd_1_");
    const res = await request(app).get("/api/offline/events/status").set("x-liratek-device-key", forged);
    expect(res.body).toMatchObject({ success: false, code: "INVALID_DEVICE_KEY" });
  });

  it("check-in records the PC's state in tenant 2 and returns the server's counters", async () => {
    const body: z.input<typeof core.checkinSchema> = {
      state: "standby",
      pendingCount: 0,
      appVersion: "1.0.0",
      schemaVersion: 210,
      pcClock: new Date().toISOString(),
    };
    const res = await request(app).post("/api/offline/checkin").set("x-liratek-device-key", key).send(body);
    expect(res.body).toMatchObject({ success: true, data: { maxSeq: 0, renumberUnsent: false } });
    expect(db.prepare(`SELECT tenant_id, last_state FROM offline_devices WHERE device_no = 2`).get()).toEqual({
      tenant_id: 2,
      last_state: "standby",
    });
  });

  it("uploads events into tenant 2 and reports their status", async () => {
    const body: z.input<typeof core.uploadEventsSchema> = {
      appVersion: "1.0.0",
      schemaVersion: 210,
      pcClock: new Date().toISOString(),
      events: [event(1), event(2)],
    };
    const up = await request(app).post("/api/offline/events").set("x-liratek-device-key", key).send(body);
    expect(up.body).toMatchObject({ success: true, data: { acked: [event(1).eventId, event(2).eventId], rejected: [] } });
    expect(db.prepare(`SELECT DISTINCT tenant_id FROM offline_events`).all()).toEqual([{ tenant_id: 2 }]);
    const st = await request(app).get("/api/offline/events/status?fromSeq=2").set("x-liratek-device-key", key);
    expect(st.body.data.outcomes).toEqual([
      { eventId: event(2).eventId, seq: 2, status: "received", error: null, serverIds: null },
    ]);
  });

  it("a newer PC data version is refused for the whole upload (HTTP 200)", async () => {
    const res = await request(app)
      .post("/api/offline/events")
      .set("x-liratek-device-key", key)
      .send({ appVersion: "9", schemaVersion: 9999, pcClock: new Date().toISOString(), events: [event(3)] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, code: "VERSION_AHEAD" });
  });

  it("rate-limit identity: device:<tenant>:<keyId> for a verified key only", () => {
    const keyId = key.split("_")[2];
    const req = (k: string) => ({ headers: { "x-liratek-device-key": k } }) as never;
    expect(deviceAuth.deviceRateLimitIdentity(req(key))).toBe(`device:2:${keyId}`);
    expect(deviceAuth.deviceRateLimitIdentity(req(key.slice(0, -2) + "00"))).toBeNull();
    expect(deviceAuth.deviceRateLimitIdentity(req("nope"))).toBeNull();
  });

  it("a revoked key is refused with DEVICE_REVOKED", async () => {
    db.prepare(`UPDATE offline_devices SET revoked_at = '2026-10-11T00:00:00Z' WHERE device_no = 2`).run();
    const res = await request(app).get("/api/offline/events/status").set("x-liratek-device-key", key);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, code: "DEVICE_REVOKED" });
  });
});
