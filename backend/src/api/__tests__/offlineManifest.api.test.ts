/**
 * LIRA-306 T067 — POST /api/offline/manifest (FR-035, FR-036, N5), device key,
 * over a REAL in-memory database; shop = tenant 2 (see offlineDevice.api.test.ts).
 * A row in the PC's range that no event it sent created → `pc_data_mismatch`
 * for tenant 2; HTTP 200 envelope; malformed body refused.
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
let key = "";

const COPY = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  process.env.JWT_SECRET = "offline-manifest-test-secret-0123456789-0123456789";
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  core = await import("@liratek/core");
  db.exec(fs.readFileSync(path.join(__dirname, "../../../../electron-app/create_db.sql"), "utf8"));
  db.exec(`INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active')`);
  db.prepare(`INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (20, 2, 'owner', ?, 'admin', 1)`).run(
    core.hashPassword("Owner-pass-2026"),
  );
  const offline = (await import("../offline.js")).default;
  app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  app.use("/api/offline", offline);
  const res = await request(app)
    .post("/api/offline/pair")
    .set("fly-client-ip", "198.51.100.77")
    .send({ shop: "cornertech", username: "owner", password: "Owner-pass-2026", deviceName: "Front PC" });
  key = res.body.data.deviceKey;
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

type ManifestBody = z.input<typeof import("@liratek/core").manifestSchema>;
const pcClient = (k: number) => 1_000_000_000_000 + core.offlineTableIndex("clients") * 1_000_000_000 + k;

describe("POST /api/offline/manifest", () => {
  it("an unexplained row → matched:false + a pc_data_mismatch item for tenant 2 (HTTP 200)", async () => {
    const body: ManifestBody = { copyId: COPY, tables: { clients: [pcClient(9)] }, readWrites: [] };
    expect(core.manifestSchema.safeParse(body).success).toBe(true);
    const res = await request(app).post("/api/offline/manifest").set("x-liratek-device-key", key).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { matched: false, unexplained: [{ table: "clients", ids: [pcClient(9)] }] } });
    expect(db.prepare(`SELECT tenant_id, kind FROM offline_review_items`).all()).toEqual([{ tenant_id: 2, kind: "pc_data_mismatch" }]);
  });

  it("nothing unexplained → matched:true", async () => {
    const res = await request(app).post("/api/offline/manifest").set("x-liratek-device-key", key).send({ copyId: COPY, tables: {}, readWrites: [] });
    expect(res.body).toEqual({ success: true, data: { matched: true, unexplained: [] } });
  });

  it("no key → refused; malformed body → refused", async () => {
    const nokey = await request(app).post("/api/offline/manifest").send({ copyId: COPY, tables: {}, readWrites: [] });
    expect(nokey.body.success).toBe(false);
    const bad = await request(app).post("/api/offline/manifest").set("x-liratek-device-key", key).send({ tables: "x" });
    expect(bad.body.success).toBe(false);
  });
});
