/**
 * Settings › Reset Data over REST must NOT sign anybody out (production bug,
 * 2026-10-07).
 *
 * Real Express routers (`/api/auth`, `/api/database`) and the real
 * `authenticateJWT` over a REAL in-memory SQLite built from
 * `electron-app/create_db.sql`. The defect: the reset wiped the LOGIN
 * `sessions` table, so the admin who pressed "Reset everything" got 401
 * "Session expired" on every next request (and so never saw "Done — N rows
 * removed"), and every other user's device was signed out with them.
 *
 * Proof chain asserted here, end to end:
 *   1. POST /api/database/reset answers `{ success: true, data }` — the
 *      envelope the modal turns into "Done — N rows removed";
 *   2. the SAME admin token still authenticates afterwards;
 *   3. a different user's token still authenticates afterwards;
 *   4. customer sessions (operational data) are gone.
 *
 * Rule 17 note: the failing-first proof for this defect is the core suite
 * `DatabaseResetRepository.keepsSignIns.test.ts` (seen failing on the
 * unfixed classification). THIS file was written after the fix, so it is
 * NOT proven failing-first against the unfixed code. It WAS seen failing
 * against a mocked old classification (a throwaway copy that jest.mock'ed
 * `RESET_WIPE_TABLES` to include `sessions`; the finished code was never
 * edited): it failed on the preview's `sessions` count, and with that
 * assertion removed the reset still answered `{ success: true }` while the
 * very next `/api/auth/me` on the same token answered 401.
 */

import { jest } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";

jest.mock("../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Real better-sqlite3 (subpath import escapes the moduleNameMapper mock).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const JWT_TEST_SECRET = "reset-test-secret-0123456789-0123456789-01234567";
const PASSWORD = "Password123!";
const CREATE_DB_SQL = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");

async function loginToken(username: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  const token = (res.body as { data?: { token?: string } }).data?.token;
  expect(token).toBeDefined();
  return token as string;
}

function me(token: string) {
  return request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_TEST_SECRET;

  db = new RealDatabase(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL, "utf8"));
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;

  core = await import("@liratek/core");

  const hash = core.hashPassword(PASSWORD);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = 1`).run(hash);
  db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
     VALUES (1, 'reset_staff', ?, 'staff', 1)`,
  ).run(hash);

  core.resetUserRepository();
  core.resetSessionRepository();
  core.resetAuthService();
  core.resetAuditRepository();
  core.resetDatabaseResetRepository();
  core.resetDatabaseResetService();

  const authRoutes = (await import("../api/auth")).default;
  const databaseResetRoutes = (await import("../api/databaseReset")).default;

  app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/database", databaseResetRoutes);
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

beforeEach(() => {
  // Web mode: tenant context comes only from authenticateJWT's runWithTenant.
  core.resetTenantContext();
});

describe("POST /api/database/reset keeps every sign-in", () => {
  it("returns the success envelope, and the admin's and another user's tokens stay valid", async () => {
    const adminToken = await loginToken("admin");
    const staffToken = await loginToken("reset_staff");

    const adminId = (
      db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get() as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO customer_sessions (tenant_id, user_id, started_by) VALUES (1, ?, 'tester')`,
    ).run(adminId);

    const preview = await request(app)
      .get("/api/database/reset/preview")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.success).toBe(true);
    expect(preview.body.data.counts).not.toHaveProperty("sessions");
    expect(preview.body.data.counts.customer_sessions).toBe(1);

    const reset = await request(app)
      .post("/api/database/reset")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirmation: core.DATABASE_RESET_CONFIRMATION_PHRASE });
    expect(reset.status).toBe(200);
    expect(reset.body.success).toBe(true);
    expect(typeof reset.body.data.totalDeleted).toBe("number");
    expect(reset.body.data.totalDeleted).toBeGreaterThan(0);
    expect(reset.body.data.deletedRows).not.toHaveProperty("sessions");

    // The caller is still signed in — next request is NOT 401.
    const adminMe = await me(adminToken);
    expect(adminMe.status).toBe(200);
    expect(adminMe.body.user.username).toBe("admin");

    const afterPreview = await request(app)
      .get("/api/database/reset/preview")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(afterPreview.status).toBe(200);
    expect(afterPreview.body.success).toBe(true);

    // Another user's device is still signed in.
    const staffMe = await me(staffToken);
    expect(staffMe.status).toBe(200);
    expect(staffMe.body.user.username).toBe("reset_staff");

    // Customer sessions are operational data and were wiped.
    const left = db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_sessions WHERE tenant_id = 1`,
      )
      .get() as { n: number };
    expect(left.n).toBe(0);
  });
});
