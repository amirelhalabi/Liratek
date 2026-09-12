/**
 * v172 (per_tenant_usernames) — driven through the REAL migration runner
 * (`runMigrations` / `rollbackTo`), following the split established by
 * PartnersSystemAssociationFkMigrationViaRunner.test.ts.
 *
 * Why via the runner and not a direct `migration.up(db)` call: `users` is the
 * FK TARGET of 22 real tables, and v172 rebuilds it via DROP + RENAME because
 * the old `username TEXT UNIQUE` is enforced by an implicit index
 * (`sqlite_autoindex_users_1`) that SQLite will not let you DROP. With
 * `PRAGMA foreign_keys = ON`, SQLite refuses to `DROP TABLE users` while any
 * row still references it. Both `runMigrations()` and `rollbackTo()` bracket
 * their batch with `foreign_keys = OFF` — so the bracket is part of what makes
 * this migration correct, and testing up()/down() in isolation would not
 * exercise it.
 *
 * The rebuild was additionally proven against a COPY of the real accumulated
 * database before shipping: 2 users preserved with identical ids, all 22
 * inbound FKs verified non-orphaned, `foreign_key_check` clean.
 */

import Database from "better-sqlite3";
import {
  runMigrations,
  rollbackTo,
  getCurrentVersion,
  MIGRATIONS,
} from "../index";

/**
 * Minimal pre-v172 schema: `users` in its OLD shape (globally unique username)
 * plus two of the real inbound FK holders, so the rebuild has references to
 * preserve rather than an empty graph.
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
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active BOOLEAN DEFAULT 1
    );
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

    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (1, 1, 'admin', 'hash-1', 'admin', 1);
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (2, 1, 'staff1', 'hash-2', 'staff', 1);
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (3, NULL, 'root', 'hash-3', 'super_admin', 1);

    INSERT INTO sessions (user_id, token) VALUES (1, 'tok-1');
    INSERT INTO audit_log (user_id, action) VALUES (1, 'login');
    INSERT INTO audit_log (user_id, action) VALUES (3, 'create');
  `);
}

/** Mirrors the identical helper in the other via-runner migration tests. */
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

describe("v172 per_tenant_usernames — via the real migration runner", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    markAppliedExcept(db, 172);
  });

  afterEach(() => {
    db.close();
  });

  it("applies and reaches version 172", () => {
    runMigrations(db);
    expect(getCurrentVersion(db)).toBeGreaterThanOrEqual(172);
  });

  it("lets two tenants each have an 'admin' — the point of the migration", () => {
    // Rejected before the migration: proves the guard is meaningful.
    expect(() => insertUser(db, 2, "admin")).toThrow(/UNIQUE/i);

    runMigrations(db);

    expect(() => insertUser(db, 2, "admin")).not.toThrow();
    const rows = db
      .prepare(
        `SELECT tenant_id FROM users WHERE username = 'admin' ORDER BY tenant_id`,
      )
      .all() as { tenant_id: number }[];
    expect(rows.map((r) => r.tenant_id)).toEqual([1, 2]);
  });

  it("still rejects a duplicate username WITHIN one tenant", () => {
    runMigrations(db);
    expect(() => insertUser(db, 1, "admin")).toThrow(/UNIQUE/i);
  });

  it("still rejects two platform super_admins sharing a username", () => {
    runMigrations(db);
    // Not redundant with the composite index: SQLite treats NULLs as distinct,
    // so without the partial index this would silently succeed.
    expect(() => insertUser(db, null, "root")).toThrow(/UNIQUE/i);
  });

  it("preserves every user row and id verbatim", () => {
    const before = db.prepare(`SELECT * FROM users ORDER BY id`).all();
    runMigrations(db);
    const after = db.prepare(`SELECT * FROM users ORDER BY id`).all();
    // Ids especially: all 22 inbound FKs in the real schema point at them.
    expect(after).toEqual(before);
  });

  it("leaves inbound foreign keys resolving", () => {
    runMigrations(db);

    expect(db.pragma("foreign_key_check")).toEqual([]);

    const orphanSessions = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM sessions s
             LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL`,
        )
        .get() as { c: number }
    ).c;
    const orphanAudit = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM audit_log a
             LEFT JOIN users u ON u.id = a.user_id WHERE u.id IS NULL`,
        )
        .get() as { c: number }
    ).c;
    expect(orphanSessions).toBe(0);
    expect(orphanAudit).toBe(0);
  });

  it("drops the implicit global-unique index it exists to remove", () => {
    runMigrations(db);
    const autoIndex = db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'index'
           AND tbl_name = 'users' AND name = 'sqlite_autoindex_users_1'`,
      )
      .get();
    expect(autoIndex).toBeUndefined();
  });

  it("is idempotent when replayed", () => {
    runMigrations(db);
    db.prepare(`DELETE FROM schema_migrations WHERE version = 172`).run();
    expect(() => runMigrations(db)).not.toThrow();
    expect(() => insertUser(db, 1, "admin")).toThrow(/UNIQUE/i);
  });

  describe("rollback", () => {
    it("restores the global UNIQUE when no cross-tenant duplicate exists", () => {
      runMigrations(db);
      rollbackTo(db, 171);

      // Global again: another tenant can no longer reuse 'admin'.
      expect(() => insertUser(db, 2, "admin")).toThrow(/UNIQUE/i);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    });

    it("REFUSES to roll back once two tenants share a username", () => {
      runMigrations(db);
      insertUser(db, 2, "admin");

      // Rolling back would have to drop one of two legitimate users. Failing
      // loudly is the only honest option.
      expect(() => rollbackTo(db, 171)).toThrow(/cannot be rolled back/i);
    });
  });
});
