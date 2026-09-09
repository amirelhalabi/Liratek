/**
 * v174 (username_case_insensitive) — driven through the REAL migration runner,
 * matching PerTenantUsernamesMigrationViaRunner.test.ts.
 *
 * The bug this closes was found in the live database: tenant 1 held both
 * 'admin' and 'Admin' as separate accounts with separate passwords. To anyone
 * reading a user list or an audit trail they are one name.
 *
 * Two properties matter and the tests below pin both:
 *
 *   1. Uniqueness folds case AFTER the migration, and demonstrably did NOT
 *      before it (rule 17 — the guard has to fail against the old schema, and
 *      here the "old behaviour" is asserted directly rather than by reverting
 *      code).
 *
 *   2. The existing duplicate is RENAMED, never deleted. `users` is the FK
 *      target of 22 tables, mostly NO ACTION and including financial ones, so
 *      a DELETE would either fail or strand history. The loser must keep its
 *      id and every inbound row.
 */

import Database from "better-sqlite3";
import {
  runMigrations,
  rollbackTo,
  getCurrentVersion,
  MIGRATIONS,
} from "../index";

/**
 * Post-v172, pre-v174 schema: the two tenant-scoped unique indexes in their
 * case-SENSITIVE form, plus two inbound FK holders so the rename has
 * references that must survive it.
 */
function createSchema(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      username TEXT,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active BOOLEAN DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_users_tenant_username ON users(tenant_id, username);
    CREATE UNIQUE INDEX idx_users_platform_username
      ON users(username) WHERE tenant_id IS NULL;

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      token TEXT NOT NULL
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL
    );

    INSERT INTO tenants (id, name, slug, status) VALUES (1, 'CornerTech', 'cornertech', 'active');
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'OtherShop', 'othershop', 'active');

    -- The real-world pair. id 2 is the account actually in use: more sessions,
    -- and the one whose password the owner still had. The survivor rule must
    -- pick it, NOT the lower id.
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (1, 1, 'admin', 'hash-lower', 'admin', 1);
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (2, 1, 'Admin', 'hash-upper', 'admin', 1);
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (3, 2, 'admin', 'hash-other', 'admin', 1);

    INSERT INTO sessions (user_id, token) VALUES (1, 'tok-a');
    INSERT INTO sessions (user_id, token) VALUES (2, 'tok-b');
    INSERT INTO sessions (user_id, token) VALUES (2, 'tok-c');
    INSERT INTO sessions (user_id, token) VALUES (2, 'tok-d');

    -- Inbound rows on the LOSER, standing in for the financial FKs.
    INSERT INTO audit_log (user_id, action) VALUES (1, 'login');
    INSERT INTO audit_log (user_id, action) VALUES (1, 'sale');
  `);
}

function markAppliedExcept(
  db: Database.Database,
  ...exceptVersions: number[]
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const insert = db.prepare(
    `INSERT INTO schema_migrations (version, name) VALUES (?, ?)`,
  );
  for (const m of MIGRATIONS) {
    if (!exceptVersions.includes(m.version)) {
      insert.run(m.version, m.name);
    }
  }
}

function insertUser(
  db: Database.Database,
  tenantId: number | null,
  username: string,
): void {
  db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
       VALUES (?, ?, 'h', 'admin', 1)`,
  ).run(tenantId, username);
}

function nameOf(db: Database.Database, id: number): string | undefined {
  return (
    db.prepare(`SELECT username FROM users WHERE id = ?`).get(id) as
      | { username: string }
      | undefined
  )?.username;
}

describe("v174 username_case_insensitive — via the real migration runner", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    markAppliedExcept(db, 174);
  });

  afterEach(() => db.close());

  it("applies and reaches version 174", () => {
    runMigrations(db);
    expect(getCurrentVersion(db)).toBeGreaterThanOrEqual(174);
  });

  it("the OLD schema really did allow 'admin' and 'Admin' side by side", () => {
    // Rule 17, stated as data rather than by reverting code: the fixture
    // inserted both without error, and a third casing is still accepted.
    // If this ever fails, the migration is guarding something already fixed.
    expect(() => insertUser(db, 1, "ADMIN")).not.toThrow();
  });

  it("folds case for uniqueness after the migration", () => {
    runMigrations(db);
    expect(() => insertUser(db, 1, "ADMIN")).toThrow(/UNIQUE/i);
    expect(() => insertUser(db, 1, "aDmIn")).toThrow(/UNIQUE/i);
  });

  it("still lets two DIFFERENT tenants each have an 'admin' (v172 preserved)", () => {
    runMigrations(db);
    // Tenant 2 already has one; a third tenant must still be able to.
    db.prepare(
      `INSERT INTO tenants (id, name, slug, status) VALUES (3, 'Third', 'third', 'active')`,
    ).run();
    expect(() => insertUser(db, 3, "Admin")).not.toThrow();
  });

  it("keeps the account people actually use, not the lowest id", () => {
    runMigrations(db);
    // id 2 ('Admin') has 3 sessions to id 1's 1, so it survives untouched.
    expect(nameOf(db, 2)).toBe("Admin");
    expect(
      (db.prepare(`SELECT is_active FROM users WHERE id = 2`).get() as {
        is_active: number;
      }).is_active,
    ).toBe(1);
  });

  it("renames and deactivates the loser instead of deleting it", () => {
    runMigrations(db);

    // Still there, same id — this is the whole point. Deleting it would have
    // hit 22 NO ACTION foreign keys, including financial ones.
    expect(nameOf(db, 1)).toBe("admin.retired-1");
    expect(
      (db.prepare(`SELECT is_active FROM users WHERE id = 1`).get() as {
        is_active: number;
      }).is_active,
    ).toBe(0);

    // Its inbound rows still resolve to a real user row.
    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_log a
          WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)`,
      )
      .get() as { c: number };
    expect(orphans.c).toBe(0);
  });

  it("leaves a tenant with no duplicates completely untouched", () => {
    runMigrations(db);
    expect(nameOf(db, 3)).toBe("admin");
  });

  it("folds case in the PLATFORM realm too", () => {
    insertUser(db, null, "root");
    insertUser(db, null, "ROOT"); // allowed by the old case-sensitive index
    runMigrations(db);

    // One survives under its own name, the other is retired — and no third
    // casing can be added afterwards.
    expect(() => insertUser(db, null, "Root")).toThrow(/UNIQUE/i);
  });

  it("rolls back: names restored and case-sensitivity returns", () => {
    runMigrations(db);
    expect(nameOf(db, 1)).toBe("admin.retired-1");

    rollbackTo(db, 173);

    expect(nameOf(db, 1)).toBe("admin");
    expect(
      (db.prepare(`SELECT is_active FROM users WHERE id = 1`).get() as {
        is_active: number;
      }).is_active,
    ).toBe(1);
    // Case-sensitive again, so a differing casing is accepted once more.
    expect(() => insertUser(db, 1, "ADMIN")).not.toThrow();
  });
});
