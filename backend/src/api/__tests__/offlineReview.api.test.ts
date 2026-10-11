/**
 * LIRA-306 T070 — the web review + paired-PC routes of /api/offline (FR-002,
 * FR-037, FR-038, contracts/rest-offline.md), over a REAL in-memory database.
 *
 * Shop = tenant 2 (jest.setup.ts fixes a tenant-1 fallback that would hide a
 * route forgetting the tenant context). `../../middleware/auth.js` is
 * replaced by a stand-in with the real contract: `authenticateJWT` sets
 * `req.user` from test headers and enters the JWT's tenant (as the real one
 * does via runWithTenant); `requireRole` is the real logic (401 without a
 * user, 403 for a role not listed). Every review route must be
 * authenticateJWT → requireRole(["admin"]); the actor comes from the JWT,
 * never the body; business failures are HTTP 200 envelopes.
 */
import { jest } from "@jest/globals";
import type { Express, NextFunction, Request, Response } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../middleware/auth.js", () => {
  type R = Request & { user?: { userId: number; role: string; tenantId: number } };
  return {
    verifyJwt: () => null,
    authenticateJWT: (req: R, res: Response, next: NextFunction) => {
      const role = req.header("x-test-role");
      if (!role) {
        res.status(401).json({ success: false, error: "Not authenticated" });
        return;
      }
      req.user = { userId: Number(req.header("x-test-user") ?? 20), role, tenantId: 2 } as never;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { runWithTenant } = require("@liratek/core") as typeof import("@liratek/core");
      runWithTenant(2, () => next());
    },
    requireRole: (roles: string[]) => (req: R, res: Response, next: NextFunction) => {
      if (!req.user) {
        res.status(401).json({ success: false, error: "Not authenticated" });
        return;
      }
      if (!roles.includes(req.user.role)) {
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }
      next();
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let deviceId = 0;

const admin = (r: request.Test) => r.set("x-test-role", "admin").set("x-test-user", "20");
const staff = (r: request.Test) => r.set("x-test-role", "staff").set("x-test-user", "21");

function storeHeldCheckpoint(seq: number): number {
  return core.runWithTenant(2, () => {
    const events = new core.OfflineEventRepository();
    const r = events.insertReceived({
      deviceId,
      eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      seq,
      channel: "carrier-lines:update-balance",
      payloadJson: JSON.stringify({ id: 1, credits: 5 }),
      payloadHash: `h${seq}`,
      actorUserId: 20,
      occurredAt: "2026-10-10T20:50:00.000Z",
      clientDay: "2026-10-10",
      clientTzOffsetMinutes: 180,
      copyId: "11111111-1111-4111-8111-111111111111",
      appVersion: "1.0.0",
      schemaVersion: 210,
      schemaShapeJson: "{}",
      ratesJson: "{}",
      createdJson: "{}",
      dependsOnJson: "[]",
    });
    events.updateOutcome(r.row!.id, { status: "held", resultJson: null, error: "held" });
    return new core.OfflineReviewRepository().insert({ eventRowId: r.row!.id, deviceId, kind: "held_checkpoint", details: { reason: "held" } });
  });
}

beforeAll(async () => {
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  core = await import("@liratek/core");
  db.exec(fs.readFileSync(path.join(__dirname, "../../../../electron-app/create_db.sql"), "utf8"));
  db.exec(`INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active')`);
  db.exec(`INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (20, 2, 'owner', '', 'admin', 1), (21, 2, 'cashier', '', 'staff', 1)`);
  deviceId = core.runWithTenant(2, () =>
    new core.OfflineDeviceRepository().insert({ deviceNo: 1, name: "Front PC", keyId: "aaaaaaaaaaa1", keyHash: "h", pairedBy: 20 }).id,
  );
  const offline = (await import("../offline.js")).default;
  app = express();
  app.use(express.json());
  app.use("/api/offline", offline);
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("review routes — admin only", () => {
  it("no JWT → 401; staff → 403 on every review and device route", async () => {
    expect((await request(app).get("/api/offline/review")).status).toBe(401);
    for (const [method, url] of [
      ["get", "/api/offline/review"],
      ["get", "/api/offline/history"],
      ["post", "/api/offline/review/1/apply"],
      ["post", "/api/offline/review/1/dismiss"],
      ["post", "/api/offline/review/1/reviewed"],
      ["post", "/api/offline/review/1/book-anyway"],
      ["get", "/api/offline/devices"],
      ["post", "/api/offline/devices/1/revoke"],
    ] as const) {
      const res = await staff(request(app)[method](url));
      expect([url, res.status]).toEqual([url, 403]);
    }
  });

  it("GET /review lists tenant 2's open items with labels; GET /history answers", async () => {
    const id = storeHeldCheckpoint(1);
    const res = await admin(request(app).get("/api/offline/review?state=open"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.map((i: { id: number; kind: string }) => [i.id, i.kind])).toEqual([[id, "held_checkpoint"]]);
    const h = await admin(request(app).get("/api/offline/history"));
    expect(h.body).toMatchObject({ success: true, data: { events: [expect.objectContaining({ status: "held" })] } });
  });

  it("Dismiss records the JWT's admin (never a body field); a repeat returns the same state", async () => {
    const id = storeHeldCheckpoint(2);
    const res = await admin(request(app).post(`/api/offline/review/${id}/dismiss`)).send({ note: "counted twice", userId: 999 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { state: "dismissed" } });
    expect(db.prepare(`SELECT tenant_id, state, resolved_by FROM offline_review_items WHERE id = ?`).get(id)).toEqual({ tenant_id: 2, state: "dismissed", resolved_by: 20 });
    const again = await admin(request(app).post(`/api/offline/review/${id}/dismiss`)).send({});
    expect(again.body).toMatchObject({ success: true, data: { state: "dismissed" } });
  });

  it("business failures are HTTP 200 envelopes (Book anyway on a held checkpoint; unknown id)", async () => {
    const id = storeHeldCheckpoint(3);
    const res = await admin(request(app).post(`/api/offline/review/${id}/book-anyway`));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    const missing = await admin(request(app).post(`/api/offline/review/99999/reviewed`));
    expect(missing.status).toBe(200);
    expect(missing.body).toMatchObject({ success: false, code: "NOT_FOUND" });
    const bad = await admin(request(app).post(`/api/offline/review/abc/apply`));
    expect(bad.body.success).toBe(false);
  });
});

describe("paired PCs", () => {
  it("GET /devices lists the shop's PCs without any key material; revoke works and is idempotent", async () => {
    const res = await admin(request(app).get("/api/offline/devices"));
    expect(res.status).toBe(200);
    expect(res.body.data.devices).toEqual([expect.objectContaining({ id: deviceId, deviceNo: 1, name: "Front PC", revokedAt: null })]);
    expect(JSON.stringify(res.body)).not.toMatch(/key_hash|keyHash|keyId/);
    const r = await admin(request(app).post(`/api/offline/devices/${deviceId}/revoke`));
    expect(r.body).toEqual({ success: true, data: { revoked: true } });
    expect(db.prepare(`SELECT revoked_by FROM offline_devices WHERE id = ?`).get(deviceId)).toEqual({ revoked_by: 20 });
    expect((await admin(request(app).post(`/api/offline/devices/${deviceId}/revoke`))).body).toEqual({ success: true, data: { revoked: true } });
  });
});
