/**
 * Web "Download backup" — GET /api/backup/download over a REAL in-memory
 * database holding TWO shops (shared mode, as in local dev and tests).
 *
 * Written failing-first (rule 17): `../backup.js` did not exist on the first
 * run. The caller is shop 2 (backend jest falls back to tenant 1, which would
 * hide a route that forgot the tenant context), so the mocked
 * `authenticateJWT` wraps `next()` in `runWithTenant(2, …)` as the real one
 * does. Backend jest maps `better-sqlite3` to a mock, so the route's service
 * is injected with the real constructor.
 */
import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockAuditRest = jest.fn();
jest.mock("../../middleware/audit.js", () => ({
  auditRest: (...args: unknown[]) => mockAuditRest(...args),
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = { userId: 20, username: "owner", role, tenantId: 2, sessionToken: "s" };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runWithTenant } = require("@liratek/core");
    runWithTenant(2, () => next());
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let backupRoutes: typeof import("../backup.js");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-backup-route-"));
const workRoot = path.join(tmpRoot, "work");

function binaryParser(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

beforeAll(async () => {
  fs.mkdirSync(workRoot);
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  const core = await import("@liratek/core");
  db.exec(fs.readFileSync(path.join(__dirname, "../../../../electron-app/create_db.sql"), "utf8"));
  db.exec(`INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active')`);
  db.exec(`INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (20, 2, 'owner', 'scrypt$two', 'admin', 1)`);
  db.exec(`INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (10, 1, 'other', 'scrypt$one', 'admin', 1)`);
  db.exec(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (2, 'Rami Two', '70000002')`);
  db.exec(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Other Shop', '70000001')`);
  db.exec(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Other Shop 2', '70000003')`);
  db.exec(
    `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd) VALUES (2, 'SALE', 'sales', 1, 20, 5), (1, 'SALE', 'sales', 1, 10, 9)`,
  );
  db.exec(
    `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (2, 20, 'tok-2', datetime('now', '+1 day')), (1, 10, 'tok-1', datetime('now', '+1 day'))`,
  );

  backupRoutes = await import("../backup.js");
  backupRoutes.setShopBackupServiceForTests(
    new core.ShopBackupService(new core.ShopBackupRepository(undefined, { DatabaseCtor: RealDatabase }), {
      tmpRoot: workRoot,
    }),
  );
  app = express();
  app.use(express.json());
  app.use("/api/backup", backupRoutes.default);
});

afterAll(() => {
  backupRoutes?.setShopBackupServiceForTests(null);
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  mockAuditRest.mockClear();
  backupRoutes?.resetShopBackupCooldownForTests();
});

describe("GET /api/backup/download", () => {
  it("refuses a staff user (403) and builds nothing", async () => {
    const res = await request(app).get("/api/backup/download?stamp=2026-11-10-1430").set("x-test-role", "staff");
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(fs.readdirSync(workRoot)).toEqual([]);
    expect(mockAuditRest).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request (401)", async () => {
    const res = await request(app).get("/api/backup/download");
    expect(res.status).toBe(401);
  });

  it("refuses a malformed stamp with the JSON envelope", async () => {
    const res = await request(app).get("/api/backup/download?stamp=..%2Fx").set("x-test-role", "admin");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.success).toBe(false);
  });

  it("a second download within a minute is refused instead of building another copy", async () => {
    const first = await request(app)
      .get("/api/backup/download?stamp=2026-11-10-1431")
      .set("x-test-role", "admin")
      .buffer(true)
      .parse(binaryParser);
    expect(first.status).toBe(200);
    const second = await request(app)
      .get("/api/backup/download?stamp=2026-11-10-1431")
      .set("x-test-role", "admin");
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ success: false });
    expect(String(second.body.error)).toMatch(/minute/i);
  });

  it("an admin downloads a .db of shop 2 only, with no sessions; the temp file is removed", async () => {
    const res = await request(app)
      .get("/api/backup/download?stamp=2026-11-10-1430")
      .set("x-test-role", "admin")
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="liratek-cornertech-2026-11-10-1430.db"');
    const body = res.body as Buffer;
    expect(body.subarray(0, 15).toString("utf8")).toBe("SQLite format 3");

    const file = path.join(tmpRoot, "downloaded.db");
    fs.writeFileSync(file, body);
    const copy = new RealDatabase(file, { readonly: true });
    try {
      expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
      const names = (copy.prepare(`SELECT full_name FROM clients ORDER BY id`).all() as Array<{ full_name: string }>).map(
        (r) => r.full_name,
      );
      expect(names).toEqual(["Rami Two"]);
      expect((copy.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as { c: number }).c).toBe(1);
      expect((copy.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number }).c).toBe(0);
      expect(copy.prepare(`SELECT id FROM tenants`).all()).toEqual([{ id: 2 }]);
    } finally {
      copy.close();
    }
    // the per-request temp directory is gone once the response finished
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.readdirSync(workRoot)).toEqual([]);
    expect(mockAuditRest).toHaveBeenCalledTimes(1);
    expect(mockAuditRest.mock.calls[0]![1]).toMatchObject({ action: "backup_download" });
  });
});
