/**
 * When an admin changes another user's role or resets their password, that
 * user's existing sessions must end.
 *
 * Today `setUserRole` and the admin `resetPassword` only update the users row.
 * The web middleware takes the role from the JWT claim minted at login, and
 * renews that claim while the session is used, so a demoted admin keeps admin
 * rights for as long as they stay active. A password reset by an admin leaves
 * whoever holds the old session signed in. The sibling paths already revoke:
 * `changePassword` signs out the user's other sessions, and emailed-link
 * recovery deletes all of them (PasswordResetService).
 *
 * Security audit run-1, fingerprint
 * auth.ts:authenticateJWT:role-from-jwt-claim-not-revoked-on-setUserRole.
 *
 * Real in-memory users table, same harness as AuthService.setUserRole.test.ts;
 * the session repository is a spy so the test sees which sessions are ended.
 */

import Database from "better-sqlite3";
import { AuthService } from "../AuthService";
import { UserRepository } from "../../repositories/UserRepository";
import type { SessionRepository } from "../../repositories/SessionRepository";
import { runWithTenant } from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active INTEGER DEFAULT 1,
      has_password INTEGER DEFAULT 1
    );
  `);
  return db;
}

function insertUser(
  db: Database.Database,
  tenantId: number,
  username: string,
  role: "admin" | "staff",
): number {
  const result = db
    .prepare(
      `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (?, ?, 'hash', ?, 1)`,
    )
    .run(tenantId, username, role);
  return result.lastInsertRowid as number;
}

describe("AuthService — admin changes to a user end that user's sessions", () => {
  let db: Database.Database;
  let deleteByUserId: jest.Mock;
  let service: AuthService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    deleteByUserId = jest.fn(() => 1);
    const sessionRepo = { deleteByUserId } as unknown as SessionRepository;
    service = new AuthService(new UserRepository(), sessionRepo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("demoting an admin to staff ends the demoted user's sessions", () => {
    insertUser(db, 1, "admin1", "admin");
    const target = insertUser(db, 1, "admin2", "admin");

    runWithTenant(1, () => service.setUserRole(target, "staff", "admin"));

    expect(deleteByUserId).toHaveBeenCalledWith(target);
  });

  it("an admin password reset ends the target user's sessions", async () => {
    insertUser(db, 1, "admin1", "admin");
    const target = insertUser(db, 1, "cashier1", "staff");

    await runWithTenant(1, () =>
      service.resetPassword(target, "N3w-Strong-Passw0rd!", "admin"),
    );

    expect(deleteByUserId).toHaveBeenCalledWith(target);
  });
});
