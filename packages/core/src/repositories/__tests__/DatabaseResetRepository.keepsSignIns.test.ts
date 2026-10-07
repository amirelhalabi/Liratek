/**
 * Settings › Reset Data must keep every user signed in (production bug,
 * 2026-10-07).
 *
 * `sessions` is the LOGIN session table: every web request validates its
 * JWT against a row here (`authenticateJWT` → `AuthService.validateSession`),
 * and the desktop app re-validates its stored token against it on every
 * launch/reload (`auth:restore-session`). Wiping it signed out the admin who
 * pressed "Reset everything" (every later request answered 401 "Session
 * expired", so the "Done — N rows removed" message never got a chance to
 * show) and every other device of the shop. The owner's intent: a reset
 * wipes operational data but keeps every user AND their sign-ins.
 *
 * Customer sessions (`customer_sessions`, `customer_session_transactions`,
 * `session_cart_items`) are operational data and must still be wiped.
 *
 * Validity is asserted through the REAL `AuthService.validateSession` — the
 * exact call both transports make — not by counting rows, so the test fails
 * for the reason the user saw, not for a proxy of it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import {
  DatabaseResetRepository,
  resetDatabaseResetRepository,
} from "../DatabaseResetRepository.js";
import { SessionRepository } from "../SessionRepository.js";
import { UserRepository } from "../UserRepository.js";
import { AuthService } from "../../services/AuthService.js";
import { runWithTenant, resetTenantContext } from "../../db/tenantContext.js";
import {
  RESET_KEEP_TABLES,
  RESET_WIPE_TABLES,
} from "../../constants/resetTables.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  db.pragma("foreign_keys = ON");
  return db;
}

function count(db: Database.Database, table: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE tenant_id = 1`)
      .get() as { n: number }
  ).n;
}

describe("Reset Data keeps every sign-in (login sessions)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetDatabaseResetRepository();
    db.close();
  });

  function seedUser(username: string, role: "admin" | "staff"): number {
    return db
      .prepare(
        `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
         VALUES (1, ?, 'x', ?, 1)`,
      )
      .run(username, role).lastInsertRowid as number;
  }

  it("keeps the caller's and other users' login sessions valid, and wipes customer sessions", async () => {
    const adminId = seedUser("reset_admin", "admin");
    const staffId = seedUser("reset_staff", "staff");

    const sessionRepo = new SessionRepository();
    const auth = new AuthService(new UserRepository(), sessionRepo);

    // The admin pressing "Reset everything" (web), the same admin's desktop,
    // and another user's device.
    const callerWeb = runWithTenant(1, () =>
      sessionRepo.createSession({
        user_id: adminId,
        device_type: "web",
        tenant_id: 1,
      }),
    );
    const callerDesktop = runWithTenant(1, () =>
      sessionRepo.createSession({
        user_id: adminId,
        device_type: "electron",
        tenant_id: 1,
      }),
    );
    const otherUser = runWithTenant(1, () =>
      sessionRepo.createSession({
        user_id: staffId,
        device_type: "web",
        tenant_id: 1,
      }),
    );

    // Customer sessions (operational) — must still be wiped.
    const customerSessionId = db
      .prepare(
        `INSERT INTO customer_sessions (tenant_id, user_id, started_by) VALUES (1, ?, 'tester')`,
      )
      .run(adminId).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO session_cart_items
         (tenant_id, session_id, item_id, module, label, amount, ipc_channel)
       VALUES (1, ?, 'item1', 'pos', 'Fixture', 1, 'channel')`,
    ).run(customerSessionId);

    // Sanity: all three sign-ins are valid before the reset.
    for (const s of [callerWeb, callerDesktop, otherUser]) {
      expect(await auth.validateSession(s.token)).not.toBeNull();
    }
    const loginSessionsBefore = count(db, "sessions");
    expect(loginSessionsBefore).toBe(3);

    const result = runWithTenant(1, () =>
      new DatabaseResetRepository().resetTenantData(),
    );

    // Every sign-in survives and still authenticates as the same user.
    expect((await auth.validateSession(callerWeb.token))?.id).toBe(adminId);
    expect((await auth.validateSession(callerDesktop.token))?.id).toBe(
      adminId,
    );
    expect((await auth.validateSession(otherUser.token))?.id).toBe(staffId);
    expect(count(db, "sessions")).toBe(loginSessionsBefore);
    // The reported total must not include sign-ins either.
    expect(result.deletedRows).not.toHaveProperty("sessions");

    // Customer sessions are operational data and are gone.
    expect(count(db, "customer_sessions")).toBe(0);
    expect(count(db, "session_cart_items")).toBe(0);
    expect(result.deletedRows.customer_sessions).toBe(1);
    // session_cart_items is not asserted in deletedRows: it is removed by
    // the FK cascade from customer_sessions before its own DELETE runs, so
    // its own `changes` is 0. The row count above is what matters.
  });

  it("the preview does not count login sessions as rows to remove", () => {
    const adminId = seedUser("preview_admin", "admin");
    runWithTenant(1, () =>
      new SessionRepository().createSession({ user_id: adminId, tenant_id: 1 }),
    );
    db.prepare(
      `INSERT INTO customer_sessions (tenant_id, user_id, started_by) VALUES (1, ?, 'tester')`,
    ).run(adminId);

    const preview = runWithTenant(1, () =>
      new DatabaseResetRepository().previewCounts(),
    );

    expect(preview.counts).not.toHaveProperty("sessions");
    expect(preview.counts.customer_sessions).toBe(1);
    expect(preview.totalRows).toBe(
      Object.values(preview.counts).reduce((sum, n) => sum + n, 0),
    );
  });

  it("classifies the login session table as KEEP, never WIPE", () => {
    expect(RESET_WIPE_TABLES).not.toContain("sessions");
    expect(RESET_KEEP_TABLES).toContain("sessions");
    // Customer sessions stay operational.
    for (const t of [
      "customer_sessions",
      "customer_session_transactions",
      "session_cart_items",
    ]) {
      expect(RESET_WIPE_TABLES).toContain(t);
    }
  });
});
