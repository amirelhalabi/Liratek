/**
 * LIRA-306 T115 — GET /api/offline/snapshot (FR-005, FR-007,
 * contracts/rest-offline.md) over a REAL in-memory database.
 *
 * The shop under test is tenant 2 (backend jest falls back to tenant 1, which
 * would hide a route that forgot the key's tenant). A tenant-1 client is
 * seeded and must NOT be in the copy.
 *
 * The PC names its data version in the query (`?schemaVersion=n`,
 * O-impl-E-1). Any difference from the server's version is VERSION_MISMATCH:
 * HTTP 200 + JSON envelope, nothing built, nothing recorded.
 *
 * The body is the gzip bytes as `application/octet-stream` WITHOUT
 * `Content-Encoding: gzip` — otherwise fetch/supertest would inflate it
 * silently and the PC's integrity check would run on different bytes.
 *
 * Backend jest maps `better-sqlite3` to a mock, so the route's snapshot
 * service is injected with the real constructor (Agent D's T115 note).
 */
import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
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
let offlineRoutes: typeof import("../offline.js");
let key = "";
let serverVersion = 0;
let buildCalls = 0;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-snap-route-"));

type PairBody = z.input<typeof import("@liratek/core").pairDeviceSchema>;
const PAIR: PairBody = { shop: "cornertech", username: "owner", password: "Owner-pass-2026", deviceName: "Front PC" };

function binaryParser(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

beforeAll(async () => {
  process.env.JWT_SECRET = "offline-snapshot-test-secret-0123456789-0123456789";
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  core = await import("@liratek/core");
  db.exec(fs.readFileSync(path.join(__dirname, "../../../../electron-app/create_db.sql"), "utf8"));
  serverVersion = core.MIGRATIONS[core.MIGRATIONS.length - 1]!.version;
  // the copy's version comes from schema_migrations; mark the fresh schema as current
  const hasMig = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).get();
  if (hasMig) {
    const v = db.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get() as { v: number | null };
    if ((v.v ?? 0) < serverVersion) {
      db.prepare(`INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, 'test')`).run(serverVersion);
    }
  }
  db.exec(`INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active')`);
  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (20, 2, 'owner', ?, 'admin', 1)`,
  ).run(core.hashPassword("Owner-pass-2026"));
  db.exec(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (2, 'Rami Two', '70000002')`);
  db.exec(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Other Shop', '70000001')`);

  offlineRoutes = await import("../offline.js");
  offlineRoutes.setOfflineSnapshotServiceForTests(
    new core.OfflineSnapshotService(core.getOfflineSnapshotRepository(), {
      build: (o) => {
        buildCalls += 1;
        return core.buildTenantSnapshot({ ...o, DatabaseCtor: RealDatabase, tmpRoot });
      },
    }),
  );
  app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  app.use("/api/offline", offlineRoutes.default);
  const paired = await request(app).post("/api/offline/pair").set("fly-client-ip", "198.51.100.77").send(PAIR);
  expect(paired.body.success).toBe(true);
  key = paired.body.data.deviceKey as string;
});

afterAll(() => {
  offlineRoutes?.setOfflineSnapshotServiceForTests(null);
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/offline/snapshot", () => {
  it("refuses a different data version with VERSION_MISMATCH (HTTP 200), building and recording nothing", async () => {
    for (const v of [serverVersion - 1, serverVersion + 1]) {
      const res = await request(app)
        .get(`/api/offline/snapshot?schemaVersion=${v}`)
        .set("x-liratek-device-key", key);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toMatchObject({ success: false, code: "VERSION_MISMATCH" });
    }
    expect(buildCalls).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM offline_snapshots`).get()).toEqual({ n: 0 });
  });

  it("refuses a missing version and a missing key", async () => {
    const noVersion = await request(app).get(`/api/offline/snapshot`).set("x-liratek-device-key", key);
    expect(noVersion.status).toBe(200);
    expect(noVersion.body.success).toBe(false);
    const noKey = await request(app).get(`/api/offline/snapshot?schemaVersion=${serverVersion}`);
    expect(noKey.body).toMatchObject({ success: false, code: "INVALID_DEVICE_KEY" });
    expect(buildCalls).toBe(0);
  });

  it("serves the gzip copy of tenant 2 only, with the four headers, no Content-Encoding", async () => {
    const res = await request(app)
      .get(`/api/offline/snapshot?schemaVersion=${serverVersion}`)
      .set("x-liratek-device-key", key)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-encoding"]).toBeUndefined();
    const copyId = res.headers["x-copy-id"];
    expect(copyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers["x-snapshot-schema-version"]).toBe(String(serverVersion));
    expect(res.headers["x-snapshot-tenant-id"]).toBe("2");
    expect(Number.isFinite(Date.parse(String(res.headers["x-snapshot-built-at"])))).toBe(true);

    const body = res.body as Buffer;
    expect(body.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b])); // gzip magic
    const file = path.join(tmpRoot, "served.db");
    fs.writeFileSync(file, zlib.gunzipSync(body));
    const copy = new RealDatabase(file, { readonly: true });
    try {
      expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(copy.prepare(`SELECT copy_id, tenant_id FROM offline_copy_meta`).all()).toEqual([
        { copy_id: copyId, tenant_id: 2 },
      ]);
      const names = (copy.prepare(`SELECT full_name FROM clients ORDER BY id`).all() as Array<{ full_name: string }>).map(
        (r) => r.full_name,
      );
      expect(names).toEqual(["Rami Two"]);
    } finally {
      copy.close();
    }
    // recorded once, for tenant 2, with this copy id
    expect(db.prepare(`SELECT tenant_id, copy_id FROM offline_snapshots`).all()).toEqual([
      { tenant_id: 2, copy_id: copyId },
    ]);
    expect(buildCalls).toBe(1);
  });

  it("a second PC request within 5 minutes gets the same cached copy (no new build)", async () => {
    const res = await request(app)
      .get(`/api/offline/snapshot?schemaVersion=${serverVersion}`)
      .set("x-liratek-device-key", key)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(buildCalls).toBe(1);
  });
});
