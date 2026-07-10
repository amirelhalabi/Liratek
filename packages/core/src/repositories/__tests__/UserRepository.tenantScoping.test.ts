/**
 * UserRepository — cross-tenant isolation (WP3f, rule 17 regression proof)
 *
 * Seeds two tenants' users and proves:
 *   - findAllSafe() / findAllIncludingInactive() / findByIdSafe() /
 *     countByRole() only ever see the current tenant's users — a tenant
 *     admin listing/counting staff must never see another tenant's roster
 *     (see WP3f prompt note #1).
 *   - updatePassword() / softDeleteById() / restore() cannot reach another
 *     tenant's user row by id.
 *   - findByUsername() is the INTENDED exception: usernames are globally
 *     unique (docs/plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md §1), so it
 *     resolves a user of ANY tenant regardless of which tenant's context is
 *     currently active — this is asserted explicitly, not just left
 *     untested, per the WP3f prompt.
 *
 * Per CLAUDE.md rule 17, the tenant-scoping half of this test was verified
 * to FAIL when the `tenant_id` predicate was removed from `findAllSafe()`
 * before being committed — see the WP3f report for the sabotage-and-revert
 * transcript.
 */

import Database from "better-sqlite3";
import { UserRepository } from "../UserRepository";
import { runWithTenant } from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      slug       TEXT NOT NULL UNIQUE,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES
      (1, 'Tenant One', 'tenant-one'),
      (2, 'Tenant Two', 'tenant-two');

    -- Matches electron-app/create_db.sql's post-v123 users table: no
    -- created_at/updated_at columns (UserRepository's softDeleteById/
    -- restore overrides exist specifically because of this).
    CREATE TABLE users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER REFERENCES tenants(id),
      username      TEXT UNIQUE,
      password_hash TEXT,
      role          TEXT DEFAULT 'staff',
      is_active     BOOLEAN DEFAULT 1
    );
  `);

  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (1, 1, 'admin-t1', 'hash1', 'admin', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (2, 1, 'staff-t1', 'hash2', 'staff', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (3, 2, 'admin-t2', 'hash3', 'admin', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (4, 2, 'staff-t2', 'hash4', 'staff', 1)`,
  ).run();
  // Platform realm user — tenant_id NULL (super_admin bootstrap shape).
  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (5, NULL, 'root-super', 'hash5', 'super_admin', 1)`,
  ).run();

  return db;
}

describe("UserRepository — cross-tenant isolation", () => {
  let db: Database.Database;
  let repo: UserRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    repo = new UserRepository();
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("findAllSafe() under tenant 1 sees only tenant 1's active users", () => {
    const rows = runWithTenant(1, () => repo.findAllSafe());
    expect(rows.map((r) => r.username).sort()).toEqual([
      "admin-t1",
      "staff-t1",
    ]);
  });

  it("findAllSafe() under tenant 2 sees only tenant 2's active users", () => {
    const rows = runWithTenant(2, () => repo.findAllSafe());
    expect(rows.map((r) => r.username).sort()).toEqual([
      "admin-t2",
      "staff-t2",
    ]);
  });

  it("findAllIncludingInactive() never leaks another tenant's users", () => {
    runWithTenant(1, () => repo.softDeleteById(2)); // deactivate staff-t1
    const t1Rows = runWithTenant(1, () => repo.findAllIncludingInactive());
    expect(t1Rows.map((r) => r.username).sort()).toEqual([
      "admin-t1",
      "staff-t1",
    ]);
    const t2Rows = runWithTenant(2, () => repo.findAllIncludingInactive());
    expect(t2Rows.map((r) => r.username).sort()).toEqual([
      "admin-t2",
      "staff-t2",
    ]);
  });

  it("findByIdSafe() cannot reach another tenant's user by id", () => {
    expect(runWithTenant(1, () => repo.findByIdSafe(3))).toBeNull();
    expect(runWithTenant(1, () => repo.findByIdSafe(1))?.username).toBe(
      "admin-t1",
    );
  });

  it("countByRole()/countActiveAdmins() only count the current tenant's users", () => {
    expect(runWithTenant(1, () => repo.countActiveAdmins())).toBe(1);
    expect(runWithTenant(2, () => repo.countActiveAdmins())).toBe(1);
    // Deactivate tenant 2's admin only — tenant 1's count must be unaffected.
    runWithTenant(2, () => repo.softDeleteById(3));
    expect(runWithTenant(1, () => repo.countActiveAdmins())).toBe(1);
    expect(runWithTenant(2, () => repo.countActiveAdmins())).toBe(0);
  });

  it("updatePassword() cannot reach another tenant's user by id", () => {
    const changed = runWithTenant(1, () =>
      repo.updatePassword(3, "new-hash"),
    );
    expect(changed).toBe(false);
    const stillOld = runWithTenant(2, () => repo.findById(3));
    expect(stillOld?.password_hash).toBe("hash3");
  });

  it("softDeleteById()/restore() cannot reach another tenant's user by id", () => {
    // NOTE: `findById()` (generic BaseRepository CRUD) filters `is_active = 1`
    // automatically whenever the column exists (BaseRepository.getBaseWhere),
    // independent of tenant scoping and independent of this WP's changes —
    // so once a row is deactivated it becomes invisible to findById() even
    // within its own tenant. Read `is_active` straight off the raw db for
    // these assertions instead.
    const rawIsActive = (id: number): number =>
      (
        db.prepare("SELECT is_active FROM users WHERE id = ?").get(id) as {
          is_active: number;
        }
      ).is_active;

    const deactivated = runWithTenant(1, () => repo.softDeleteById(3));
    expect(deactivated).toBe(false);
    expect(rawIsActive(3)).toBe(1);

    // Sanity: same call DOES work within the owning tenant.
    const ownDeactivate = runWithTenant(2, () => repo.softDeleteById(3));
    expect(ownDeactivate).toBe(true);
    expect(rawIsActive(3)).toBe(0);

    const restoredCrossTenant = runWithTenant(1, () => repo.restore(3));
    expect(restoredCrossTenant).toBe(false);
    expect(rawIsActive(3)).toBe(0);
  });

  it("findByUsername() is the intended exception: it resolves users of ANY tenant regardless of current context", () => {
    // Called from inside tenant 1's context but resolves tenant 2's user —
    // this is BY DESIGN (username is globally unique; login has no tenant
    // hint yet), not a leak. See the /* tenant-exempt */ comment on
    // UserRepository.findByUsername.
    const foundFromT1Context = runWithTenant(1, () =>
      repo.findByUsername("admin-t2"),
    );
    expect(foundFromT1Context?.tenant_id).toBe(2);

    const foundFromT2Context = runWithTenant(2, () =>
      repo.findByUsername("admin-t1"),
    );
    expect(foundFromT2Context?.tenant_id).toBe(1);

    // Also resolves the platform realm (tenant_id NULL) from any context.
    const superAdmin = runWithTenant(1, () =>
      repo.findByUsername("root-super"),
    );
    expect(superAdmin?.tenant_id).toBeNull();
    expect(superAdmin?.role).toBe("super_admin");
  });
});
