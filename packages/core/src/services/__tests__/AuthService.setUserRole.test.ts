/**
 * AuthService.setUserRole — the REST/IPC user-management fix's core-layer
 * piece (packages/core scope of the "web user management" ticket).
 *
 * The IPC handler (`electron-app/handlers/authHandlers.ts`,
 * `users:set-role`) used to run a raw, un-tenant-scoped
 * `UPDATE users SET role = ? WHERE id = ?` — no `tenant_id` predicate at
 * all. Any tenant admin could change ANY user's role in ANY OTHER tenant by
 * guessing an id. `setUserRole` replaces that with
 * `UserRepository.updateUser`, which is tenant-scoped
 * (`BaseRepository`-derived — see the "cross-tenant" test below, which is
 * the regression guard for that exact hole, rule 17).
 *
 * A real in-memory `users` table (not a mocked repository) is used
 * throughout instead of jest mocks: the tenant-isolation case is a property
 * of the SQL `WHERE tenant_id = ?` clause the repository builds, which a
 * mocked repo cannot exercise — only a real UserRepository against a real
 * table can prove the scoping actually holds.
 */

import Database from "better-sqlite3";
import { AuthService } from "../AuthService";
import { UserRepository } from "../../repositories/UserRepository";
import type { SessionRepository } from "../../repositories/SessionRepository";
import { runWithTenant } from "../../db/tenantContext";
import { AuthorizationError, BusinessRuleError } from "../../utils/errors";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active INTEGER DEFAULT 1
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

function roleOf(db: Database.Database, id: number): string | undefined {
  return (
    db.prepare(`SELECT role FROM users WHERE id = ?`).get(id) as
      | { role: string }
      | undefined
  )?.role;
}

// AuthService's constructor takes a sessionRepo too, but setUserRole never
// touches it — a bare unused-but-typed stand-in is enough.
const noopSessionRepo = {} as SessionRepository;

describe("AuthService.setUserRole", () => {
  let db: Database.Database;
  let userRepo: UserRepository;
  let service: AuthService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    userRepo = new UserRepository();
    service = new AuthService(userRepo, noopSessionRepo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("promotes staff -> admin", () => {
    const id = insertUser(db, 1, "cashier1", "staff");

    const result = runWithTenant(1, () =>
      service.setUserRole(id, "admin", "admin"),
    );

    expect(result).toBe(true);
    expect(roleOf(db, id)).toBe("admin");
  });

  it("demotes admin -> staff when another admin remains", () => {
    insertUser(db, 1, "admin1", "admin"); // keeps countActiveAdmins() at 2
    const target = insertUser(db, 1, "admin2", "admin");

    const result = runWithTenant(1, () =>
      service.setUserRole(target, "staff", "admin"),
    );

    expect(result).toBe(true);
    expect(roleOf(db, target)).toBe("staff");
  });

  it("rejects a non-admin actor and leaves the role untouched", () => {
    const id = insertUser(db, 1, "cashier1", "staff");

    expect(() =>
      runWithTenant(1, () => service.setUserRole(id, "admin", "staff")),
    ).toThrow(AuthorizationError);
    expect(roleOf(db, id)).toBe("staff");
  });

  it("refuses to demote the LAST active admin, mirroring deactivateUser's guard", () => {
    const onlyAdmin = insertUser(db, 1, "solo-admin", "admin");

    expect(() =>
      runWithTenant(1, () => service.setUserRole(onlyAdmin, "staff", "admin")),
    ).toThrow(BusinessRuleError);
    expect(roleOf(db, onlyAdmin)).toBe("admin");
  });

  it("an unknown user id is handled as a no-op (returns false, does not throw)", () => {
    const result = runWithTenant(1, () =>
      service.setUserRole(999999, "admin", "admin"),
    );

    expect(result).toBe(false);
  });

  it("REGRESSION GUARD: a user in tenant 2 is NOT modifiable from a tenant-1 context", () => {
    // Pre-fix, the IPC handler ran `UPDATE users SET role = ? WHERE id = ?`
    // with no tenant_id predicate — this exact scenario would have
    // silently succeeded and changed tenant 2's user's role from inside
    // tenant 1's admin session.
    const tenantTwoUser = insertUser(db, 2, "other-tenant-staff", "staff");

    const result = runWithTenant(1, () =>
      service.setUserRole(tenantTwoUser, "admin", "admin"),
    );

    expect(result).toBe(false);
    // The row is untouched — still tenant 2, still staff.
    expect(roleOf(db, tenantTwoUser)).toBe("staff");

    // Sanity check the positive case: the SAME id, acted on from ITS OWN
    // tenant's context, actually works — proving the false above is the
    // tenant guard and not just a broken method.
    const correctResult = runWithTenant(2, () =>
      service.setUserRole(tenantTwoUser, "admin", "admin"),
    );
    expect(correctResult).toBe(true);
    expect(roleOf(db, tenantTwoUser)).toBe("admin");
  });
});
